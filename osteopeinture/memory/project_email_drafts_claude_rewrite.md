---
name: Email drafts now Claude-generated and tone-matched to past emails (DONE)
description: Email draft generator now produces natural Loric-voice drafts via Claude + 3 real past sent emails as tone references. Replaces the rejected template-based drafts.
type: project
---

**Status (2026-04-16): SHIPPED — both phases complete.**

**Phase 1 — Claude generation (earlier April 2026):** `/api/email/standalone-draft` rewritten to use Claude with EMAIL_LOGIC.md as system prompt + scenario/signer/language/tone as user instructions. Replaced the hardcoded `buildScenarioBody()` templates that Loric had called "translated-sounding."

**Phase 2 — Past-email tone matching (2026-04-16):** Added 193 real past sent emails to Supabase `past_emails` table (98 EN / 92 FR / 3 unknown), tagged by signer + scenario + language at import. The standalone-draft endpoint now fetches 3 matching examples and injects them as `<example>` blocks in the Claude prompt so output matches actual OstéoPeinture phrasing.

**Files:**
- `server.js` `getPastEmailExamples(signer, scenario, language, limit)` — 3-tier fallback: signer+scenario+lang → signer+lang → scenario+lang+other-signer
- `server.js` standalone-draft: tone-reference block wrapped in `<example>` delimiters with REFERENCE-ONLY guard against prompt injection
- `scripts/import-past-emails.js` — idempotent UPSERT, signer/scenario/language classifiers
- Source: `past-quotes/email-history/messages.json` (847 messages scraped April 1, 197 sent, 193 with body >50 chars)

**Verified live (op-quote-assistant.up.railway.app):**
- FR: "Salut X, Voici la soumission. Hésite pas si tu as des ajustements à faire. Fais-moi signe quand tu es prêt à aller de l'avant avec le dépôt…"
- EN: "Hi X, Here's the quote attached. Let me know if anything needs adjusting…"

**Commit:** `63f1b5e`

**Future enhancement (not blocking):** the scenario classifier in import-past-emails.js is keyword-based and coarse (~40% of emails are tagged `other`). Could be re-tagged via a Claude pass for better matching, but current distribution already gives Loric+quote_send 11 FR + 20 EN examples — plenty for the 3-example injection.
