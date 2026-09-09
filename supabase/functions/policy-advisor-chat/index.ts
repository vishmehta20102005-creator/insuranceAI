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
    let attachmentsList: Array<{
      filename: string;
      bytes: Uint8Array;
      mimeType: string;
    }> = [];

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      conversationId = (formData.get("conversation_id") as string) || null;
      message = ((formData.get("message") as string) || "").trim();

      const files = formData.getAll("files") as File[];
      const singleFile = formData.get("file") as File | null;
      const allFormFiles = files.length > 0 ? files : (singleFile ? [singleFile] : []);

      for (const file of allFormFiles) {
        if (file && file.size > 0) {
          const arrayBuffer = await file.arrayBuffer();
          attachmentsList.push({
            filename: file.name,
            bytes: new Uint8Array(arrayBuffer),
            mimeType: file.type || "application/octet-stream",
          });
        }
      }
    } else {
      const body = await req.json();
      conversationId = body.conversation_id || null;
      message = (body.message || "").trim();

      if (Array.isArray(body.attachments)) {
        for (const att of body.attachments) {
          if (att.base64 && att.filename) {
            attachmentsList.push({
              filename: att.filename,
              bytes: base64ToUint8Array(att.base64),
              mimeType: att.mime_type || "application/octet-stream",
            });
          }
        }
      } else if (body.attachment && body.attachment.base64 && body.attachment.filename) {
        attachmentsList.push({
          filename: body.attachment.filename,
          bytes: base64ToUint8Array(body.attachment.base64),
          mimeType: body.attachment.mime_type || "application/octet-stream",
        });
      }
    }

    if (!message && attachmentsList.length === 0) {
      return Response.json(
        { error: "Bad Request: message or document attachment is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // ── Document upload limits & size caps (Strict performance protection) ──
    const MAX_DOCS = 5;
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file
    const MAX_TOTAL_SIZE = 15 * 1024 * 1024; // 15MB total

    if (attachmentsList.length > MAX_DOCS) {
      return Response.json(
        { error: `Maximum ${MAX_DOCS} documents can be uploaded at once. Please select fewer documents.` },
        { status: 400, headers: corsHeaders }
      );
    }

    let totalUploadBytes = 0;
    for (const att of attachmentsList) {
      if (att.bytes.length > MAX_FILE_SIZE) {
        return Response.json(
          { error: `File "${att.filename}" exceeds the 5MB size limit (${(att.bytes.length / (1024 * 1024)).toFixed(1)}MB). Please upload files under 5MB each.` },
          { status: 400, headers: corsHeaders }
        );
      }
      totalUploadBytes += att.bytes.length;
    }

    if (totalUploadBytes > MAX_TOTAL_SIZE) {
      return Response.json(
        { error: `Total upload size exceeds 15MB limit (${(totalUploadBytes / (1024 * 1024)).toFixed(1)}MB). Please compress your documents before uploading.` },
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
        : attachmentsList.length > 0
          ? `${attachmentsList.length} Uploaded Doc${attachmentsList.length > 1 ? 's' : ''}`
          : "New Conversation";

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

    // ── 4. Upload Attachments if provided ──────────────────────
    const savedAttachments: any[] = [];
    for (const att of attachmentsList) {
      const sanitizedFilename = att.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${conversationId}/${Date.now()}_${sanitizedFilename}`;

      const { error: uploadErr } = await adminClient.storage
        .from("chat-attachments")
        .upload(storagePath, att.bytes, {
          contentType: att.mimeType,
          upsert: false,
        });

      if (uploadErr) {
        console.warn("[policy-advisor-chat] Failed to upload attachment:", att.filename, uploadErr);
        continue;
      }

      // Record in chat_attachments table
      const { data: attachRow, error: attachDbErr } = await adminClient
        .from("chat_attachments")
        .insert([
          {
            conversation_id: conversationId,
            file_path: storagePath,
            filename: att.filename,
          },
        ])
        .select()
        .single();

      if (attachDbErr) {
        console.warn("[policy-advisor-chat] Failed to insert attachment row:", attachDbErr);
      } else if (attachRow) {
        savedAttachments.push(attachRow);
      }
    }

    // ── 5. Insert User Message ─────────────────────────────────
    let userMsgContent = message;
    if (attachmentsList.length > 0) {
      const docListStr = `[Uploaded ${attachmentsList.length} document${attachmentsList.length > 1 ? 's' : ''}: ${attachmentsList.map(a => a.filename).join(', ')}]`;
      userMsgContent = message ? `${message}\n${docListStr}` : docListStr;
    }

    const userStoredContent = savedAttachments.length > 0
      ? `${userMsgContent}\n<!--ATTACHMENTS:${JSON.stringify(
          savedAttachments.map((sa) => ({
            filename: sa.filename,
            file_path: sa.file_path,
            id: sa.id,
          }))
        )}-->\n<!--ATTACHMENT:${JSON.stringify({
          filename: savedAttachments[0].filename,
          file_path: savedAttachments[0].file_path,
          id: savedAttachments[0].id,
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
      const isRecommendation = isRecommendationIntent(message, attachmentsList.length > 0);

      // Fetch entire conversation history for context memory
      const { data: convHistory } = await adminClient
        .from("chat_messages")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      let geminiPayload: any;
      let isInvalidDocument = false;
      let invalidDocType = "";

      // ── Fast Document Pre-Check for Attachments ──
      if (attachmentsList.length > 0) {
        console.log(`[policy-advisor-chat] Fast pre-checking ${attachmentsList.length} uploaded file(s)...`);
        try {
          const preCheckParts: any[] = [];
          for (let i = 0; i < attachmentsList.length; i++) {
            const att = attachmentsList[i];
            preCheckParts.push({
              text: `=== Document ${i + 1} of ${attachmentsList.length}: "${att.filename}" ===`,
            });
            preCheckParts.push({
              inline_data: {
                mime_type: att.mimeType,
                data: uint8ArrayToBase64(att.bytes),
              },
            });
          }

          preCheckParts.push({
            text: `You are an intake document classifier for InsuranceAI.
Evaluate these ${attachmentsList.length} uploaded document(s) against insurance underwriting standards.

ACCEPTED INSURANCE APPLICATION DOCUMENTS (ONLY THESE):
1. Government Photo ID (Passport, Driver's License, Aadhaar, Voter ID, PAN Card)
2. Age Proof (Birth Certificate, 10th Class Board Passing Certificate with explicit Date of Birth, Passport)
3. Income Proof (Official Salary Slips from employer, Form 16, ITR / Income Tax Return)
4. Medical / Health Diagnostic Report (< 12 months, hospital or pathology lab report)
5. Existing Insurance Policy Document

NOT ACCEPTED / INVALID / UNRELATED DOCUMENTS:
- Academic records: University / College Marksheets, Semester Grade Cards, Academic Transcripts, Degrees, Diplomas, Course Completion Certificates, Student IDs, Homework (academic marksheets do NOT verify age, income, or medical eligibility for insurance underwriting)
- Receipts & bills: Restaurant menus, food delivery receipts, grocery bills, retail invoices, utility bills
- Personal media: Personal selfies, pet photos, vehicle photos, landscape photos, memes, wallpapers
- Generic documents: Resumes, CVs, letters, random notes, contracts unrelated to insurance

Determine if ALL uploaded documents are invalid/unaccepted for insurance verification.
If at least one valid insurance document is present, set "all_documents_invalid": false.

Return JSON ONLY:
{
  "all_documents_invalid": boolean,
  "detected_types": string[],
  "reason": string
}`,
          });

          const checkPayload = {
            contents: [{ parts: preCheckParts }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 256,
              responseMimeType: "application/json",
              thinkingConfig: { thinkingLevel: "low" },
            },
          };

          const checkRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(checkPayload),
            }
          );

          if (checkRes.ok) {
            const checkData = await checkRes.json();
            const rawText = checkData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawText) {
              const parsed = JSON.parse(rawText);
              if (parsed.all_documents_invalid === true) {
                isInvalidDocument = true;
                invalidDocType = (parsed.detected_types && parsed.detected_types.length > 0)
                  ? parsed.detected_types.join(", ")
                  : "non-insurance document";
                console.log(`[policy-advisor-chat] All ${attachmentsList.length} documents identified as non-insurance: ${invalidDocType}`);
              }
            }
          }
        } catch (checkErr) {
          console.warn("[policy-advisor-chat] Pre-check error (will fallback to normal pipeline):", checkErr);
        }
      }

      if (isInvalidDocument) {
        console.log(`[policy-advisor-chat] Returning upfront rejection for invalid document(s): ${invalidDocType}`);
        assistantReply = `**Eligibility Verdict:**
Not Eligible — The submitted document${attachmentsList.length > 1 ? 's are' : ' is'} not accepted for insurance verification.

**Suitability Assessment:**
• The uploaded document${attachmentsList.length > 1 ? 's appear' : ' appears'} to be **${invalidDocType}**, which cannot be used to verify your identity, age, income, or medical status for insurance underwriting.
• Academic documents (such as university marksheets or college transcripts) do not satisfy underwriting requirements for age, income, or health verification.
• We cannot evaluate or issue an insurance policy based on ${attachmentsList.length > 1 ? 'these documents' : 'this document'}.
• Please upload the required verification documents listed below.

**Required Documents:**
• **Government ID Proof** (Passport, Driver's License, Aadhaar, Voter ID)
• **Recent Medical Report** (< 12 months)
• **Income Proof** (min. INR 25,000/mo net — Salary Slips, Form 16, or ITR)
• **Age Proof** (Birth Certificate, 10th Board Certificate with DOB, or Passport)

CHAT_TITLE: Non-Accepted Document Upload
RECOMMENDED_POLICY_IDS: []`;
      } else if (isRecommendation) {
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

        // Download and attach official policy PDFs concurrently
        const downloadedDocs = await Promise.all(
          pubPolicyDocs.map(async (doc) => {
            try {
              const { data: fileBlob, error: dlErr } = await adminClient.storage
                .from("policy-documents")
                .download(doc.file_path);

              if (!dlErr && fileBlob) {
                const b64 = await blobToBase64(fileBlob);
                const pName = policyNameMap[doc.policy_id] || doc.policy_id;
                return {
                  label: `[Official Policy Document for "${pName}" (Policy ID: ${doc.policy_id}): "${doc.filename}" (type: ${doc.document_type})]`,
                  mimeType: fileBlob.type || "application/pdf",
                  base64: b64,
                };
              }
            } catch (docErr) {
              console.warn(`[policy-advisor-chat] Could not load policy doc ${doc.filename}:`, docErr);
            }
            return null;
          })
        );

        for (const d of downloadedDocs) {
          if (d) {
            currentTurnParts.push({ text: d.label });
            currentTurnParts.push({
              inline_data: {
                mime_type: d.mimeType,
                data: d.base64,
              },
            });
          }
        }

        // Attach client's uploaded documents if provided in this turn
        if (attachmentsList.length > 0) {
          for (let i = 0; i < attachmentsList.length; i++) {
            const att = attachmentsList[i];
            currentTurnParts.push({
              text: `=== APPLICANT'S UPLOADED DOCUMENT ${i + 1} of ${attachmentsList.length}: "${att.filename}" ===`,
            });
            currentTurnParts.push({
              inline_data: {
                mime_type: att.mimeType,
                data: uint8ArrayToBase64(att.bytes),
              },
            });
          }
        }

        currentTurnParts.push({
          text: `=== APPLICANT'S REQUEST / SITUATION ===\n${userMsgContent}\n\nSTRICT INSTRUCTIONS FOR THIS MULTI-DOCUMENT / RECOMMENDATION RESPONSE:\n1. BREVITY & CONCISENESS (MANDATORY): Keep responses short, crisp, and direct (under 140 words total). Avoid long paragraphs, essays, or verbose disclaimers.\n2. DYNAMICALLY STRUCTURE YOUR RESPONSE IN EXACTLY THESE 3 SHORT SECTIONS:\n   **Eligibility Verdict**: 1 clear sentence:\n   • If Full Match: "Eligible for <Policy Name> — All verification requirements satisfied."\n   • If Ineligible: "Not Eligible for <Policy Name> — <Specific rule violated>" (or general if unaccepted document).\n   • If Partial Match (valid documents uploaded, but missing others): "Preliminary Fit for <Policy Name> — <X of 4> requirements verified. Pending remaining documents."\n   **Suitability & Document Verification**:\n   • For each uploaded document, concisely state what it verified:\n     - ID / Age Proof: Verified name, DOB, and age against policy limits.\n     - Income Proof: Verified net monthly income against policy minimum.\n     - Medical Report: Verified health status and absence of exclusion conditions.\n     - Unaccepted documents (marksheet, bill, menu): State that academic records or receipts cannot verify age/income/health for insurance.\n     - Hard rule violation: State the exact document and criterion that caused disqualification (e.g. "Age 65 exceeds maximum limit of 60 years").\n   **Required Documents / Next Steps**:\n   • If applicant uploaded documents and SOME ARE STILL MISSING: Label as **Remaining Documents Needed:** and list ONLY the remaining missing document(s)! (Never re-request documents that were already verified).\n   • If ALL 4 documents are verified and applicant is eligible: Label as **Next Steps:** and instruct them to apply: "All 4 requirements satisfied. To apply, visit [Apply for <Policy Name>](/client/policies/<policy_id>)."\n   • If applicant is ineligible or uploaded only unaccepted documents: Label as **Required Documents:** and list the 4 accepted types.\n3. ZERO RECOMMENDATIONS IF INELIGIBLE: If the applicant violates any hard rule, you MUST output RECOMMENDED_POLICY_IDS: [] and NEVER suggest applying or link to the policy. Suggest contacting support for senior/specialized options instead.\n4. IF ELIGIBLE OR PRELIMINARY FIT: Output RECOMMENDED_POLICY_IDS: [<uuid>].\n5. Append CHAT_TITLE: <3 to 6 words> on its own line.\n6. Append RECOMMENDED_POLICY_IDS: [<uuid>] or RECOMMENDED_POLICY_IDS: [] at the very end.`,
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

        const RECOMMENDATION_SYSTEM_PROMPT = `You are a concise, direct insurance advisor for InsuranceAI.
Your goal is to give brief, clear, and scannable guidance based on our published policies and the applicant's uploaded documents.

CRITICAL BREVITY & STRUCTURE (STRICT):
Keep responses short, clear, and readable (under 140 words). Use exactly 3 short sections:

1. **Eligibility Verdict**: 1 direct sentence:
   • Full Match: "Eligible for <Policy Name> — All verification requirements satisfied."
   • Ineligible: "Not Eligible for <Policy Name> — <Specific rule violated>" (or general if unaccepted document).
   • Partial match (valid document(s) uploaded, but some required documents still missing): "Preliminary Fit for <Policy Name> — <X of 4> requirements verified. Pending remaining documents."

2. **Suitability & Document Verification**:
   • For each uploaded document, concisely state what it verifies:
     - Identity & Age: Verified name, DOB, and age against policy limits (e.g. 18–60).
     - Income Proof: Verified net monthly income against policy minimum (e.g. INR 25,000/mo).
     - Medical Report: Verified health status and absence of exclusion conditions.
     - Unaccepted documents (marksheet, bill, menu): State that academic records or bills cannot verify age/income/health.
     - Hard rule violation: State the exact document and criterion that caused disqualification (e.g. "Age 65 exceeds maximum limit of 60 years. No published policies match this profile.").

3. **Required Documents / Next Steps**:
   • If applicant uploaded documents and SOME ARE MISSING:
     Label as **Remaining Documents Needed:** and list ONLY the remaining document(s) that haven't been provided yet! (Never re-request documents that the applicant already successfully submitted).
   • If NO documents were uploaded yet, or all uploaded documents were unaccepted:
     Label as **Required Documents:** and list the 4 accepted types:
     • Government ID Proof
     • Recent Medical Report (< 12 months)
     • Income Proof (min. INR 25,000/mo net)
     • Age Proof
   • If ALL 4 documents are verified and applicant is eligible:
     Instruct them to proceed to apply: "All 4 requirements satisfied. To apply, visit [Apply for <Policy Name>](/client/policies/<policy_id>)."

MARKDOWN & FORMATTING RULES (STRICT):
- Always use standard double asterisks for bold labels like **Eligibility Verdict:**, **Suitability & Document Verification:**, **Remaining Documents Needed:**, **Required Documents:**.
- NEVER use single asterisks (*) around labels or titles (never write *Applicant Details:* or *Policy:*).
- NEVER leave trailing or dangling asterisks like Word:* or Title*.
- For bullet points, always use bullet dot (• ) or dash (- ).

RECOMMENDATION RULES:
- NON-INSURANCE / UNACCEPTED DOCUMENTS:
  • If the uploaded document is NOT an accepted insurance verification document (e.g. university marksheet, semester grade card, college transcript, diploma, degree, restaurant menu, food bill, grocery receipt, personal photo, selfie, meme):
  • State general ineligibility directly without tying it to any specific policy:
    "**Eligibility Verdict:** Not Eligible — The submitted document is not an accepted document for insurance verification."
  • CRITICAL: NEVER say "You are Not Eligible for the Health policy" or mention any specific policy name (such as Health, Life, or Silver 500) unless the user explicitly requested that named policy in their message.
  • In Suitability Assessment: Explain directly that the document (e.g. university marksheet or college transcript) is an academic record and cannot verify legal identity, age, income, or health status for insurance underwriting. Do NOT evaluate criteria for a specific policy.
  • NEVER output policy links or recommendation cards.
  • List the 4 accepted documents and output RECOMMENDED_POLICY_IDS: []
- If the applicant is INELIGIBLE or NO policy matches:
  • You MUST output RECOMMENDED_POLICY_IDS: []
  • NEVER recommend an ineligible policy, NEVER say it is a preliminary fit, and NEVER tell them to apply for it.
  • Suggest contacting support for custom senior citizen plans instead.
- If the applicant IS FULLY ELIGIBLE:
  • Output RECOMMENDED_POLICY_IDS: [<uuid>]
  • Include the link: "To apply, visit [Apply for <Policy Name>](/client/policies/<policy_id>)."
- If the applicant has a PRELIMINARY FIT (partial valid documents verified, matching so far):
  • Output RECOMMENDED_POLICY_IDS: [<uuid>] so they can preview the policy they are qualifying for.

MANDATORY FOOTERS (at the very end, each on its own line):
CHAT_TITLE: <3 to 6 words>
RECOMMENDED_POLICY_IDS: [<uuid>] or RECOMMENDED_POLICY_IDS: []`;

        geminiPayload = {
          system_instruction: {
            parts: [{ text: RECOMMENDATION_SYSTEM_PROMPT }],
          },
          contents: priorContents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096,
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
• Never output raw markdown hashtags (#, ##) and never output code fences.
• Always use standard double asterisks for bold labels like **Deductible:** or **Copay:**. Never use single asterisks (*) around titles or bold words, and never output dangling asterisks (like *Term:* or Term*).

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

      if (!assistantReply) {
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

    // ── Check if response indicates ineligibility or no match ──
    const replyLower = assistantReply.toLowerCase();
    const isIneligibleOrNoMatch =
      /ineligib|not eligible|do not meet|does not meet|disqualif|exceeds the maximum|exceeds the limit|cannot recommend|no eligible policies|no policies in our current catalog|would be rejected|no policy suiting|exceeds the hard upper limit/i.test(
        replyLower
      );

    if (isIneligibleOrNoMatch) {
      // Applicant is ineligible: MUST NEVER output recommended policy IDs or apply links!
      recommendedPolicyIds = [];
    } else {
      // Applicant is eligible: Auto-repair missing links only for actually qualified policies
      if (!publishedPolicies || publishedPolicies.length === 0) {
        const { data: pubPolicies } = await adminClient
          .from("policies")
          .select("id, name, description, category")
          .eq("status", "published");
        publishedPolicies = pubPolicies || [];
      }

      // If recommendedPolicyIds is empty but applicant is eligible, infer matching policy from text
      if (recommendedPolicyIds.length === 0) {
        for (const policy of publishedPolicies) {
          if (
            replyLower.includes(policy.name.toLowerCase()) ||
            assistantReply.includes(policy.id.substring(0, 16))
          ) {
            recommendedPolicyIds.push(policy.id);
            break;
          }
        }
      }

      // Auto-repair any unclosed or truncated policy links in assistantReply
      for (const policy of publishedPolicies) {
        const partialId = policy.id.substring(0, 16);
        // If there is an unclosed markdown link or truncated UUID
        const truncatedRegex = new RegExp(`\\[([^\\]]+)\\]\\(/client/policies/${partialId}[^)\\s]*\\)?`, "gi");
        assistantReply = assistantReply.replace(truncatedRegex, `[$1](/client/policies/${policy.id})`);

        // If text ends with an unclosed [Apply for <Name>](/client/policies/...
        const trailingTruncated = new RegExp(`\\[([^\\]]+)\\]\\(/client/policies/[^)]*$`, "gm");
        assistantReply = assistantReply.replace(trailingTruncated, `[$1](/client/policies/${policy.id})`);
      }

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

      // 2. Check embedded ATTACHMENTS (multiple) or ATTACHMENT (single)
      let attachmentsListForMsg: any[] = [];
      const multiAttMatch = content.match(/<!--ATTACHMENTS:(.*?)-->/);
      if (multiAttMatch) {
        try {
          attachmentsListForMsg = JSON.parse(multiAttMatch[1]);
        } catch {
          // ignore
        }
        content = content.replace(/<!--ATTACHMENTS:.*?-->/, "").trim();
      }

      const attMatch = content.match(/<!--ATTACHMENT:(.*?)-->/);
      if (attMatch) {
        try {
          const parsedAtt = JSON.parse(attMatch[1]);
          attachmentName = parsedAtt.filename || "";
          attachmentPath = parsedAtt.file_path || "";
          if (attachmentsListForMsg.length === 0) {
            attachmentsListForMsg.push(parsedAtt);
          }
        } catch {
          // ignore
        }
        content = content.replace(/<!--ATTACHMENT:.*?-->/, "").trim();
      }

      if (attachmentsListForMsg.length > 0 && !attachmentName) {
        attachmentName = attachmentsListForMsg[0]?.filename || "";
        attachmentPath = attachmentsListForMsg[0]?.file_path || "";
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
        attachments: attachmentsListForMsg.length > 0 ? attachmentsListForMsg : undefined,
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
        latest_attachment: savedAttachments.length > 0 ? savedAttachments[0] : null,
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
