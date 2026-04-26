# CONTEXT — OstéoPeinture

OstéoPeinture is a Quebec residential/commercial painting company (société en nom collectif) with four partners: Loric, Graeme, Lubo, and BOSS. Primary income source for the MOKSHA collective.

## Active builds

| Build | Folder | Status (from CONTEXT.md) |
|-------|--------|--------------------------|
| **OP Hub (Quote Assistant)** | `quote-assistant/` | Deployed at https://op-quote-assistant.up.railway.app — chat-based quoting, draft editor, PDF rendering, job management, email drafting, scaffold module, 28 tests passing. Next: test draft editor on iPhone PWA. |
| **Finance System** | `finance-system/` | Google Sheets double-entry ledger with 13 tabs, 155 transactions. Opening balances wrong (blocked on Loric finalizing 2025 ledger). Conversational interface not yet built. |

## Spec docs

Design specs and build plans live in `osteopeinture/docs/`:
- `OSTEOP-BUILD-ECOSYSTEM-OVERVIEW.md` — macro module map and sequencing
- `SUPABASE-MIGRATION-SPEC.md` — Phase 0 migration (completed)
- `OP-FINANCE-MASTER-PLAN.md` — finance system master plan
- `OP-JOB-MANAGEMENT-SPEC.md` — Jibble + invoice spec
- `OP-FINANCE-CHAT-SPEC.md` — conversational interface spec
- `OP-HUB-DATA-REQUIREMENTS.md` — data layer requirements
- `SESSION-PROMPT-DATA-LAYER.md` — session prompt data layer

## Memory

Project memory: `osteopeinture/memory/` *(create when needed — not yet created)*

Each build has its own CONTEXT.md and JOURNAL.md — read them before working on that build.
