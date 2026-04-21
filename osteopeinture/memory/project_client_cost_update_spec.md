---
name: Client Cost Update = single document replacing change orders + invoices
description: One document type, not three. Shows initial quote + approved add-ons + new extras + payments to date + balance. Same template as the quote. Change orders as a separate concept are dropped.
type: project
---

**Decision (2026-04-20):** Loric clarified the document model. There should be ONE document type for post-quote client communication, not three separate ones (change orders, client updates, invoices).

**The document: "Client Cost Update"**
- Same visual template as the quote (OstéoPeinture branded, same HTML renderer)
- Structure:
  1. Initial quote subtotal (from the original quote sections)
  2. Approved add-ons (extras agreed on after the quote — from the Extras job section or approved optional sections)
  3. New items not in original quote (ad-hoc additions)
  4. = TOTAL (before tax)
  5. + TPS/TVQ if declared
  6. = GRAND TOTAL
  7. Payments made to date (list with dates/amounts)
  8. = BALANCE REMAINING

**How it differs from an invoice:** it doesn't. Loric's insight: "I'm not sure how they'd differ other than the title." The cost update IS the invoice — just called differently depending on timing. Mid-job = "Cost Update." End of job = "Invoice." Same template, just swap the title.

**What this replaces:**
- Change orders (separate doc) → DROPPED. Extras go directly into the job's Extras section and appear as add-ons in the cost update.
- Client updates (separate endpoint) → MERGED into cost update
- Invoices (separate endpoint) → MERGED — same document, different title

**UI rule:** every modal/section that opens (change orders, cost update, etc.) MUST have a back button visible on mobile. Loric got stuck with no way to navigate back.

**Implementation approach:**
- Single endpoint: POST /api/jobs/:id/cost-update (or /invoice — same thing)
- Pulls: original quote from job.accepted_quote_json, extras from job_sections.extras, payments from payments table
- Renders with the quote HTML renderer (same branded template)
- Title toggles: "Mise à jour des coûts" / "Cost Update" vs "Facture" / "Invoice"

**Next session:** build this. Remove or simplify the existing change order UI (button can stay but redirect to cost update flow).
