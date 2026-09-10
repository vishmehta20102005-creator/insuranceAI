// @ts-nocheck
// =============================================================
// InsuranceAI — generate-policy-embedding Edge Function
// Phase 5a: Embedding Generation & Policy Summarization
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Convert a Blob to base64 string for Gemini inline_data.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[generate-policy-embedding] Missing Supabase environment variables");
      return new Response(
        JSON.stringify({ error: "Missing Supabase configuration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!GEMINI_API_KEY) {
      console.error("[generate-policy-embedding] Missing GEMINI_API_KEY");
      return new Response(
        JSON.stringify({ error: "Missing Gemini API configuration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Parse request body
    const body = await req.json().catch(() => ({}));
    const { policy_id } = body;

    if (!policy_id) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: policy_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[generate-policy-embedding] Generating embedding for policy: ${policy_id}`);

    // 2. Fetch policy details and attached category
    const { data: policy, error: policyError } = await supabase
      .from("policies")
      .select(`
        id,
        name,
        description,
        category,
        category_id,
        status,
        policy_categories (
          id,
          name,
          description
        )
      `)
      .eq("id", policy_id)
      .single();

    if (policyError || !policy) {
      console.error("[generate-policy-embedding] Policy not found:", policyError);
      return new Response(
        JSON.stringify({ error: `Policy not found: ${policy_id}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Fetch policy documents (prioritizing eligibility_criteria)
    const { data: docs, error: docsError } = await supabase
      .from("policy_documents")
      .select("id, filename, file_path, document_type")
      .eq("policy_id", policy_id);

    if (docsError) {
      console.warn("[generate-policy-embedding] Warning reading policy documents:", docsError);
    }

    // Prioritize eligibility_criteria documents, fallback to terms_and_conditions or other
    const eligibilityDocs = (docs || []).filter((d) => d.document_type === "eligibility_criteria");
    const targetDocs = eligibilityDocs.length > 0 ? eligibilityDocs : (docs || []);

    console.log(
      `[generate-policy-embedding] Found ${docs?.length || 0} policy documents (${eligibilityDocs.length} eligibility_criteria)`
    );

    // 4. Download document contents if present
    const inlineParts = [];
    for (const doc of targetDocs.slice(0, 3)) {
      try {
        console.log(`[generate-policy-embedding] Downloading storage doc: ${doc.file_path}`);
        const { data: fileBlob, error: downloadError } = await supabase.storage
          .from("policy-documents")
          .download(doc.file_path);

        if (downloadError || !fileBlob) {
          console.warn(`[generate-policy-embedding] Could not download ${doc.file_path}:`, downloadError);
          continue;
        }

        const base64 = await blobToBase64(fileBlob);
        const mimeType = doc.filename.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : doc.filename.toLowerCase().endsWith(".png")
          ? "image/png"
          : doc.filename.toLowerCase().endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";

        inlineParts.push({
          inline_data: {
            mime_type: mimeType,
            data: base64,
          },
        });
      } catch (docErr) {
        console.warn(`[generate-policy-embedding] Error processing doc ${doc.file_path}:`, docErr);
      }
    }

    // 5. Ask Gemini for a dense structured summary of criteria
    const categoryName = policy.policy_categories?.name || policy.category || "General Insurance";
    const promptText = `You are an expert insurance underwriting analyst. Analyze the following insurance policy details and any attached eligibility documents.

POLICY METADATA:
- Name: ${policy.name}
- Category: ${categoryName}
- Description: ${policy.description || "N/A"}

TASK:
Generate a concise, dense, structured summary (3 to 5 sentences) specifically covering:
1. Category & target audience: Who this policy is designed for.
2. Age range requirements or limits (e.g. minimum and maximum entry age).
3. Income thresholds, employment status, or financial criteria if specified.
4. Key exclusions, medical criteria, or high-risk underwriting conditions.
5. Core coverage benefits and general fit.

CRITICAL REQUIREMENTS:
- Do NOT output markdown headers, bullet points, introductory phrases ("Here is a summary:"), or legal boilerplate.
- Output ONLY the single cohesive, dense paragraph of factual summary text optimized for vector similarity matching.`;

    const summaryParts = [...inlineParts, { text: promptText }];

    const MODELS = [
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
    ];
    let summaryText = "";
    const debugLogs = [];

    for (const model of MODELS) {
      try {
        debugLogs.push(`Calling ${model}...`);
        const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const genRes = await fetch(genUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: summaryParts }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 2048,
              thinkingConfig: {
                thinkingLevel: "low",
              },
            },
          }),
        });

        if (genRes.ok) {
          const genData = await genRes.json();
          const candidateParts = genData?.candidates?.[0]?.content?.parts || [];
          let extractedText = "";
          for (const part of candidateParts) {
            if (part.text && !part.thought) {
              extractedText += part.text;
            }
          }
          summaryText = extractedText.trim();
          if (summaryText) {
            debugLogs.push(`✓ Success with ${model}`);
            break;
          } else {
            debugLogs.push(`${model} returned empty parts: ${JSON.stringify(genData)}`);
          }
        } else {
          const errText = await genRes.text();
          debugLogs.push(`${model} HTTP ${genRes.status}: ${errText}`);
        }
      } catch (genErr: any) {
        debugLogs.push(`${model} Exception: ${genErr?.message || String(genErr)}`);
      }
    }

    // Fallback if Gemini generation failed
    if (!summaryText) {
      summaryText = `${policy.name} is a ${categoryName} insurance policy. ${policy.description || ""}. Provides comprehensive insurance coverage subject to verified applicant identity, proof of income, and standard underwriting guidelines.`.trim();
      debugLogs.push("Used fallback summary text");
    }

    console.log(`[generate-policy-embedding] Summary text: "${summaryText.slice(0, 120)}..."`);

    // Helper to normalize vector to unit length
    function normalizeVector(vec: number[]): number[] {
      const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
      if (norm === 0) return vec;
      return vec.map((val) => val / norm);
    }

    // 6. Generate vector embedding using Gemini embedding API
    const EMBED_MODELS = ["gemini-embedding-001", "embedding-001"];
    let embeddingVector: number[] | null = null;
    let lastEmbedError = "";

    for (const embedModel of EMBED_MODELS) {
      try {
        console.log(`[generate-policy-embedding] Calling ${embedModel} endpoint...`);
        const embedUrl = `https://generativelanguage.googleapis.com/v1beta/models/${embedModel}:embedContent?key=${GEMINI_API_KEY}`;
        const embedRes = await fetch(embedUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: `models/${embedModel}`,
            content: {
              parts: [{ text: summaryText }],
            },
            outputDimensionality: 768,
          }),
        });

        if (embedRes.ok) {
          const embedData = await embedRes.json();
          const rawVector = embedData?.embedding?.values;
          if (Array.isArray(rawVector) && rawVector.length > 0) {
            const targetVec = rawVector.length > 768 ? rawVector.slice(0, 768) : rawVector;
            embeddingVector = normalizeVector(targetVec);
            console.log(
              `[generate-policy-embedding] ✓ Successfully received vector with ${embeddingVector.length} dimensions from ${embedModel}`
            );
            break;
          }
        } else {
          lastEmbedError = await embedRes.text();
          console.warn(`[generate-policy-embedding] ${embedModel} failed with HTTP ${embedRes.status}: ${lastEmbedError}`);
        }
      } catch (err: any) {
        lastEmbedError = err?.message || String(err);
        console.warn(`[generate-policy-embedding] Error calling ${embedModel}:`, err);
      }
    }

    if (!embeddingVector) {
      console.error("[generate-policy-embedding] Failed to generate embedding from all models:", lastEmbedError);
      return new Response(
        JSON.stringify({ error: `Embedding generation failed: ${lastEmbedError}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Upsert into policy_embeddings table
    const { data: upsertData, error: upsertError } = await supabase
      .from("policy_embeddings")
      .upsert(
        {
          policy_id: policy.id,
          summary_text: summaryText,
          embedding: embeddingVector,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "policy_id" }
      )
      .select("id, policy_id, summary_text, updated_at")
      .single();

    if (upsertError) {
      console.error("[generate-policy-embedding] Failed to upsert policy embedding:", upsertError);
      return new Response(
        JSON.stringify({ error: `Database upsert failed: ${upsertError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[generate-policy-embedding] ✓ Successfully upserted policy embedding row: ${upsertData.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        policy_id: policy.id,
        policy_name: policy.name,
        summary_text: summaryText,
        dimensions: embeddingVector.length,
        updated_at: upsertData.updated_at,
        debug_log: debugLogs,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[generate-policy-embedding] Unhandled exception:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
