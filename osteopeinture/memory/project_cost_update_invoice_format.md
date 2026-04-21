---
name: Cost Update vs Invoice — exact format requirements from Kennerknecht reference
description: Cost update = PROJECT COST UPDATE (no paint, no modalities, no signature, no closing). Invoice = PROJECT COST BREAKDOWN (cash) or INVOICE (declared). Both follow Kennerknecht structure. Payment dates right-aligned near amounts.
type: project
---

**Reference:** Kennerknecht invoice at `/Users/loric/Downloads/KENNERKNECHT_01 - INVOICE_01 (1).pdf`

**Document titles:**
- Cost Update (mid-job): **"PROJECT COST UPDATE"**
- Final invoice — cash jobs: **"PROJECT COST BREAKDOWN"**
- Final invoice — declared jobs: **"INVOICE"**

**Structure (from Kennerknecht reference):**

1. OstéoPeinture logo + header
2. BILLED TO / INVOICE # / DATE / PROJECT info grid
3. **PRODUCTS USED** section (invoice only, NOT on cost update)
4. **DETAILS** header
5. **A. INITIAL BUDGET** — original quote sections with SUB-TOTAL — INITIAL BUDGET
6. **B. ADD-ONS / ADJUSTMENTS** — extras with SUB-TOTAL — EXTRAS
7. **FINAL TOTAL** (dark bar)
8. DECLARED PORTION (if partially declared) + GST/QST lines
9. **GRAND TOTAL** (dark bar)
10. DEPOSIT PAID + PREVIOUS PAYMENTS (each listed individually)
11. **BALANCE TO BE PAID** (dark bar)
12. Closing statement: "The remaining balance is to be paid by cash upon completion of the work." (invoice only, NOT cost update)
13. **THANK YOU FOR YOUR TRUST!** (invoice only, NOT cost update)
14. Footer: OstéoPeinture address/phone/RBQ

**Key differences between Cost Update and Invoice:**
- Cost Update: NO paint/products section, NO modalities, NO signature, NO closing statement, NO "thank you"
- Invoice: includes paint/products used, closing statement + "thank you for your trust", NO signature needed either

**Payment lines formatting:**
- Date and method text should be RIGHT-ALIGNED (close to the amounts, not left-aligned far from numbers)
- Each payment listed individually (not summed as "PREVIOUS PAYMENTS" unless there are many)

**Next session:** refactor the cost update endpoint to match this exact structure. Remove paint section, modalities, signature, legal block from cost updates. Add them back for invoices only.
