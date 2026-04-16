---
name: Email drafts need Claude-generation, not templates — top priority for next session
description: User rejected hardcoded scenario bodies as unnatural and templated. Rewrite to use Claude for initial draft generation, not just refinement.
type: project
---

**Problem (2026-04-15):** Loric tested the email drafting (both session-based and standalone from job) and found the output "really sucks, arent natural at all."

**Root cause:** `buildScenarioBody()` in server.js uses hardcoded French/English paragraphs per scenario (quote_send, quote_revision, quote_follow_up, quote_promise, decline, lead_more_info, lead_follow_up, project_update). They're pre-written templates that can't adapt to the specific context, relationship, or history with the client.

**What exists:**
- `EMAIL_LOGIC.md` — the tone/scenario/signer rules (good, keep)
- `POST /api/email/standalone-refine` — already uses Claude for refinement (good pattern)
- `POST /api/email/standalone-draft` — currently calls `buildScenarioBody()` (the problem)

**The fix:** rewrite `/api/email/standalone-draft` and the session-based draft generation to:
1. Pass EMAIL_LOGIC.md as system prompt context
2. Pass the session/job data (client, address, scope, recent conversation)
3. Pass the scenario + signer + language + detail level as user instructions
4. Let Claude write the draft naturally, with access to quoting context for specificity

**Nice to have (for later):** scrape past sent emails from Gmail (the April 1 spec exists but was never run) so Claude learns the actual tone from real history. For now, EMAIL_LOGIC.md + live context is enough.

**Next session:** rewrite the email draft endpoints to generate via Claude, then test quote_send in French on FICCA_04 or HETU_01.
