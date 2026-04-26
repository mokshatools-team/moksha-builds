# Session Prompt: Data Layer Architecture for MOKSHA Builds

## Context

We're at a decision point in the OstéoPeinture build. The quote-assistant uses SQLite on a Railway volume, which just lost all session data during a deploy. We need to decide: fix it (Postgres, backup mechanism) or rethink the data layer entirely.

This is also relevant for future MOKSHA builds — we're building tools for multiple businesses and need a repeatable pattern for how we store, organize, and access data.

## What Happened

- SQLite database stored on Railway's persistent volume
- Deploy wiped the volume, losing all quote sessions
- Attempted fix: auto-backup to Google Drive via service account
- Google blocks service accounts from writing to personal Drive (consumer accounts)
- Current state: data is again at risk on every deploy

## Current Data Landscape Across MOKSHA

- **Finance system**: Google Sheets (155 transactions, formulas, reports)
- **Quote-assistant / OP Hub**: SQLite on Railway (fragile)
- **Job management**: SQLite in same app (not yet populated)
- **AutoCat rules, mirror logic**: JSON + Python files in repo
- **Claude project memory**: Markdown files in .claude/
- **Apple Notes**: Loric's daily scratchpad (payments, materials, to-dos)
- **Jibble**: Time tracking (CSV export only)
- **Old Tiller system**: Google Sheets (historical data, being phased out)

## Questions to Explore

### 1. For OP Hub specifically
- SQLite → Postgres migration: effort, cost, code changes?
- Is Postgres overkill for a 1-user app doing 3-5 jobs at a time?
- Could we keep SQLite but make it truly persistent (different hosting, S3 backup)?

### 2. For MOKSHA's broader tool-building practice
- What's the right default database for Railway-deployed tools?
- When does Google Sheets make sense vs a real database?
- When does Notion/Airtable make sense (for client-facing tools)?
- What about Supabase (hosted Postgres with a nice UI)?

### 3. The "second brain" / knowledge base pattern
- Some builders store everything as organized Markdown files with backlinks
- This works for AI context (Claude reads files), human navigation (Obsidian), and version control (git)
- How does this compare to structured databases for business operations?
- Is there a hybrid: structured data in Postgres, knowledge in Markdown, UI in Obsidian?

### 4. For future client builds
- If we build similar hubs for other MOKSHA clients, what's the stack?
- Do we want a repeatable "MOKSHA hub template" that can be deployed per client?
- What data layer supports: quotes, jobs, time tracking, invoicing, finance — across different businesses?

## What I Want From This Session

1. Clear explanation of each data storage option (for a non-developer)
2. Pros/cons table specific to MOKSHA's situation
3. Decision on OP Hub: Postgres yes/no, with migration plan if yes
4. A default recommendation for future MOKSHA builds
5. Discussion of the Markdown/Obsidian knowledge base approach and where it fits

## Background Reading

- `docs/OP-FINANCE-MASTER-PLAN.md` — current build plan
- `docs/OP-JOB-MANAGEMENT-SPEC.md` — job management spec (uses SQLite)
- `docs/OP-FINANCE-CHAT-SPEC.md` — chat interface spec (was going to use gspread)
- `osteopeinture/finance-system/CONTEXT.md` — finance system state
- `osteopeinture/quote-assistant/CONTEXT.md` — quote-assistant state
