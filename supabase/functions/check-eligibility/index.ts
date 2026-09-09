// @ts-nocheck
// =============================================================
// InsuranceAI — check-eligibility Edge Function
// Phase 3: Gemini AI call + structured JSON output
// =============================================================

import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server";

// The system prompt that tells Gemini exactly what to do and how to format its response.
const SYSTEM_PROMPT = `You are an expert insurance eligibility analyst. Your job is to carefully analyze policy documents and client-submitted documents to determine whether the client is eligible for the insurance policy.

INSTRUCTIONS:
1. Read ALL policy documents thoroughly. Identify EVERY eligibility rule, requirement, condition, exclusion, age limit, income threshold, waiting period, geographic restriction, and any other criterion mentioned.
2. Read ALL client documents thoroughly. Extract all relevant personal information (name, age, DOB, income, medical history, address, ID details, etc.).
3. Check EACH policy rule against the client's documents. For every rule you identify, determine whether the client satisfies it, violates it, or if the evidence is unclear.
4. Return your analysis as ONLY a valid JSON object — no markdown, no prose, no code fences, no explanation outside the JSON.

IMPORTANT RULES:
- List EVERY rule you checked in the "reasons" array, not just failures. This must be fully auditable.
- If a rule is clearly violated (e.g., age outside range, income below threshold, excluded medical condition), mark status as "violated" and severity as "blocking".
- If a rule has a minor concern but isn't a hard disqualifier, mark status as "violated" and severity as "warning".
- If a rule is satisfied, mark status as "satisfied" with severity as null.
- If you can't determine whether a rule is satisfied from the provided documents, mark status as "unclear" and severity as "warning".
- If ANY rule has severity "blocking", the verdict MUST be "not_eligible".
- If no rules are "blocking" but some are "unclear" or "warning", the verdict should be "needs_review".
- Only if ALL rules are "satisfied" should the verdict be "eligible".
- confidence_score should reflect how confident you are in the overall assessment (0-100).

REQUIRED JSON OUTPUT FORMAT (return ONLY this, nothing else):
{
  "verdict": "eligible | not_eligible | needs_review",
  "confidence_score": 0-100,
  "summary": "1-2 sentence plain-language explanation of the overall result",
  "reasons": [
    {
      "rule_checked": "plain-language description of the policy rule",
      "policy_source": "which policy document and section/page this rule came from",
      "status": "satisfied | violated | unclear",
      "client_evidence": "what in the client's documents supports or contradicts this rule, or null if not found",
      "severity": "blocking | warning | null"
    }
  ]
}`;

/**
 * Convert a Blob to a base64-encoded string for Gemini inline_data.
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
 * Try to parse Gemini's response text as JSON.
 * Strips markdown code fences if present, then attempts JSON.parse.
 */
