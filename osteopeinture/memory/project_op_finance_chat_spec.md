---
name: OP Finance Chat — Build Spec Reference
description: Location and key decisions for the finance chat conversational interface build spec
type: reference
---

**Spec file:** `docs/OP-FINANCE-CHAT-SPEC.md` in MOKSHA BUILDS repo

**Key decisions recorded in spec:**
- Stack: FastAPI + gspread + Claude Sonnet + single HTML file
- 5 MVP transaction types: supplies, owner draws, transfers, revenue, worker payments
- Claude extracts facts (tool_use schema), deterministic rules do accounting
- Job aliases: "Murray Hill" → KENNERKNECHT_01, "Chaut"/"Laval" → CHAUT_01, etc.
- Every row gets entry_id (UUID) + created_at for future Postgres migration
- iOS patterns copied from quote-assistant (dvh, safe-area-inset, PWA meta tags)
- Env vars: ANTHROPIC_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEET_ID, APP_PIN

**How to apply:** Read this spec before every finance chat build session. It's the source of truth for architecture, rules, and session plan.
