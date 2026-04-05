# OstéoPeinture Job Management — MVP Spec
## Jibble → Client Updates → Invoices → Finance

*Designed by Codex, based on workflow discovery with Loric. 2026-04-05.*

---

## What This Is

An extension of the existing quote-assistant that adds job management after a quote is accepted. One Jibble CSV export feeds three outputs: worker wages, client updates, and invoices.

**Lives in:** `osteopeinture/quote-assistant/` (Node.js, Railway, SQLite)

---

## Architecture

```
Quote accepted → Job created (SQLite)
  ↓
Jibble CSV imported → time entries stored + mapped to job activities
  ↓
Three outputs from one data source:
  1. Client update (PDF, bilingual, emailed weekly for hourly jobs)
  2. Final invoice (PDF, from quote + extras - payments)
  3. Finance sheet sync (payment → Revenue entry in Google Sheets)
```

---

## Data Model (SQLite additions)

### sessions (existing — add columns)
- converted_job_id TEXT
- accepted_at TEXT
- archived_at TEXT

### jobs
- id, quote_session_id, job_number, client_name, client_email, client_phone
- language, address, project_title, project_type
- status (quoted → active → invoiced → partially_paid → paid → closed)
- quote_subtotal_cents, quote_tax_cents, quote_total_cents
- accepted_quote_json, accepted_quote_pdf_path
- payment_terms_text, start_date, target_end_date, completion_date
- internal_notes, created_at, updated_at

### job_change_orders
- id, job_id, title_en, title_fr, description
- amount_cents, taxable, status (draft → approved → rejected)
- approved_at, created_at, updated_at

### job_activity_mappings
- id, job_id, source_activity_name, normalized_key
- phase_code (prep, prime, paint, stain, repair, cleanup, travel, admin)
- client_label_en, client_label_fr
- billable_default, show_on_update, show_on_invoice, sort_order
- UNIQUE(job_id, source_activity_name)

### time_import_batches
- id, job_id, source, file_name, file_sha1
- imported_at, row_count, inserted_count, duplicate_count, unmapped_count
- status (imported → needs_mapping → finalized)

### time_entries
- id, batch_id, job_id, external_row_key (UNIQUE)
- work_date, employee_name, source_activity_name
- mapped_phase_code, mapped_label_en, mapped_label_fr
- mapping_status (unmapped → mapped → ignored)
- duration_minutes, billable_minutes, labour_cost_cents
- notes, raw_row_json, created_at

### client_updates
- id, job_id, sequence_no, language
- period_start, period_end, status (draft → sent)
- summary_json, html_snapshot
- sent_to, sent_at, created_at, updated_at

### invoices
- id, job_id, invoice_number, invoice_type (deposit, progress, final)
- language, issue_date, due_date
- status (draft → issued → partially_paid → paid → void)
- subtotal_cents, tax_cents, total_cents, credits_cents, balance_due_cents
- invoice_json, html_snapshot
- sent_to, sent_at, paid_at, created_at, updated_at

### payments
- id, job_id, invoice_id, payment_date
- amount_cents, method (e_transfer, cheque, cash, other)
- reference, notes
- finance_sync_status (pending → synced → failed)
- finance_synced_at, created_at

### finance_sync_events
- id, payment_id, target_sheet, action, payload_json, response_json
- status (success, failed), attempted_at

---

## User Flow (Phone)

### Home screen
- Top nav: Quotes | Jobs | Invoices
- Job cards: client name, address, status chip, unpaid balance, quick actions
- Quick actions per job: Open, Import Time, Update, Invoice

### Quote → Job conversion
- "Convert To Job" button on accepted quote
- Form prefilled from quote: client, address, language, project title
- Creates job record, snapshots quote JSON

### Job detail screen
- Header: client, address, job number, status
- Four action buttons: Import Jibble CSV, Log Update, Create Invoice, Record Payment
- Summary blocks: Quote Total, Approved Extras, Paid To Date, Balance Remaining

### Jibble import
- Upload CSV from phone files
- Preview: date range, row count
- Summary: X imported, Y duplicates skipped, Z need mapping
- CTA: "Map Activities" (if unmapped exist)

### Activity mapping
- One card per unmapped activity
- Fields: Phase dropdown, Billable toggle, Client label EN, Client label FR
- Save applies to all current + future imports for this job

### Client update
- Date range picker
- Auto-generated sections: Completed, In Progress, Next Steps, Approval Needed
- Language toggle EN/FR
- Preview PDF, Send Email

### Final invoice
- Line items: Accepted Quote + each approved extra - credits/payments
- Totals: subtotal, TPS, TVQ, total, balance due
- Preview PDF, Send Invoice

### Payment recording
- Amount, date, method, reference, notes
- Auto-updates invoice status and balance
- Syncs to finance Google Sheet

---

## Jibble CSV Import Logic

1. User uploads CSV
2. Parse headers (Activity, Member, Tracked Time, Billable Amount — or with Date/Project columns)
3. Parse "Xh Ym" duration format to minutes
4. Generate external_row_key = sha1(job_id + date + member + activity + start + duration)
5. Skip duplicates (key already exists)
6. Match source_activity_name against job_activity_mappings
7. Mapped → status "mapped", billable minutes calculated
8. Unmapped → status "unmapped", excluded from outputs until mapped
9. Return import summary

---

## Activity Mapping Per Job

Set up on first import, reused for all subsequent imports on that job.
Generic Jibble names → job-specific client-facing labels.

Example:
| Jibble Activity | Phase | Client Label EN | Client Label FR |
|---|---|---|---|
| Regular Task - A | paint | Wall painting | Peinture des murs |
| Repairs — Plaster / Stucco | repair | Plaster repairs | Réparations de plâtre |
| Set up & Protect | prep | Surface preparation | Préparation des surfaces |

---

## Client Update Generation

1. Aggregate mapped entries by phase_code for selected date range
2. Convert minutes to rounded hours
3. Build client-facing bullets from mapped labels (not raw Jibble names)
4. Surface repair/extra work in "Changes Needing Approval" section
5. Render bilingual HTML → PDF via Playwright
6. Email with brief explanation

---

## Final Invoice Generation

Built from contract, NOT from time totals:
- Base: accepted_quote_json subtotal
- Plus: approved change_orders
- Minus: payments received as credits
- Calculate: GST (5%) + QST (9.975%)
- Result: balance due

---

## Finance Sheet Sync

Only payment events write to the sheet. One row per payment in Transactions:
- Date, Description ("Invoice paid — {client} — {job}"), Account (RBC/Cash), Amount
- Category: Contract Revenue, Job: job_number, Source: "Invoice"
- entry_id, source_system="quote-assistant", source_id=payment_id

SQLite stays authoritative. Sheets is the ledger mirror.

---

## Build Plan (8 sessions)

1. Schema + job conversion
2. Mobile job dashboard UI
3. Jibble CSV import backend
4. Activity mapping UI
5. Client update generator + PDF + email
6. Change orders + final invoice generator
7. Payments + finance sheet sync
8. Hardening + edge cases + testing

---

## Apple Notes Replacement

The job detail screen replaces Apple Notes as the job hub:
- Client info → job record
- Jibble activity mapping → activity_mappings table
- Payment tracking → payments table
- Internal notes → job.internal_notes field
- Materials/products → future: materials tracking (post-MVP)
- To-do lists → future: job task management (post-MVP)

For MVP: Loric can keep using Apple Notes for quick capture (materials lists, to-dos) and the app handles the structured data (time, payments, invoices).

---

*OstéoPeinture Job Management — MVP Spec v1. Codex-designed. 2026-04-05.*
