// @ts-nocheck
// =============================================================
// InsuranceAI — policy-advisor-chat Edge Function
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Canonical list of document types required for every submission on InsuranceAI.
 * Kept in sync with `REQUIRED_DOC_TYPES` in `src/lib/submissions.js` and the check constraint on `submission_documents`.
 */
const REQUIRED_DOCUMENT_TYPES = [
  { type: "id_proof", label: "Government ID Proof", hint: "passport, driver's licence, national ID" },
  { type: "medical_report", label: "Recent Medical Report", hint: "health checkup, doctor certificate" },
  { type: "income_proof", label: "Income Proof", hint: "salary slip, ITR/tax return, bank statement" },
  { type: "age_proof", label: "Age Proof", hint: "birth certificate, school certificate, passport" },
] as const;

const REQUIRED_DOCUMENTS_FORMATTED = REQUIRED_DOCUMENT_TYPES.map(
  (d, i) => `  ${i + 1}. ${d.label} (e.g. ${d.hint})`
).join("\n");

/**
 * Helper to decode base64 string to Uint8Array for Supabase storage upload.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert a Blob to base64 string.
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

/**
 * Convert a Uint8Array to base64 string.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Determine if message indicates an explicit fresh policy recommendation request.
 * Only triggers the heavy multimodal path when:
 * (a) a new file is attached to this specific message, OR
 * (b) the message explicitly asks for a new or updated recommendation.
 * Follow-ups (e.g. "why", "what does that mean", "can you explain", "why am I not suitable")
 * use the conversational multi-turn chat path without re-fetching documents.
 */
function isRecommendationIntent(msg: string, hasAttachment: boolean): boolean {
  if (hasAttachment) return true;

  const trimmed = msg.trim().toLowerCase();
  if (!trimmed) return false;

  // Follow-up / clarifying questions about previous answers
  const followUpStarters = [
    "why",
    "what does that mean",
    "can you explain",
    "could you explain",
    "please explain",
    "explain that",
    "explain why",
    "how come",
    "tell me more",
    "what do you mean",
    "why was",
    "why is",
    "why am i",
    "why are",
    "why can't",
    "why cant",
  ];

  const isClarification = followUpStarters.some(
    (starter) => trimmed.startsWith(starter) || trimmed.includes(` ${starter}`)
  );

  // Explicit new/updated recommendation or comparison requests
  const explicitNewSearchKeywords = [
    "find me a policy",
    "find a policy",
    "find policies",
    "search again",
    "check again",
    "recheck",
    "check other",
    "what else is available",
    "what else do you have",
    "other options",
    "other policies",
    "another policy",
    "compare my options",
    "compare options",
    "compare policies",
    "compare all policies",
    "recommend a policy",
    "recommend policies",
    "recommend the best policy",
    "recommend me a policy",
    "suggest a policy",
    "suggest best policy",
    "suggest policies",
    "suggest another policy",
    "which policy should i choose",
    "which policy should i apply",
    "which policy is best for me",
    "what policy is best for me",
    "choose a policy for me",
  ];

  const hasExplicitSearch = explicitNewSearchKeywords.some((kw) => trimmed.includes(kw));

  if (isClarification && !hasExplicitSearch) {
    return false;
  }

  return hasExplicitSearch;
}