function parseGeminiJSON(text: string): any {
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    // Remove opening fence (with optional language tag)
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "");
    // Remove closing fence
    cleaned = cleaned.replace(/\n?\s*```\s*$/, "");
  }
  return JSON.parse(cleaned);
}

/**
 * Validate the parsed result has the expected shape.
 */
function validateResult(result: any): boolean {
  if (!result || typeof result !== "object") return false;
  if (!["eligible", "not_eligible", "needs_review"].includes(result.verdict)) return false;
  if (!Array.isArray(result.reasons)) return false;
  if (typeof result.summary !== "string") return false;
  return true;
}

export default {
  fetch: withSupabase(
    { auth: ["user", "secret"] },
    async (req: Request, ctx: any) => {
      try {
        // ── 1. Parse input ──────────────────────────────────────
        const { submission_id } = await req.json();

        if (!submission_id) {
          return Response.json(
            { error: "Missing required field: submission_id" },
            { status: 400 }
          );
        }

        const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
        if (!GEMINI_API_KEY) {
          console.error("[check-eligibility] GEMINI_API_KEY not set");
          return Response.json(
            { error: "GEMINI_API_KEY secret is not configured" },
            { status: 500 }
          );
        }

        console.log(`[check-eligibility] Starting for submission: ${submission_id}`);

        const supabase = ctx.supabaseAdmin;

        // ── 2. Fetch the submission ─────────────────────────────
        const { data: submission, error: subError } = await supabase
          .from("client_submissions")
          .select("id, client_id, policy_id, status")
          .eq("id", submission_id)
          .single();

        if (subError || !submission) {
          console.error("[check-eligibility] Submission fetch error:", subError);
          return Response.json(
            { error: `Submission not found: ${submission_id}` },
            { status: 404 }
          );
        }

        // ── 3. Verify caller authorization ──────────────────────
        // If called by an authenticated user, verify caller owns this submission
        if (ctx.authMode === "user") {
          const callerId = ctx.userClaims?.id || ctx.jwtClaims?.sub;
          if (!callerId || callerId !== submission.client_id) {
            console.warn(
              `[check-eligibility] 403 Forbidden: caller ${callerId} does not match submission owner ${submission.client_id}`
            );
            return Response.json(
              { error: "Forbidden: You do not have permission to check this submission" },
              { status: 403 }
            );
          }
        } else if (ctx.authMode !== "secret") {
          return Response.json(
            { error: "Forbidden: Unauthorized access mode" },
            { status: 403 }
          );
        }

        // ── 4. Set status to 'processing' ───────────────────────
        const { error: statusError } = await supabase
          .from("client_submissions")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .eq("id", submission_id);

        if (statusError) {
          console.error("[check-eligibility] Failed to set processing status:", statusError);
        }

        // ── 4. Fetch document metadata ──────────────────────────
        const { data: policyDocs, error: pdError } = await supabase
          .from("policy_documents")
          .select("id, file_path, filename, document_type")
          .eq("policy_id", submission.policy_id);

        if (pdError) {
          console.error("[check-eligibility] Policy documents fetch error:", pdError);
          return Response.json(
            { error: "Failed to fetch policy documents" },
            { status: 500 }
          );
        }

        const { data: clientDocs, error: cdError } = await supabase
          .from("submission_documents")
          .select("id, file_path, filename, document_type")
          .eq("submission_id", submission_id);

        if (cdError) {
          console.error("[check-eligibility] Submission documents fetch error:", cdError);
          return Response.json(
            { error: "Failed to fetch submission documents" },
            { status: 500 }
          );
        }

        console.log(
          `[check-eligibility] Found ${policyDocs?.length ?? 0} policy doc(s), ${clientDocs?.length ?? 0} client doc(s)`
        );

        // ── 5. Download files and build Gemini parts ────────────
        const parts: any[] = [];

        // Add a text label before policy documents
        parts.push({
          text: "=== POLICY DOCUMENTS (official insurance policy rules) ===",
        });

        for (const doc of policyDocs ?? []) {
          console.log(`[check-eligibility] Downloading policy doc: ${doc.filename}`);
          const { data: fileData, error: dlError } = await supabase.storage
            .from("policy-documents")
            .download(doc.file_path);

          if (dlError || !fileData) {
            console.error(`[check-eligibility] Failed to download ${doc.filename}:`, dlError);
            return Response.json(
              { error: `Failed to download policy document: ${doc.filename}` },
              { status: 500 }
            );
          }

          // Label this document
          parts.push({
            text: `[Policy Document: "${doc.filename}" — type: ${doc.document_type}]`,
          });

          // Add the PDF as inline data
          const base64 = await blobToBase64(fileData);
          parts.push({
            inline_data: {
              mime_type: fileData.type || "application/pdf",
              data: base64,
            },
          });
        }

        // Add a text label before client documents
        parts.push({
          text: "\n=== CLIENT DOCUMENTS (applicant's personal documents to verify) ===",
        });

        for (const doc of clientDocs ?? []) {
          console.log(`[check-eligibility] Downloading client doc: ${doc.filename}`);
          const { data: fileData, error: dlError } = await supabase.storage
            .from("client-documents")
            .download(doc.file_path);

          if (dlError || !fileData) {
            console.error(`[check-eligibility] Failed to download ${doc.filename}:`, dlError);
            return Response.json(
              { error: `Failed to download client document: ${doc.filename}` },
              { status: 500 }
            );
          }

          parts.push({
            text: `[Client Document: "${doc.filename}" — type: ${doc.document_type}]`,
          });

          const base64 = await blobToBase64(fileData);
          parts.push({
            inline_data: {
              mime_type: fileData.type || "application/pdf",
              data: base64,
            },
          });
        }

        // Add the final instruction
        parts.push({
          text: "\n=== TASK ===\nAnalyze the policy documents above and check the client's documents against every eligibility rule. Return ONLY valid JSON in the exact format specified in your instructions. Do not include any text outside the JSON.",
        });

        // ── 6. Call Gemini (Fast direct call with single fallback) ──
        console.log("[check-eligibility] Calling Gemini API...");

        const geminiPayload = {
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            thinkingConfig: {
              thinkingLevel: "low",
            },
          },
        };

        let geminiData: any = null;
        let lastStatus = 0;
        let lastErrBody = "";
        const MODELS = [
          "gemini-3.6-flash",
          "gemini-3.5-flash",
        ];

        for (const model of MODELS) {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
          const currentPayload = JSON.parse(JSON.stringify(geminiPayload));
          // Only retry on 503 (overloaded), max 2 attempts per model
          for (let attempt = 1; attempt <= 2; attempt++) {
            console.log(`[check-eligibility] Requesting ${model} (attempt ${attempt}/2)...`);
            try {
              const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(currentPayload),
              });

              if (res.ok) {
                geminiData = await res.json();
                console.log(`[check-eligibility] ✓ Got response from ${model}`);
                break;
              }

              lastStatus = res.status;
              lastErrBody = await res.text();
              console.warn(`[check-eligibility] ${model} attempt ${attempt} → HTTP ${res.status}`);

              // If thinkingConfig is rejected by this model version, remove it for this model only
              if (res.status === 400 && currentPayload.generationConfig?.thinkingConfig) {
                console.log(`[check-eligibility] Retrying ${model} without thinkingConfig...`);
                delete currentPayload.generationConfig.thinkingConfig;
                continue;
              }

              // Only retry on 503 (overloaded) or 429 (rate limit)
              if (res.status === 503 || res.status === 429) {
                await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
                continue;
              }

              // Any other error (400, 404, etc): skip to next model immediately
              break;
            } catch (networkErr: any) {
              lastErrBody = networkErr.message;
              console.warn(`[check-eligibility] Network error on ${model}:`, networkErr.message);
            }
          }

          if (geminiData) break;
        }

        if (!geminiData) {
          console.error(
            `[check-eligibility] All Gemini models failed. Last status: ${lastStatus}:`,
            lastErrBody
          );

          let parsedErrMsg = "";
          try {
            const parsed = JSON.parse(lastErrBody);
            parsedErrMsg = parsed?.error?.message || "";
          } catch {
            parsedErrMsg = lastErrBody.substring(0, 150);
          }

          const fallbackResult = {
            verdict: "needs_review" as const,
            confidence_score: 0,
            summary: `AI processing failed (HTTP ${lastStatus || 500}${parsedErrMsg ? `: ${parsedErrMsg}` : ""}). This submission requires manual review.`,
            reasons: [],
          };

          await saveResult(supabase, submission_id, fallbackResult);

          return Response.json(
            { ...fallbackResult, _error: `Gemini API returned ${lastStatus}: ${lastErrBody}` },
            { status: 200 }
          );
        }

        const rawText =
          geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

        console.log("[check-eligibility] Gemini raw response length:", rawText.length);
        console.log("[check-eligibility] Gemini raw response (first 500 chars):", rawText.substring(0, 500));

        // ── 7. Parse and validate the response ──────────────────
        let eligibilityResult: any;

        try {
          eligibilityResult = parseGeminiJSON(rawText);
        } catch (parseErr: any) {
          console.error("[check-eligibility] JSON parse failed:", parseErr.message);
          console.error("[check-eligibility] Raw text was:", rawText);

          eligibilityResult = {
            verdict: "needs_review",
            confidence_score: 0,
            summary: `AI returned a response that could not be parsed as valid JSON. Manual review required. Parse error: ${parseErr.message}`,
            reasons: [],
          };
        }

        // Validate shape
        if (!validateResult(eligibilityResult)) {
          console.error("[check-eligibility] Result failed shape validation:", eligibilityResult);
          eligibilityResult = {
            verdict: "needs_review",
            confidence_score: 0,
            summary: `AI returned JSON but it didn't match the expected format. Manual review required.`,
            reasons: [],
          };
        }

        // Clamp confidence score
        if (typeof eligibilityResult.confidence_score === "number") {
          eligibilityResult.confidence_score = Math.max(
            0,
            Math.min(100, Math.round(eligibilityResult.confidence_score))
          );
        } else {
          eligibilityResult.confidence_score = null;
        }

        console.log(
          `[check-eligibility] Verdict: ${eligibilityResult.verdict}, Confidence: ${eligibilityResult.confidence_score}, Rules checked: ${eligibilityResult.reasons.length}`
        );

        // ── 8. Save result to database & audit log ─────────────
        const previousStatus = submission.status;
        await saveResult(supabase, submission_id, eligibilityResult, previousStatus);

        console.log("[check-eligibility] ✓ Done. Result saved and audit logged.");

        return Response.json(eligibilityResult, { status: 200 });
      } catch (err: any) {
        console.error("[check-eligibility] Unexpected error:", err);
        return Response.json(
          { error: "Internal server error", details: err.message },
          { status: 500 }
        );
      }
    }
  ),
};

