---
name: OP Workflow Discovery — Jibble to Invoice Pipeline
description: Full discovery of how Loric manages time tracking, client updates, materials, payments, and invoicing. Core workflow that automation must support.
type: project
---

## Current Weekly Workflow (manual, takes significant time)

1. During the week: Loric corrects Jibble entries on phone (wrong clock in/out, wrong activity)
2. Export Jibble CSV (phone or desktop) with project + activity filters
3. Check hours — do they make sense? Adjust if not (experience-based gut check)
4. Map generic Jibble activities to job-specific line items (this mapping lives in Loric's head + Apple Notes)
5. For big hourly jobs: create client update document (MISE-A-JOUR) — bilingual FR, shows hours × rate per activity
6. Email update to client with brief explanation
7. At job end: create final invoice from accumulated time + materials

**Pain point:** When rushed, client updates don't get sent → leads to surprises → stress for everyone. The mapping and formatting step is the bottleneck.

## Activity-to-Line-Item Mapping (per job)

NOT standardized. Each job has its own mapping. Example from LAVAL/CHAUT_01:
- Set up & Protect → Set up & Protect (same)
- Trim resurfacing → Other Extras - A
- Plaster repair dining ceiling → Other Extras - B
- Cornice repairs → Other Extras - C
- Plaster repairs → Stucco Repairs
- Gypse repair / install dining room walls → Wood Repairs
- Paint → Regular A
- Caulking → Regular B
- Heaters → Regular C

This mapping is stored in Apple Notes for each job. Needs to be digitized per-job.

## Apple Notes as Current Source of Truth

Loric uses Apple Notes as the primary quick-capture tool for each job:
- Client info (name, address, phone)
- Jibble activity mapping (TIMES section)
- Labor costs per worker
- Dividend splits
- Payment tracking (dates, amounts, e-transfer/cash, running total)
- Products used (paint types, quantities, costs)
- Consumables (detailed itemized list with prices)
- TO DO lists
- Extra time tracking (for small items not worth creating a Jibble activity)

**Key insight:** Apple Notes is the REAL job management hub, not the Google Sheets. The sheets are the formatted output.

## Payment Tracking

- Payments tracked in Apple Notes FIRST (especially cash)
- Then cross-referenced with bank account or finance ledger
- Weekly installments based on approximate projected final total (not progress invoicing)
- One final invoice at end, not multiple invoices
- Example: LAVAL = $25,475+tax total, paid in 9 installments ($500 deposit + 8 payments), balance = $0

## Materials on Invoices

Materials are NOT separate line items on the invoice. They're bundled into activity categories:
- Paint products tracked separately in Apple Notes (PRODUCTS section with brand, quantity, cost)
- Consumables tracked in Apple Notes (detailed itemized list)
- On the invoice: materials cost is included in the hourly rate or listed as "matériaux" under the relevant activity
- Example: "Cornice repairs" includes both labor hours AND materials cost

## Invoice Structure (two types)

### Type 1: Fixed-price interior jobs
- Quote → minimal adjustments → invoice
- Structure: Initial Contract + Add-ons + GST/QST + Deposits/Payments = Balance
- Simple conversion from quote

### Type 2: Hourly/budget exterior + repair jobs
- Budget estimate → weekly updates → final invoice from actual hours
- Structure: sections A through E (Initial Quote, Extra Prep, Moulding Replacement, Other Repairs, Add-ons)
- Each section has labor hours + materials
- GRAND TOTAL + "Portion paid by OP" (if applicable) + GST/QST + Deposits + Previous Payments = Balance
- Example: SHULMAN_01 invoice (5 sections)

## Reference Sheets

- LAVAL/CHAUT_01: `1QMD3Nw_skN7fINJ4l_MZ-QXP9DaAVB7gBBmjI2h32S8`
  - Tabs: Time Report, MISE-A-JOUR, FACTURE, INVOICE
- SHULMAN_01: `1a3bMWdRX54TMNfTEuxtQ257WYNLAH3uJWux--SE-KPs`
  - Tabs: EXT PAINTING QUOTE, UPDATED QUOTE, INVOICE
  - Good example of multi-section invoice with extras

## What Automation Should Deliver

From ONE Jibble export:
1. **Wages tab** — worker hours, internal rates, balance owed (finance system)
2. **Client update** — bilingual, hours × billed rate per mapped activity (for big hourly jobs)
3. **Final invoice** — accumulated time + materials, deposits, balance (both job types)
4. **Job P&L data** — labor cost per job flowing into Per-Job P&L

PLUS: payment tracking that replaces the Apple Notes checklist.
PLUS: materials tracking that connects to the invoice.
PLUS: the gut-check validation ("these hours don't make sense") as a sanity check before sending.