Deno.serve(async (req: Request) => {
  // ── 0. Handle CORS Preflight ───────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── 1. Authenticate caller ─────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return Response.json(
        { error: "Unauthorized: Missing or invalid Authorization header" },
        { status: 401, headers: corsHeaders }
      );
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return Response.json(
        { error: "Unauthorized: Invalid token" },
        { status: 401, headers: corsHeaders }
      );
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 2. Parse request (Supports both JSON and multipart/form-data) ──
    let conversationId: string | null = null;
    let message: string = "";
    let attachmentData: {
      filename: string;
      bytes: Uint8Array;
      mimeType: string;
    } | null = null;

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      conversationId = (formData.get("conversation_id") as string) || null;
      message = ((formData.get("message") as string) || "").trim();

      const file = formData.get("file") as File | null;
      if (file && file.size > 0) {
        const arrayBuffer = await file.arrayBuffer();
        attachmentData = {
          filename: file.name,
          bytes: new Uint8Array(arrayBuffer),
          mimeType: file.type || "application/octet-stream",
        };
      }
    } else {
      const body = await req.json();
      conversationId = body.conversation_id || null;
      message = (body.message || "").trim();

      if (body.attachment && body.attachment.base64 && body.attachment.filename) {
        attachmentData = {
          filename: body.attachment.filename,
          bytes: base64ToUint8Array(body.attachment.base64),
          mimeType: body.attachment.mime_type || "application/octet-stream",
        };
      }
    }

    if (!message && !attachmentData) {
      return Response.json(
        { error: "Bad Request: message or attachment is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // ── 3. Verify or Create Conversation ───────────────────────
    if (conversationId) {
      // Check existing conversation and verify ownership
      const { data: conv, error: convError } = await adminClient
        .from("chat_conversations")
        .select("id, client_id, title")
        .eq("id", conversationId)
        .single();

      if (convError || !conv) {
        return Response.json(
          { error: `Conversation not found: ${conversationId}` },
          { status: 404, headers: corsHeaders }
        );
      }

      if (conv.client_id !== user.id) {
        console.warn(
          `[policy-advisor-chat] 403 Forbidden: user ${user.id} does not own conversation ${conversationId}`
        );
        return Response.json(
          { error: "Forbidden: You do not have permission to access this conversation" },
          { status: 403, headers: corsHeaders }
        );
      }
    } else {
      // Create new conversation for this client
      const initialTitle = message
        ? message.length > 50
          ? `${message.substring(0, 47)}...`
          : message
        : attachmentData?.filename || "New Conversation";

      const { data: newConv, error: createConvErr } = await adminClient
        .from("chat_conversations")
        .insert([{ client_id: user.id, title: initialTitle }])
        .select()
        .single();

      if (createConvErr || !newConv) {
        console.error("[policy-advisor-chat] Failed to create conversation:", createConvErr);
        return Response.json(
          { error: "Failed to create conversation", details: createConvErr?.message },
          { status: 500, headers: corsHeaders }
        );
      }

      conversationId = newConv.id;
    }

    // ── 4. Upload Attachment if provided ──────────────────────
    let savedAttachment: any = null;
    if (attachmentData) {
      const sanitizedFilename = attachmentData.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${conversationId}/${Date.now()}_${sanitizedFilename}`;

      const { error: uploadErr } = await adminClient.storage
        .from("chat-attachments")
        .upload(storagePath, attachmentData.bytes, {
          contentType: attachmentData.mimeType,
          upsert: false,
        });

      if (uploadErr) {
        console.error("[policy-advisor-chat] Failed to upload attachment:", uploadErr);
        return Response.json(
          { error: "Failed to upload attachment", details: uploadErr.message },
          { status: 500, headers: corsHeaders }
        );
      }

      // Record in chat_attachments table
      const { data: attachRow, error: attachDbErr } = await adminClient
        .from("chat_attachments")
        .insert([
          {
            conversation_id: conversationId,
            file_path: storagePath,
            filename: attachmentData.filename,
          },
        ])
        .select()
        .single();

      if (attachDbErr) {
        console.error("[policy-advisor-chat] Failed to insert attachment row:", attachDbErr);
      } else {
        savedAttachment = attachRow;
      }
    }

    // ── 5. Insert User Message ─────────────────────────────────
    const userMsgContent = message || (attachmentData ? `[Uploaded file: ${attachmentData.filename}]` : "");
    const userStoredContent = attachmentData
      ? `${userMsgContent}\n<!--ATTACHMENT:${JSON.stringify({
          filename: attachmentData.filename,
          file_path: savedAttachment?.file_path || "",
          id: savedAttachment?.id || "",
        })}-->`
      : userMsgContent;

    const { error: userMsgErr } = await adminClient.from("chat_messages").insert([
      {
        conversation_id: conversationId,
        role: "user",
        content: userStoredContent,
      },
    ]);

    if (userMsgErr) {
      console.error("[policy-advisor-chat] Failed to insert user message:", userMsgErr);
      return Response.json(
        { error: "Failed to save message", details: userMsgErr.message },
        { status: 500, headers: corsHeaders }
      );
    }

    // ── 6. Gemini AI Call (Phase 3 Q&A + Phase 4 Policy Recommendations) ──
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    let assistantReply = "";
    let publishedPolicies: any[] = [];

    if (!GEMINI_API_KEY) {
      console.error("[policy-advisor-chat] GEMINI_API_KEY not configured");
      assistantReply =
        "The AI advisor service is currently not configured with an API key. Please contact support.";
    } else {
      // Determine if this turn triggers the heavy policy recommendation comparison
      const isRecommendation = isRecommendationIntent(message, !!attachmentData);

      // Fetch entire conversation history for context memory
      const { data: convHistory } = await adminClient
        .from("chat_messages")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      let geminiPayload: any;

      if (isRecommendation) {
        console.log(`[policy-advisor-chat] Triggering Phase 4 Policy Recommendation path...`);

        // Fetch all published policies
        const { data: pubPolicies } = await adminClient
          .from("policies")
          .select("id, name, description, category")
          .eq("status", "published");
        publishedPolicies = pubPolicies || [];

        const pubPolicyIds = publishedPolicies.map((p) => p.id);
        let pubPolicyDocs: any[] = [];
        if (pubPolicyIds.length > 0) {
          const { data: pDocs } = await adminClient
            .from("policy_documents")
            .select("id, policy_id, filename, file_path, document_type")
            .in("policy_id", pubPolicyIds);
          pubPolicyDocs = pDocs || [];
        }

        // Build current turn parts
        const currentTurnParts: any[] = [];

        // Add Catalog Summary with direct markdown links
        let catalogText = "=== OFFICIAL PUBLISHED POLICIES CATALOG ===\n";
        for (const p of publishedPolicies) {
          catalogText += `• Policy: "${p.name}" (ID: ${p.id})\n  Category: ${p.category}\n  Description: ${p.description || "N/A"}\n  Direct Link: [Apply for ${p.name}](/client/policies/${p.id})\n\n`;
        }
        currentTurnParts.push({ text: catalogText });

        // Map policy IDs to names for labeling
        const policyNameMap = Object.fromEntries(
          publishedPolicies.map((p) => [p.id, p.name])
        );

        // Download and attach official policy PDFs
        for (const doc of pubPolicyDocs) {
          try {
            const { data: fileBlob, error: dlErr } = await adminClient.storage
              .from("policy-documents")
              .download(doc.file_path);

            if (!dlErr && fileBlob) {
              const b64 = await blobToBase64(fileBlob);
              const pName = policyNameMap[doc.policy_id] || doc.policy_id;
              currentTurnParts.push({
                text: `[Official Policy Document for "${pName}" (Policy ID: ${doc.policy_id}): "${doc.filename}" (type: ${doc.document_type})]`,
              });
              currentTurnParts.push({
                inline_data: {
                  mime_type: fileBlob.type || "application/pdf",
                  data: b64,
                },
              });
            }
          } catch (docErr) {
            console.warn(`[policy-advisor-chat] Could not load policy doc ${doc.filename}:`, docErr);
          }
        }

        // Attach client's uploaded document if provided in this turn
        if (attachmentData) {
          currentTurnParts.push({
            text: `=== APPLICANT'S UPLOADED DOCUMENT: "${attachmentData.filename}" ===`,
          });
          currentTurnParts.push({
            inline_data: {
              mime_type: attachmentData.mimeType,
              data: uint8ArrayToBase64(attachmentData.bytes),
            },
          });
        }

        currentTurnParts.push({
          text: `=== APPLICANT'S REQUEST / SITUATION ===\n${userMsgContent}\n\nINSTRUCTIONS FOR THIS RESPONSE:\n1. STRICT HARD-CONSTRAINT CHECK: Before recommending any policy, check all hard criteria in the policy documents (especially age limits, medical exclusions, and income thresholds) against the applicant's uploaded documents and details.\n2. DO NOT recommend a policy if the applicant violates a hard rule (e.g. if the policy requires age 18-60, but the applicant's age proof shows they are outside that range). Explicitly state the disqualifying reason and policy rule instead.\n3. If eligible, recommend the policy with plain-language reasoning and copy its EXACT link from the catalog above: [Apply for <Policy Name>](/client/policies/<policy_id>).\n4. MANDATORY LINK RULE: After your preliminary guidance disclaimer, if a policy is recommended, you MUST provide the direct clickable link to apply, e.g.:\n"To get an official eligibility decision, submit an application on the [Apply for <Policy Name>](/client/policies/<policy_id>) page." NEVER end a message with "detail page:" without the markdown link!\n5. Append CHAT_TITLE: <3 to 6 words> on its own line summarizing the consultation topic for the sidebar.\n6. Append the structured list at the very end on a new line: RECOMMENDED_POLICY_IDS: [<policy_id>, ...] or RECOMMENDED_POLICY_IDS: [] if none qualify.`,
        });

        // Build multi-turn history excluding the current turn (since we provide currentTurnParts)
        const priorContents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
        const priorMsgs = (convHistory || []).slice(0, -1);

        for (const msg of priorMsgs) {
          const geminiRole = msg.role === "assistant" ? "model" : "user";
          const lastItem = priorContents[priorContents.length - 1];
          if (lastItem && lastItem.role === geminiRole) {
            lastItem.parts.push({ text: msg.content });
          } else {
            priorContents.push({
              role: geminiRole,
              parts: [{ text: msg.content }],
            });
          }
        }

        while (priorContents.length > 0 && priorContents[0].role === "model") {
          priorContents.shift();
        }

        priorContents.push({
          role: "user",
          parts: currentTurnParts,
        });

        const RECOMMENDATION_SYSTEM_PROMPT = `You are an expert insurance policy advisor for InsuranceAI.
Your goal is to provide accurate, honest, and trustworthy guidance to applicants based on our official published policies.

CRITICAL ELIGIBILITY RULES & CONSTRAINTS:
1. STRICT HARD-CONSTRAINT VERIFICATION:
   - Before recommending ANY policy, you MUST strictly check all hard eligibility constraints specified in the official policy documents (such as age limits e.g. 18-60 years, minimum income thresholds, pre-existing condition exclusions, waiting periods, geographic restrictions, or required documentation).
   - Carefully inspect the applicant's uploaded documents (e.g., date of birth/age in age proofs or IDs, medical records, income proof) or stated details against these exact rules.

2. DO NOT RECOMMEND INELIGIBLE POLICIES AS A FIT:
   - If the applicant's documents or profile clearly VIOLATES a hard constraint of a policy (for example, if the policy requires age 18-60, but the applicant's age proof shows they are outside that range, or if they have an explicitly excluded condition):
     • You must NOT recommend that policy as an eligible or suitable option.
     • You must clearly and explicitly explain why they do not meet the eligibility requirements for that policy, citing the specific rule violated (e.g. "Policy X requires applicants to be between 18 and 60 years old, but your age proof shows you are outside this range").
     • Warn the applicant that an application for this policy would likely be rejected due to this blocking criterion.

3. IF AN APPLICANT MEETS ALL ELIGIBILITY CRITERIA:
   - Recommend the matching policy (or policies) with plain-language reasoning citing how their profile satisfies the criteria.
   - Mention the policy using its exact markdown link format: [Policy Name](/client/policies/<policy_id>).

4. IF NO POLICIES MATCH OR APPLICANT IS DISQUALIFIED ACROSS ALL POLICIES:
   - State clearly and empathetically that based on the provided documents and criteria, none of the currently published policies appear to be a match for their profile.
   - Detail the specific disqualifying factors (such as age limit or exclusion).

5. CRITICAL DISCLAIMER:
   - Always remind the applicant that this is a preliminary guidance assessment based on the available documents, not a binding underwriting decision.

6. MANDATORY CALL TO ACTION (only when a viable policy is recommended):
   - Conclude your recommendation with the official next step:
     "To get an official eligibility decision, please submit an application for this policy on its detail page: [Apply for <Policy Name>](/client/policies/<policy_id>)"
   - If no policies are recommended due to ineligibility, advise them on alternative steps or contacting an administrator instead of directing them to apply for an ineligible policy.

7. STRUCTURED RECOMMENDED POLICY IDS (MANDATORY FORMAT):
   - At the absolute end of your response, on its own line, you MUST append:
     RECOMMENDED_POLICY_IDS: [<uuid_1>, <uuid_2>]
   - ONLY include a policy ID in this list if the applicant actually qualifies and meets all hard criteria, and you are explicitly recommending it as a good fit.
   - If no policies qualify, or if the applicant is ineligible/disqualified for all published policies, you MUST output:
     RECOMMENDED_POLICY_IDS: []
   - NEVER put a policy ID in RECOMMENDED_POLICY_IDS if you only mentioned it to explain why the applicant is NOT eligible.

8. FORMATTING & PRESENTATION GUIDELINES:
   - Use clean, well-spaced Markdown.
   - Use bold section headers (e.g. "**Ineligibility Assessment Details**" or "**Alternative Next Steps**") instead of raw hashtags (do NOT write "###" or "####").
   - NEVER enclose your conversational response in code block quotes or backticks (do NOT output "'''" or "\`\`\`").
   - For lists, always use a bullet followed by a space (e.g. "• ") so items format properly.
   - Always format policy links cleanly as [Policy Name](/client/policies/<policy_id>), using relative paths only (never full localhost or domain URLs). Do not put unclosed bold markers around links.

9. INITIAL EVALUATION VS FOLLOW-UP QUESTIONS:
   - The full structured breakdown (Policy / Requirement Violated / Policy Criterion / Applicant Details / Assessment / Alternative Steps) is strictly reserved for an INITIAL recommendation or rejection response.
   - For follow-up questions about a decision you already explained, answer conversationally and briefly — a sentence or two — and do NOT repeat the full structured breakdown unless the user explicitly asks you to re-explain it in full detail.

10. INSURANCEAI PLATFORM GROUNDING & REQUIRED DOCUMENTS:
   - When asked about required documents, the application process, or how eligibility works on InsuranceAI, answer based ONLY on how InsuranceAI actually works, not general insurance industry practices.
   - This platform requires exactly these ${REQUIRED_DOCUMENT_TYPES.length} document types for every application:
${REQUIRED_DOCUMENTS_FORMATTED}
   - No address proof or other document types are collected by InsuranceAI. Never state that address proof is required.
   - If a user asks a broader conceptual question (e.g. "what's a co-payment") that isn't about this platform specifically, general insurance knowledge is fine — but anything about what THIS app requires or how it works must reflect the actual implementation, not generic assumptions.

11. CONVERSATION SIDEBAR TITLE / SHORT DESCRIPTION (MANDATORY FORMAT):
    - At the end of your response, on its own line, you MUST provide a concise 3 to 6 word title or short description summarizing the topic of this consultation based on the user's initial inquiry or situation, suitable for display in the sidebar chat list (e.g. "CHAT_TITLE: Senior Health Policy Assessment", "CHAT_TITLE: Family Term Plan Search", "CHAT_TITLE: Individual Health Policy Fit").
    - Format: CHAT_TITLE: <3 to 6 words>
    - Keep it clean, descriptive, title-cased, and without quotes or trailing punctuation.`;

        geminiPayload = {
          system_instruction: {
            parts: [{ text: RECOMMENDATION_SYSTEM_PROMPT }],
          },
          contents: priorContents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            thinkingConfig: {
              thinkingLevel: "low",
            },
          },
        };
      } else {
        // Fast Phase 3 text-only multi-turn path
        const geminiContents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

        for (const msg of convHistory || []) {
          const geminiRole = msg.role === "assistant" ? "model" : "user";
          const lastItem = geminiContents[geminiContents.length - 1];

          if (lastItem && lastItem.role === geminiRole) {
            lastItem.parts.push({ text: msg.content });
          } else {
            geminiContents.push({
              role: geminiRole,
              parts: [{ text: msg.content }],
            });
          }
        }

        while (geminiContents.length > 0 && geminiContents[0].role === "model") {
          geminiContents.shift();
        }

        if (geminiContents.length === 0) {
          geminiContents.push({ role: "user", parts: [{ text: userMsgContent }] });
        }

        const SYSTEM_PROMPT = `You are an expert insurance policy advisor for InsuranceAI. You are chatting with an applicant.

CONCISE & FAST RESPONSES (STRICT REQUIREMENT):
• Keep your answers SHORT, PUNCHY, and CONCISE (under 80 to 120 words total).
• Never output long multi-section guides, excessive bullet points, or walls of text.
• For insurance concept questions (e.g. "deductible vs copay", "what is a premium"):
  - Explain each term in 1-2 plain-language sentences with a quick everyday example.
  - Conclude with a 1-sentence bottom line comparing them.
  - Total length should be 3-5 sentences maximum.
• For follow-up questions about a previous decision or guidance:
  - Answer directly and conversationally in 1-3 sentences.
• Never output raw markdown hashtags (#, ##) and never output code fences. Use bold text for key terms.

INSURANCEAI PLATFORM GROUNDING & REQUIRED DOCUMENTS:
• When asked about required documents or platform rules, reflect InsuranceAI requirements (${REQUIRED_DOCUMENT_TYPES.length} document types: ${REQUIRED_DOCUMENT_TYPES.map(d => d.label).join(', ')}). No address proof is needed.

CONVERSATION SIDEBAR TITLE (MANDATORY):
• At the end of your response, on its own line, append:
CHAT_TITLE: <3 to 6 words>
• Keep it clean, descriptive, title-cased, and without quotes, asterisks, or trailing punctuation.`;

        geminiPayload = {
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: geminiContents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096,
            thinkingConfig: {
              thinkingLevel: "low",
            },
          },
        };
      }

      const MODELS = [
        "gemini-3.6-flash",
        "gemini-3.5-flash",
      ];
      let lastStatus = 0;
      let lastErrBody = "";

      for (const model of MODELS) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        // Clone payload for this model so thinkingConfig is not mutated for subsequent models
        const currentPayload = JSON.parse(JSON.stringify(geminiPayload));

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            console.log(`[policy-advisor-chat] Requesting ${model} (attempt ${attempt}/2)...`);
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(currentPayload),
            });

            if (res.ok) {
              const geminiData = await res.json();
              assistantReply =
                geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
              console.log(`[policy-advisor-chat] ✓ Got response from ${model}`);
              break;
            }

            lastStatus = res.status;
            lastErrBody = await res.text();
            console.warn(`[policy-advisor-chat] ${model} attempt ${attempt} → HTTP ${res.status}`);

            // If thinkingConfig is rejected by this model version, strip it for this model only
            if (res.status === 400 && currentPayload.generationConfig?.thinkingConfig) {
              console.log(`[policy-advisor-chat] Retrying ${model} without thinkingConfig...`);
              delete currentPayload.generationConfig.thinkingConfig;
              continue;
            }

            if (res.status === 503 || res.status === 429) {
              await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
              continue;
            }
            break;
          } catch (netErr: any) {
            lastErrBody = netErr.message;
            console.warn(`[policy-advisor-chat] Network error on ${model}:`, netErr.message);
          }
        }
        if (assistantReply) break;
      }

      if (!assistantReply) {
        console.error(
          `[policy-advisor-chat] All Gemini models failed. Last status: ${lastStatus}:`,
          lastErrBody
        );
        assistantReply =
          "I apologize, but I am having trouble connecting to the advisory service at this moment. Please try again shortly.";
      }
    }

    // Extract recommended_policy_ids from assistant response if present
    let recommendedPolicyIds: string[] = [];
    const recTagRegex = /(?:\r?\n|^)\s*(?:\*\*)?RECOMMENDED_POLICY_IDS(?:\*\*)?:\s*(\[[^\]]*\]|[^\r\n]*)/i;
    const recMatch = assistantReply.match(recTagRegex);

    if (recMatch) {
      const rawMatchContent = recMatch[1] || "";
      // Extract UUIDs from the bracketed or raw string
      const uuidMatches = rawMatchContent.match(/[a-f0-9-]{36}/gi) || [];
      // Deduplicate and ensure they exist in published policies
      const validPublishedIds = new Set((publishedPolicies || []).map((p: any) => p.id));
      recommendedPolicyIds = Array.from(
        new Set(uuidMatches.filter((id: string) => validPublishedIds.has(id)))
      );

      // Strip the tag line from user-facing assistant reply
      assistantReply = assistantReply.replace(recTagRegex, "").trim();
    }

    // ── Safety net & auto-repair for policy recommendations ──
    // Ensure publishedPolicies is loaded
    if (!publishedPolicies || publishedPolicies.length === 0) {
      const { data: pubPolicies } = await adminClient
        .from("policies")
        .select("id, name, description, category")
        .eq("status", "published");
      publishedPolicies = pubPolicies || [];
    }

    const replyLower = assistantReply.toLowerCase();
    for (const p of publishedPolicies) {
      if (
        (p.name && replyLower.includes(p.name.toLowerCase())) ||
        replyLower.includes(p.id.toLowerCase())
      ) {
        if (!recommendedPolicyIds.includes(p.id)) {
          recommendedPolicyIds.push(p.id);
        }
      }
    }

    // Auto-repair missing links or sentences ending with "detail page:"
    for (const policyId of recommendedPolicyIds) {
      const policy = publishedPolicies.find((p: any) => p.id === policyId);
      if (!policy) continue;

      const linkUrl = `/client/policies/${policy.id}`;
      if (!assistantReply.includes(linkUrl)) {
        if (/detail page:\s*$/i.test(assistantReply)) {
          assistantReply = assistantReply.replace(
            /detail page:\s*$/i,
            `detail page: [Apply for ${policy.name}](${linkUrl})`
          );
        } else {
          assistantReply += `\n\n👉 [Apply for ${policy.name}](${linkUrl})`;
        }
      }
    }

    // Fallback: If assistant ends with "detail page:" but no policy was matched yet, use first published policy
    if (/detail page:\s*$/i.test(assistantReply) && publishedPolicies.length > 0) {
      const firstPolicy = publishedPolicies[0];
      assistantReply = assistantReply.replace(
        /detail page:\s*$/i,
        `detail page: [Apply for ${firstPolicy.name}](/client/policies/${firstPolicy.id})`
      );
      if (!recommendedPolicyIds.includes(firstPolicy.id)) {
        recommendedPolicyIds.push(firstPolicy.id);
      }
    }

    // Extract chat_title from assistant response if present
    let chatTitle: string | null = null;
    const titleTagRegex = /(?:\r?\n|^)\s*(?:\*\*)?CHAT_TITLE(?:\*\*)?:\s*([^\r\n]+)/i;
    const titleMatch = assistantReply.match(titleTagRegex);

    if (titleMatch) {
      let extractedTitle = (titleMatch[1] || "").trim();
      // Remove any surrounding quotes, asterisks, markdown hashes, or trailing punctuation
      extractedTitle = extractedTitle.replace(/^["'`*#]+|["'`*#.,;:]+$/g, "").trim();
      if (extractedTitle.length > 0) {
        chatTitle = extractedTitle.length > 55 ? extractedTitle.slice(0, 52) + "..." : extractedTitle;
      }
      // Strip CHAT_TITLE tag from user-facing assistant reply so it never leaks into chat bubble
      assistantReply = assistantReply.replace(titleTagRegex, "").trim();
    }

    // Persist recommended_policy_ids via trailing comment metadata if any
    const storedContent =
      recommendedPolicyIds.length > 0
        ? `${assistantReply}\n<!--RECOMMENDED_POLICIES:${JSON.stringify(recommendedPolicyIds)}-->`
        : assistantReply;

    // Insert real assistant response into database
    const { error: assistantMsgErr } = await adminClient.from("chat_messages").insert([
      {
        conversation_id: conversationId,
        role: "assistant",
        content: storedContent,
      },
    ]);

    if (assistantMsgErr) {
      console.error("[policy-advisor-chat] Failed to insert assistant message:", assistantMsgErr);
      return Response.json(
        { error: "Failed to save assistant response", details: assistantMsgErr.message },
        { status: 500, headers: corsHeaders }
      );
    }

    // Update conversation timestamp and title (if AI generated a new short description)
    const updateConvPayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (chatTitle) {
      updateConvPayload.title = chatTitle;
    }

    await adminClient
      .from("chat_conversations")
      .update(updateConvPayload)
      .eq("id", conversationId);

    // ── 7. Fetch full updated message history & attachments ────
    const { data: allMessages } = await adminClient
      .from("chat_messages")
      .select("id, conversation_id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    const { data: allAttachments } = await adminClient
      .from("chat_attachments")
      .select("id, conversation_id, file_path, filename, uploaded_at")
      .eq("conversation_id", conversationId)
      .order("uploaded_at", { ascending: true });

    // Sanitize messages, extract recommended_policy_ids and attachment info
    const attachmentsPool = [...(allAttachments || [])];

    const sanitizedMessages = (allMessages || []).map((m: any) => {
      let content = m.content || "";
      let recIds: string[] = [];
      let attachmentName = "";
      let attachmentPath = "";

      // 1. Check embedded RECOMMENDED_POLICIES
      const recMatch = content.match(/<!--RECOMMENDED_POLICIES:(.*?)-->/);
      if (recMatch) {
        try {
          recIds = JSON.parse(recMatch[1]);
        } catch {
          // ignore
        }
        content = content.replace(/<!--RECOMMENDED_POLICIES:.*?-->/, "").trim();
      }

      // 2. Check embedded ATTACHMENT
      const attMatch = content.match(/<!--ATTACHMENT:(.*?)-->/);
      if (attMatch) {
        try {
          const parsedAtt = JSON.parse(attMatch[1]);
          attachmentName = parsedAtt.filename || "";
          attachmentPath = parsedAtt.file_path || "";
        } catch {
          // ignore
        }
        content = content.replace(/<!--ATTACHMENT:.*?-->/, "").trim();
      }

      // 3. Clean up any leftover CHAT_TITLE tag
      content = content.replace(/(?:\r?\n|^)\s*(?:\*\*)?CHAT_TITLE(?:\*\*)?:\s*[^\r\n]+/gi, "").trim();

      // 4. Fallback for legacy messages: match closest chat_attachment for user messages
      if (!attachmentName && m.role === "user" && attachmentsPool.length > 0) {
        const msgTime = new Date(m.created_at).getTime();
        const matchIdx = attachmentsPool.findIndex((att: any) => {
          const attTime = new Date(att.uploaded_at).getTime();
          return Math.abs(msgTime - attTime) <= 15000;
        });

        if (matchIdx !== -1) {
          const matched = attachmentsPool.splice(matchIdx, 1)[0];
          attachmentName = matched.filename;
          attachmentPath = matched.file_path;
        }
      }

      return {
        ...m,
        content,
        attachmentName: attachmentName || undefined,
        attachmentPath: attachmentPath || undefined,
        recommended_policy_ids: recIds,
      };
    });

    return Response.json(
      {
        conversation_id: conversationId,
        conversation_title: chatTitle || undefined,
        recommended_policy_ids: recommendedPolicyIds,
        messages: sanitizedMessages,
        attachments: allAttachments || [],
        latest_attachment: savedAttachment,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (err: any) {
    console.error("[policy-advisor-chat] Unexpected error:", err);
    return Response.json(
      { error: "Internal server error", details: err?.message },
      { status: 500, headers: corsHeaders }
    );
  }
});