/**
 * Save the eligibility result to the database and update submission status.
 */
async function saveResult(
  supabase: any,
  submissionId: string,
  result: {
    verdict: string;
    confidence_score: number | null;
    summary: string;
    reasons: any[];
  },
  previousStatus?: string | null
) {
  // Upsert into eligibility_results (UNIQUE on submission_id handles re-runs)
  const { error: insertError } = await supabase
    .from("eligibility_results")
    .upsert(
      {
        submission_id: submissionId,
        verdict: result.verdict,
        confidence_score: result.confidence_score,
        summary: result.summary,
        reasons: result.reasons,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "submission_id" }
    );

  if (insertError) {
    console.error("[check-eligibility] Failed to insert eligibility_result:", insertError);
  }

  // Update client_submissions.status to match the verdict
  const { error: updateError } = await supabase
    .from("client_submissions")
    .update({
      status: result.verdict,
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  if (updateError) {
    console.error("[check-eligibility] Failed to update submission status:", updateError);
  }

  // Insert audit log entry for this AI verdict
  const { error: auditError } = await supabase
    .from("audit_log")
    .insert({
      submission_id: submissionId,
      action: "ai_verdict",
      previous_status: previousStatus || null,
      new_status: result.verdict,
      reason: null,
      performed_by: null,
    });

  if (auditError) {
    console.error("[check-eligibility] Failed to insert ai_verdict into audit_log:", auditError);
  }
}
