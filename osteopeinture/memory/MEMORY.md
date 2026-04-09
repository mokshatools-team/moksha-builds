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

## References
- [Tiller Master Sheet](reference_tiller_master.md) — AutoCat rules source (ID: 12FT0agrTeIdrC929n-vjEWLG9Uxbf136VxpESs-Kcsc)
- [Cash Ledger tab pattern](reference_cash_ledger_tab.md) — QUERY + SCAN reusable pattern for per-account dynamic ledgers (tab #13)
