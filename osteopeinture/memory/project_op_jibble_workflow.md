---
name: OP Jibble workflow — time tracking to invoicing pipeline
description: How Jibble time data flows through the business — wages, client updates, and invoices. Three use cases from one data source.
type: project
---

Jibble time tracking data serves THREE purposes, not just wages:

**1. Finance — worker wages tracking**
- Jibble export → Wages tab (hours per worker per job)
- Used to calculate balance owed to each worker
- Feeds into Per-Job P&L (labor cost per contract)

**2. Client-facing weekly updates (for hourly/repair jobs)**
- On big jobs priced hourly (mainly exterior, repairs), Loric sends weekly cost updates to clients
- Format: MISE-A-JOUR document in Google Sheets — bilingual FR, lists work categories with hours and running costs
- Example: LAVAL contract sheet, "Copy of MISE-A-JOUR 2" tab
- Jibble activities map to invoice line items (e.g. "Repairs — Plaster / Stucco" → hours × $55/hr)
- Currently manual: Loric exports Jibble, copies into the update sheet, reformats

**3. Final invoice generation (for hourly jobs)**
- The FACTURE tab is the French invoice derived from the same time data
- Structure: detailed work descriptions + hours + totals + GST/QST + deposits paid + balance
- Different from fixed-quote invoices (which just convert the quote)

**Jibble export format (CSV):**
- Columns: Activity, Member, Tracked Time (Xh Ym format), Billable Amount
- Can filter by: Date range, Group by (Date/Member), Subgroup by, Projects, Activities, Members
- One export per project or all projects combined (adds Project column)
- Tracked Time needs parsing: "60h 21m" → 60.35 hours

**Activity-to-invoice mapping (per job):**
Jibble uses generic activity names that map to job-specific line items:
- "Regular Task - A/B/C" → main painting work (different areas/phases)
- "Repairs — Plaster / Stucco" → plaster/stucco repair hours
- "Repairs — Wood" → wood repair hours  
- "Extra Repairs" → additional repair work
- "Other Extras - A/B/C" → add-on work items
- "Set up & Protect" → preparation and protection
- "Scaffolding" → scaffolding setup/teardown
- "Windows" → window work
- "Admin" → admin time (may or may not be charged)

**Worker rates (from LAVAL contract):**
- Owners (Loric, Graeme, Lubo): $55/hr billed to client
- Edler: $20/hr internal wage (billed at $20 or higher depending on context)
- Yann: $25/hr internal wage (billed at $55/hr to client for LAVAL)

**Reference sheet:** LAVAL contract `1QMD3Nw_skN7fINJ4l_MZ-QXP9DaAVB7gBBmjI2h32S8`
- Time Report tab: Jibble data pasted + manual wage calculations
- Copy of MISE-A-JOUR 2: client-facing weekly update (bilingual FR)
- FACTURE: final invoice (FR)
- INVOICE: invoice template (EN)

**What to automate:**
- Jibble CSV → parsed time entries → Wages tab (finance)
- Same data → formatted client update document (quote-assistant or standalone)
- Same data → hours section of final invoice (quote-assistant)
- All three from one Jibble export, no re-entry
