---
name: OP Cash reconciliation — blocked on FIDELIO ledger + 2025 finalization
description: Cash pile is physically merged OP + FIDELIO. Reconciliation is blocked until 2025 closes and FIDELIO has its own system. Correct path documented.
type: project
---

**Root cause discovered 2026-04-09:** The physical cash pile is a **merged OP + FIDELIO pile**. The OP Cash Ledger can never reconcile to a pile count until FIDELIO cash flows are also tracked.

**Known FIDELIO cash moves NOT in any ledger:**
- Jan 2026: -$1,500 cash to Loric (FIDELIO draw)
- Mar 24, 2026: -$1,000 cash to BOSS (FIDELIO cut; the -$2,750 on the same day was OP's cut and is in the OP ledger)

**Anchors:**
- Apr 9, 2026 mixed pile = $825 (physical count)
- Jan 30, 2026 mixed pile = $550 (recollection)
- Neither is usable for OP alone until FIDELIO is subtracted out

**Current OP Cash Ledger state:**
- Opening balance row cleared (no longer assumes $961)
- Sum of 26 logged 2026 cash rows = +$180 net
- Computed Jan 30 (with $645 opening derived from pure count-down) = -$380 → $930 short of anchor. Gap is explained by the missing FIDELIO flows above.

**Correct sequencing (agreed with Loric):**
1. **Finalize 2025 ledgers** (OP + whatever FIDELIO has) → gives clean Dec 31, 2025 closing balances including true Cash opening for each entity
2. **Build FIDELIO finance system** — mirror of OP's structure (Transactions, Cash Ledger, Accounts, etc.)
3. **Settle today** — split physical pile into two envelopes, anchor each separately, post adjusting entries for any unrecorded 2026 flows
4. **Automate going forward** — shared import patterns, auto-categorization, conversational interface across both companies

**How to apply:** Do NOT attempt to patch OP's Cash Ledger gaps in isolation. Any "fix" without FIDELIO's side of the pile will just move numbers around without matching reality. Next session starts with item 1: finalize 2025 OP ledger.

**Next session:** Resume 2025 OP ledger finalization (blocked earlier on Loric's corrections). Do not touch Cash reconciliation until 2025 is closed and FIDELIO system is scoped.
