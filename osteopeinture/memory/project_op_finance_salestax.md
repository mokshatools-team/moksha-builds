---
name: OP Finance — Sales Tax tracker rebuild scope
description: Rebuild GST/QST tracker from old SALES TAX tab — pull archive data, automate quarterly instalments, payment tracking
type: project
---

The old Tiller sheet SALES TAX tab has thorough tracking that needs to be replicated and automated in the 2026 system.

**What to pull from old tab:**
- 2023, 2024, 2025 yearly GST/QST collected, paid, owed, balance
- Quarterly instalment amounts and due dates (accomptes provisionnels)
- Payment history with REV QC reference codes
- Penalties incurred (2024: $50.53 TPS + $44.97 TVQ)
- Prior year carryover balances

**What the new system needs:**
- Auto-calculate GST/QST collected from revenue (already exists, working)
- Auto-calculate ITC from eligible expenses (exists but broken — needs fix)
- Quarterly instalment schedule with due dates (Apr 30, Jul 31, Oct 31, Jan 31)
- Instalment amount calculation (based on prior year owing)
- Payment tracking: date, amount, reference number, paid/unpaid status
- Balance owing: total owed minus instalments paid minus ITC credits
- Archive view: prior years for reference
- Alert: upcoming due dates

**Key numbers (2025):**
- GST collected: $6,936, QST collected: $13,838
- Eligible expense deductions: GST $3,415, QST $6,789
- Net owing: GST $3,521, QST $7,049
- Quarterly instalments: ~$993 GST + ~$2,015 QST = ~$3,008/quarter
- Some 2025 Q4 instalment (Jan 31, 2026) may still be unpaid — verify

**How to apply:** This replaces the current GST/QST Tracker tab or becomes an enhanced version of it. Pull archive data in the build session, don't ask Loric to re-enter it.
