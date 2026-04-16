---
name: Invoice formatting must match quote template exactly
description: Change order preview was ugly and off-brand. Invoices must reuse the exact same OstéoPeinture HTML template as quotes. Extras section feeds into invoices alongside change orders.
type: project
---

**Direction (2026-04-16):** Loric reviewed the change order preview and called it "horribly off." Invoices must NOT follow that pattern.

**Rules for invoices (when built):**
- Use the **exact same HTML template** as quotes — same OstéoPeinture branding, header, info grid, section layout, fonts, colors
- Pull line items from: (1) original quote sections, (2) approved change orders, (3) extras section from job detail, (4) manual adjustments the user makes before finalizing
- The invoice is an editable draft before sending — user can restructure, add, remove sections
- Final output matches the quote PDF quality and formatting

**Change orders: parked.** Too complex for now. The Extras section on the job detail is enough to capture additional work. Change order button remains in the UI but is not a priority.

**Why:** the change order template was built as a minimal HTML page with basic CSS — not the branded quote renderer. Loric expects all client-facing documents to match the polished quote format. Any future document generation (invoices, change orders, client updates) should reuse the quote HTML renderer, not roll a new one.
