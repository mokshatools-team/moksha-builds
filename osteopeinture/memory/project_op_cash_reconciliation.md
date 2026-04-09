---
name: OP Cash reconciliation gaps (Jan 2026 + Feb–Apr 2026)
description: Known cash balance anchors vs. Cash Ledger running balance — unresolved gaps identified 2026-04-08
type: project
---

After restoring the 7 destroyed Transactions rows and building the Cash Ledger tab, the running balance does NOT reconcile to Loric's stated anchors.

**Anchors (from Loric):**
- Jan 30, 2026 EOD cash = $550
- Current (Apr 7, 2026) cash = $1,125

**Cash Ledger shows:**
- Jan 30, 2026 = -$64  → **+$614 missing inflow in January**
- Apr 7, 2026 = $1,441 → **-$316 missing outflow Feb–Apr**

**Why:** January gap is the bigger red flag because all subsequent math depends on Jan 1 opening balance being correct. The restored opening of $961 + known Jan activity (Loric -$700, Graeme -$1,200, Lubo -$1,200, Dufresne +$2,075) = -$64, not $550.

**How to apply:** Next session walk Loric through January cash day-by-day starting from opening $961, find the ~$614 missing inflow (likely an early contract payment or cash deposit before Jan 30). Once Jan 30 hits $550, isolate the -$316 Feb–Apr outflow gap. Do NOT silently patch — surface every gap and get Loric to confirm the source before writing.

**Next session:** Open the Cash Ledger tab with Loric, walk January cash day-by-day, identify the +$614 missing January inflow first.
