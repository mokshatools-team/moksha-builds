---
name: OP Finance — Supplies/Consumables reconciliation gap
description: ~$22K gap between total supplies expense (P&L by month) and per-job consumables (P&L by contract) — needs reconciliation and proper handling in 2026 system
type: project
---

Loric identified a significant discrepancy in the 2025 data between total supplies purchases and per-job consumable allocations.

**The gap (~$22K):**
- P&L by month (row S18) shows total supplies expense (all purchases from HD, Empire, etc.)
- P&L by contract (row 16 section, col HN yearly totals) shows per-job consumable estimates — these are Loric's manual allocations of what was used on site
- The difference is ~$22K

**Three possible explanations:**
1. **Sales tax (GST 5% + QST 9.975%)** — purchase totals include ~15% tax that gets refunded via ITC. This inflates the supplies line vs. actual cost. On $55K of supplies, that's ~$8K in tax.
2. **Inventory** — supplies bought in bulk but not yet used. Loric estimates $2K-$5K max sitting in stock.
3. **Underestimation** — Loric may be allocating less per job than is actually consumed. The manual allocation method has inherent estimation error.

**Why this matters for the 2026 system:**
- The new system imports bank transactions at face value (tax-inclusive amounts)
- Per-job P&L currently can't distinguish between pre-tax cost and tax portion
- If we report supplies at tax-inclusive amounts but don't account for ITC refunds, the P&L overstates expenses
- Need to either: (a) strip tax from expense amounts at import time, or (b) track tax separately and show net-of-tax expenses in reports

**How to apply:** When building the conversational interface and finalizing the P&L reports, design the system so that:
- Supply purchases are recorded at their tax-inclusive amount (what was actually paid)
- The GST/QST ITC tracker correctly calculates the refund
- The P&L can optionally show expenses net of recoverable tax
- Per-job consumable allocation remains a separate manual/estimated process (not derived from purchases)

**Next step:** Run the actual numbers from the 2025 Tiller sheet (P&L by month S18 vs P&L by contract HN totals) to quantify the exact gap and break it down into the three components.
