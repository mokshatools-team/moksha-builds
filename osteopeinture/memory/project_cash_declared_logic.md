---
name: Cash vs declared job logic — how OP handles undeclared work
description: Business rules for cash jobs: no taxes, agreed flat total, unbranded documents, finance sheet gets Contract Revenue without tax split
type: project
---

**Cash jobs** (payment_type = 'cash'):
- No TPS/TVQ charged to client
- "Agreed total" is a flat renegotiated amount (e.g. LACHANCE_01: quote was $13,797 declared → settled at $11,500 cash)
- Balance = agreed_total - payments (no tax calculation)
- Documents are **unbranded** — same content but no OstéoPeinture logo, header, footer, RBQ#, signature block. Sent by text or printed, never by official email.
- renderQuoteHTML supports `{ branded: false }` to strip branding
- Finance sheet: payments still go as "Contract Revenue" — same category regardless of cash/declared
- Material costs should be ~15% higher on cash jobs (can't claim ITCs) — per QUOTING_LOGIC §15A

**Declared jobs** (payment_type = 'declared', default):
- Standard quoting rules: subtotal + TPS 5% + TVQ 9.975%
- Full branding on all documents
- Finance sheet gets taxes as part of the total

**Convert-to-job flow asks immediately:** Declared or Cash? If cash, prompts for the agreed total in the same modal.

**Agreed total is editable** from the job detail view (input field, saves on blur via PATCH).

**Job detail display for cash:** shows original quote total struck through, then "Agreed Total (Cash)" in green as the effective total. Balance computed from the agreed total.

**Future: "Declared ledger"** — Loric mentioned wanting a separate ledger view that only shows declared transactions. Cash transactions would not appear unless explicitly included. Not built, not spec'd — just the intent recorded.

**DB columns:** `payment_type TEXT DEFAULT 'declared'`, `agreed_total_cents INTEGER` on the jobs table.
