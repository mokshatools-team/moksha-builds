---
name: Email templates are hardcoded, not Claude-generated — Loric provided exact wording
description: quote_send emails use 8 exact templates (Informal/Formal × Declared/Cash × EN/FR). No Claude API call. Loric provided the exact phrasing. Other scenarios still use Claude.
type: feedback
---

**Rule:** For quote_send scenario, use hardcoded templates — NOT Claude generation. Loric provided the exact wording for all 8 variations. Templates are editable by the user before sending.

**Why:** Claude-generated drafts were inconsistent, sometimes corporate-sounding, and burned API tokens unnecessarily. The templates are Loric's actual voice.

**Variables filled in:**
- `[first name]` / `[prénom]` — from client name
- `[brief project description]` — from scope summary
- Signature: signer name + "Pour OstéoPeinture" + phone (Loric only)

**Key differences between templates:**
- **Declared:** mentions signed quote + deposit by e-transfer to info@osteopeinture.com
- **Cash:** says "reach out directly when ready to move forward" (no mention of deposit/e-transfer)
- **Informal:** tu-form FR, casual EN, sign-off "Au plaisir" / "Talk soon"
- **Formal:** vous-form FR, professional EN, sign-off "Cordialement" / "Kind regards"

**Tone dropdown:** Informal / Formal only (Familiar was removed).
**Payment Type:** auto-detected from job record; manual dropdown for sessions.

**Templates live in:** `server.js` inside the `/api/email/standalone-draft` endpoint, in the `if (scenario === 'quote_send')` block.
