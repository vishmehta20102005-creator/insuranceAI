# InsuranceAI — Build Prompt for Lovable

Paste this whole document into Lovable as your initial project prompt. It's structured the way Lovable parses best: a clear app summary up top, then concrete screens/data/logic it can scaffold directly, rather than vague product language.

---

## App Summary

Build a web app called **InsuranceAI**. It has two user roles:

1. **Admin (insurance company staff)** — uploads and manages official policy documents (eligibility criteria, terms & conditions, exclusions) for different insurance policies.
2. **Client (applicant)** — uploads their own personal documents (ID proof, medical records, income proof, etc.) against a specific policy, and the app uses AI to check whether they're eligible for that policy based on the official policy rules.

The core value: instead of a human manually cross-checking a client's paperwork against a 40-page policy document, the AI reads both and returns a clear **eligible / not eligible** verdict with the *specific reasons* — quoting which policy clause was violated and which part of the client's document caused it.

---

## User Roles & Permissions

| Role | Can do |
|---|---|
| Admin | Upload/edit/delete policy documents, create policies, view all client submissions, view audit log |
| Client | Sign up, view available policies, upload their documents against a policy, view their own eligibility results and history |

Use standard email/password auth with role-based access (Admin vs Client). Admins should be invite-only or manually promoted — don't let clients self-register as Admin.

---

## Core Data Model

**Policy**
- `id`, `name`, `description`, `category` (health / life / vehicle / travel etc.), `created_by` (admin), `created_at`
- `status`: draft / published / archived

**PolicyDocument**
- `id`, `policy_id` (FK), `file_url`, `filename`, `document_type` (e.g. "terms_and_conditions", "eligibility_criteria", "exclusions"), `uploaded_at`
- One policy can have multiple documents (T&C, eligibility rules, exclusions list, etc.)

**ClientSubmission**
- `id`, `client_id` (FK), `policy_id` (FK), `submitted_at`
- `status`: pending / processing / eligible / not_eligible / needs_review

**ClientDocument**
- `id`, `submission_id` (FK), `file_url`, `filename`, `document_type` (e.g. "id_proof", "medical_report", "income_proof", "age_proof"), `uploaded_at`

**EligibilityResult**
- `id`, `submission_id` (FK)
- `verdict`: eligible / not_eligible / needs_manual_review
- `confidence_score` (optional, 0-100)
- `reasons`: array of objects, each with:
  - `rule_violated` (plain-language description of the policy clause)
  - `policy_source` (which policy document + page/section it came from)
  - `client_evidence` (what in the client's document caused the mismatch, with filename/page)
  - `severity`: blocking / warning (blocking = disqualifies, warning = flag for human review)
- `summary` (1-2 sentence plain-language explanation of the overall verdict)
- `generated_at`

---

## Screens to Build

### Admin side
1. **Admin Dashboard** — list of all policies, quick stats (total submissions, pending reviews, eligibility approval rate)
2. **Policy Management** — create/edit a policy, upload its documents (multi-file upload), tag each document by type
3. **Submissions Review** — table of all client submissions across policies, filterable by status/policy, click into any submission to see the AI's full reasoning and manually override the verdict if needed
4. **Audit Log** — timestamped record of every AI verdict and any manual overrides, for compliance

### Client side
1. **Policy Browser** — list of published policies the client can apply to, with short descriptions
2. **Document Upload** — for a chosen policy, upload required documents (show a checklist of what's needed per policy, e.g. "ID Proof", "Medical Report", "Income Proof")
3. **Eligibility Result** — after processing, show:
   - Clear verdict banner (Eligible / Not Eligible / Needs Review)
   - If not eligible: a list of specific reasons, each showing the policy rule and what in their document didn't match, in plain non-legal language
   - Option to re-upload corrected documents and resubmit
4. **Submission History** — client's past submissions and their outcomes

---

## Core AI Logic (the actual feature)

When a client submits documents against a policy, the app must:

1. **Extract text from all policy documents** for that policy (eligibility criteria, T&C, exclusions) — these may be scanned PDFs or native text PDFs, so extraction needs to handle both.
2. **Extract text from all client documents** the same way.
3. **Send both sets of extracted content to an LLM** with a structured prompt that asks it to:
   - Identify every eligibility rule in the policy documents (age limits, pre-existing condition exclusions, income thresholds, required document types, geographic restrictions, etc.)
   - Check the client's documents against each rule
   - For every rule that is NOT satisfied, explain specifically why, citing the exact policy clause and the exact conflicting detail in the client's document
   - Return a structured verdict (not just prose) so the app can render it in the UI — request JSON output from the LLM matching the `EligibilityResult` shape above
4. **Never let the AI say "eligible" with no supporting checks shown** — every verdict should list which rules were checked, not just the failures. This is important for trust and for audit purposes in an insurance context.
5. If the AI's confidence is low, or a rule is ambiguous, mark the submission `needs_manual_review` instead of forcing a hard eligible/not_eligible call — route it to the Admin's Submissions Review queue.

---

## Important Non-Functional Requirements

- **This handles sensitive personal and medical data.** Documents must be stored securely (not publicly readable URLs), and access must be scoped so a client can only ever see their own submissions, never another client's.
- **Every AI verdict must be explainable and traceable** — store which policy document version and which client document version produced each result, so a verdict can be defended later if the client disputes it.
- **Do not auto-reject silently.** A "not eligible" result should always be reviewable by a human admin before it's treated as final in any real insurance workflow — build the override capability from day one, not as an afterthought.
- Keep the UI calm and clear, not alarming — a "not eligible" result should read like a helpful explanation, not a rejection notice.

---

## Suggested Build Order (tell Lovable to build in this sequence)

1. Auth + role-based access (Admin vs Client)
2. Policy creation + document upload (Admin)
3. Client policy browsing + document upload
4. AI eligibility check pipeline (document extraction → LLM call → structured result)
5. Eligibility result screen (Client) + Submissions review screen (Admin)
6. Manual override + audit log
7. Submission history for clients

---

*Note: this is a starting spec, not a finished one. Expect to refine the exact rule-extraction prompt and the document types once you see how Lovable's AI handles your first real policy PDF — insurance eligibility logic (waiting periods, riders, co-payment clauses) gets nuanced fast, and the prompt will likely need a few iterations against real documents before verdicts are reliable enough to trust.*
