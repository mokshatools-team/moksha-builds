# OstéoPeinture Project Memory Index

*Migrated from `/Users/loric/.claude/projects/-Users-loric-MOKSHA-FIDELIO-Automations/memory/` on 2026-04-07. Originals kept in place pending verification.*

## Active Project State
- [OP Finance 2026 + OP Hub](project_op_finance.md) — Sheet live, OP Hub built D1-D7, opening balances backtracked, backup unresolved
- [OP Hub App](project_op_hub_app.md) — Job management built inside quote-assistant, live on Railway

## OP Hub / Quote Assistant
- [Quote Assistant — status & pending](project_quotes_status.md) — Live deploy, all shipped fixes, next-session tasks
- [Quote Assistant — technical architecture](project_quotes_architecture.md) — Stack, Docker fix, quoting pipeline, JSON structure, paint pricing rules

## Workflow & Discovery
- [Jibble workflow — 3 use cases](project_op_jibble_workflow.md) — Time data feeds wages, client weekly updates, AND invoices. LAVAL contract as reference.
- [Full workflow discovery](project_op_workflow_discovery.md) — Loric's actual weekly process, Apple Notes as real hub, activity mapping per job, materials bundling, invoice types, payment tracking
- [OP Finance Chat Spec](project_op_finance_chat_spec.md) — Build spec location + key architecture decisions for the conversational interface

## Tax & Reconciliation
- [Sales Tax tracker rebuild](project_op_finance_salestax.md) — Pull archive from old SALES TAX tab, automate quarterly instalments, payment tracking
- [Supplies/Consumables reconciliation gap](project_op_finance_tax_gap.md) — ~$22K gap between total supplies and per-job allocations
- [OP Cash reconciliation gaps](project_op_cash_reconciliation.md) — Jan +$614 missing inflow, Feb–Apr -$316 missing outflow vs. anchors ($550 / $1,125)

## Feedback & Preferences (OP-specific)
- [Never ask Loric to manually categorize](feedback_automate_categorization.md) — Auto-categorize imports via autocat-rules.json
- [Overestimate consumables](feedback_overestimate_consumables.md) — Per-job supplies allocations historically underestimated, overestimate going forward
- [Railway CLI drifts between projects](feedback_railway_cli_drift.md) — Always chain `railway link` + `railway up` in one shell; verify build log URL contains project `2049a8ed-...`
- [Bump # Version line when editing QUOTING_LOGIC.md](feedback_quoting_logic_version_bump.md) — Force-reseed only fires when the version header changes; forgetting = silent no-op on deploy
- [Supabase — always use Session Pooler](feedback_supabase_pooler_only.md) — direct connection is IPv6-only, fails on Railway and local networks

## Cash/Declared + Past Quotes
- [Cash vs declared job logic](project_cash_declared_logic.md) — no taxes on cash, agreed flat total, unbranded docs, declared ledger future intent
- [Past quotes search plan](project_past_quotes_search.md) — import 252 PDFs + extracted JSON into Supabase, Claude tool for institutional memory
- [Past quotes extraction status](project_past_quotes_extraction.md) — 80 imported, ~300 pending, filter by: quotes-only + recent + converted jobs

## UX Feedback
- [Mobile UX must be instant](feedback_mobile_ux_speed.md) — no round-trips per interaction, textareas over checkboxes, Enter=newline on mobile, hamburger always visible
- [Smart paste should route paint to Products section](feedback_smart_paste_paint_routing.md) — PAINT blocks go to job_sections.products, not scratchpad

## Email / Communication
- [Email drafts — Claude + past-email tone matching SHIPPED](project_email_drafts_claude_rewrite.md) — Claude + 3 real past sent emails injected as tone reference, both phases live
- [past_emails Supabase table](reference_past_emails_table.md) — 193 real sent emails tagged by signer/scenario/language for tone matching
- [Email informal tone has 2 levels](feedback_email_informal_tone_calibration.md) — measured by default, FICCA-style chumminess only when past examples show closeness

## Scaffold Module
- [Scaffold module — scope & logic](project_scaffold_module.md) — new OP Hub module, calculates scaffold component quantities + rental costs from job dimensions
- [EMCO 2025 scaffold rental catalog](reference_emco_scaffold_catalog.md) — full price list: frames, braces, platforms, boards, accessories, lifts (Jan 2025)
- [GAMMA 2025 lift rental catalog](reference_gamma_lift_catalog.md) — Z34/Z45/Z60 boom lifts, delivery $165/way, harness w/ sling

## References
- [Tiller Master Sheet](reference_tiller_master.md) — AutoCat rules source (ID: 12FT0agrTeIdrC929n-vjEWLG9Uxbf136VxpESs-Kcsc)
- [Cash Ledger tab pattern](reference_cash_ledger_tab.md) — QUERY + SCAN reusable pattern for per-account dynamic ledgers (tab #13)
