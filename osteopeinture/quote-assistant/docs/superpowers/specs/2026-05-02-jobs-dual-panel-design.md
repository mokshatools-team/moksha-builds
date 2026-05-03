# Jobs Dual-Panel — Design Spec

**Date:** 2026-05-02
**Status:** Draft (Codex-reviewed, revised)
**Build:** OP Hub Quote Assistant (osteopeinture/quote-assistant)

---

## Overview

Add a dual-panel layout to the Jobs side of OP Hub. Left panel shows job detail (editable fields, sections, payments, notes). Right panel shows context-sensitive content controlled by 3 tabs: Chat, Docs, Photos. This is Part 1 of 2 — layout + document versioning. Part 2 (job chat brain) is a separate spec.

### This spec covers (Part 1)
1. Dual-panel layout on desktop with draggable divider
2. Mobile layout with 4 bottom tabs (Detail, Chat, Docs, Photos)
3. Document versioning: consolidate invoices + cost updates into one model
4. Move existing features inline (invoice editor, quote preview, photos, email actions)

### Separate spec (Part 2 — job chat brain)
- Job-specific Claude chat with tool use
- Smart paste replacement (paste into chat, Claude routes to sections)
- Section filling, payment recording, document generation via chat
- Job lifecycle awareness (quote → active → invoiced → paid)

### Non-goals
- No client-facing portal
- No real-time collaboration
- No changes to the quote assistant side (except shared panel utilities)

---

## Layout

### Desktop
```
┌─────────────┬──────────────────────┬──────────────────────┐
│  Jobs List   │    Job Detail         │    Right Panel        │
│  (sidebar)   │    (left panel)       │    [Chat|Docs|Photos] │
│              │                      │                      │
│  ACTIVE      │  SANFORD_01          │  (content depends    │
│  ■ SANFORD   │  788A Bloomfield     │   on active tab)     │
│    WILDER    │  Anthony Sanford     │                      │
│              │                      │                      │
│  UPCOMING    │  Status: [Active ▾]  │                      │
│  ■ ZACHARIA  │                      │                      │
│              │  [TO DO]             │                      │
│  COMPLETED   │  [PRODUCTS]          │                      │
│  ■ LACHANCE  │  [FINANCES]          │                      │
│              │  [NOTES]             │                      │
└─────────────┴──────────────────────┴──────────────────────┘
```

- Jobs list always visible in sidebar (already exists with color ribbons)
- Clicking a job loads job detail in center panel
- Draggable divider between job detail and right panel
- Right panel has 3 tabs: **Chat | Docs | Photos**
- Reuse shared panel divider logic from `public/js/panel.js` (extend, don't duplicate)

### Mobile
```
┌──────────────────────────────────┐
│  [hamburger]  SANFORD_01         │
│                                  │
│  (active tab content — full      │
│   screen)                        │
│                                  │
│                                  │
├──────────────────────────────────┤
│  Detail  │  Chat  │ Docs │ Pics │
└──────────────────────────────────┘
```

- 4 bottom tabs: **Detail | Chat | Docs | Photos**
- Detail is the default/landing tab
- Jobs list via hamburger toggle (same as current)
- No email tab on mobile — email is an action from Docs (send a document) or Chat

---

## Right Panel Tabs

### 1. Chat Tab (Part 1: placeholder only)
- Shows a simple chat interface (message list + input)
- In Part 1: messages stored but no Claude integration (just a scratchpad/notes chat)
- In Part 2: full Claude chat with tool use, smart paste, job lifecycle awareness
- Messages stored in `job_messages` table (not on the job row)

### 2. Docs Tab
The central document hub for the job.

**Sub-navigation:**
```
┌─────────────────────────────────────────┐
│  [Invoice]  [Cost Update]  [Quote]      │
├─────────────────────────────────────────┤
│                                         │
│  ┌─ Editor (current draft) ───────────┐ │
│  │  Section 1: Chambre        975 $   │ │
│  │  Section 2: Chambre double 1150 $  │ │
│  │  ...                               │ │
│  │  [Save v3]  [Preview]  [PDF]       │ │
│  └────────────────────────────────────┘ │
│                                         │
│  ┌─ Saved Versions ──────────────────┐ │
│  │  v2 — Apr 30  [Sent]  [View][PDF] │ │
│  │  v1 — Apr 28  [Draft] [View][PDF] │ │
│  └────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

**How it works:**
- **Editor** at top: same invoice editor (already built), rendered inline instead of modal
- **Save** creates a new numbered version (v1, v2, v3...) with timestamp
- **Preview** opens the rendered HTML for review (in the same panel, not a popup)
- **PDF** downloads the PDF
- **Saved versions** below: list with date, status (Draft/Sent), View/PDF/Email actions
- **Email** is an action on a saved version: generates email with PDF attached
- **Quote sub-tab** shows the original accepted quote (read-only preview)

**Draft behavior:**
- The editor always shows the current working draft
- Drafts are NOT auto-saved as versions — only "Save" creates a version
- If you close and reopen, the draft state is preserved (same as current `invoiceOverrides`)
- "Preview" shows a temporary render without saving

### 3. Photos Tab
- Same gallery as current (carousel, thumbnails, upload, delete)
- Shows all attachments linked to the job (includes photos transferred from quote session)
- Upload button adds photos directly to the job
- Already built — just moves from job detail into the right panel

---

## Job Detail Panel (Left)

Stays mostly the same as current `openJobDetail()`. Specific changes:

### Remove (moved to right panel):
- "Cost Update" button → Docs tab
- "Invoice" button → Docs tab
- "Draft Email" button → action inside Docs tab (email a saved version)
- "View Quote" button → Docs tab (Quote sub-tab)
- "Paste Apple Note" button → Part 2 (replaced by job chat)

### Keep in job detail:
- Client info header (address, name, phone, email — editable inline)
- Status dropdown (Active/Upcoming/Completed/Archived)
- Sections: To Do, To Clarify, To Bring, Products, Extras (collapsible textareas)
- Photos summary: small thumbnail strip with count. Clicking opens Photos tab.
- Finances: quote/agreed total, balance, payment history, record payment button
- Notes (scratchpad textarea)
- Change orders (if any)
- Import Jibble button (stays — CSV import is a file action, not a panel feature)
- Update Total button (stays — quick inline action)
- Delete button (stays at bottom)

### Add:
- Clicking a photo thumbnail → switches right panel to Photos tab
- Payment history shows inline (already does)
- "Record Payment" stays as a modal (simple form, not worth a panel)

---

## Data Model

### Consolidate document storage

**Problem (from Codex review):** Currently there are 3 sources of truth:
1. `invoices` table (from server.sqlite.js era, may not be active)
2. `job_sections.invoiceOverrides` (current invoice editor state)
3. Proposed `job_documents` table

**Solution:** One table replaces all of them.

```sql
CREATE TABLE job_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  doc_type TEXT NOT NULL CHECK (doc_type IN ('invoice', 'cost_update')),
  version INTEGER NOT NULL DEFAULT 1,
  sections JSONB NOT NULL,
  paints JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'saved', 'sent')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_job_documents_job ON job_documents(job_id);
CREATE UNIQUE INDEX idx_job_documents_version ON job_documents(job_id, doc_type, version);
```

- Drop `invoiceOverrides` from `job_sections` — the draft is now the unsaved editor state (client-side only, like the quote draft editor)
- Drop or ignore the old `invoices` table if it exists
- Each "Save" inserts a new row with incremented version
- The editor loads the latest version's data as starting point, or falls back to `accepted_quote_json`

### Job messages (for Part 2, but create table now)

```sql
CREATE TABLE job_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_job_messages_job ON job_messages(job_id);
```

Create the table now so the schema is ready. Part 1 chat is just a basic message list (no Claude). Part 2 adds the AI.

---

## API Endpoints

### New
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/jobs/:id/documents` | List saved document versions |
| POST | `/api/jobs/:id/documents` | Save a new version (from editor state) |
| GET | `/api/jobs/:id/documents/:docId` | Get a specific version's data |
| GET | `/api/jobs/:id/documents/:docId/pdf` | Download version as PDF |
| PATCH | `/api/jobs/:id/documents/:docId` | Update status (mark as sent) |
| GET | `/api/jobs/:id/messages` | Get job chat messages |
| POST | `/api/jobs/:id/messages` | Add a message (Part 1: just stores, no AI) |

### Modified
| Method | Path | Change |
|--------|------|--------|
| POST | `/api/jobs/:id/cost-update` | Still works, but editor state comes from client, not `invoiceOverrides` |

### Unchanged
All existing job endpoints (CRUD, payments, time entries, change orders, attachments) stay as-is.

---

## Frontend Files

### New
```
public/js/jobs/panel.js          — right panel tab switching (reuses shared divider from panel.js)
public/js/jobs/chat.js           — basic message list + input (Part 1: no AI, just storage)
public/js/jobs/docs.js           — Docs tab: sub-nav, version list, inline editor, preview
```

### Modified
```
public/js/jobs/detail.js         — remove action buttons that moved to right panel
public/js/jobs/invoice-editor.js — render inline in Docs tab instead of modal
public/js/panel.js               — extract shared divider logic so jobs panel can reuse
public/js/state.js               — add job panel state (activeJobTab, etc.)
public/index.html                — add right panel HTML structure for jobs mode
```

### Deleted
- Invoice editor modal HTML from index.html (replaced by inline in Docs tab)

---

## Server Files

### New
```
routes/job-documents.js          — document CRUD, PDF generation, version management
services/job-document-service.js — version numbering, data validation
```

### Modified
```
routes/jobs.js                   — add message endpoints, mount document routes
server.js                        — mount new routes, add migration for job_documents + job_messages tables
```

---

## Execution Phases

| Phase | Scope | Estimate |
|-------|-------|----------|
| 1 | Layout: right panel HTML, tab switching, divider, mobile tabs | 1 session |
| 2 | Docs tab: document model, version CRUD, inline editor, version list, PDF | 1-2 sessions |
| 3 | Photos + basic chat: move gallery inline, basic message storage | 0.5 session |
| 4 | Migration: remove invoiceOverrides, clean up old invoice code, testing | 0.5 session |

**Total Part 1: ~3-4 sessions**

---

## Success Criteria

- Job detail + right panel side-by-side on desktop with draggable divider
- 4 bottom tabs on mobile (Detail, Chat, Docs, Photos), Detail as default
- Docs tab: save versions, view history, download PDF, mark as sent, email a version
- Invoice editor works inline (not modal)
- Photos tab works inline
- Chat tab stores messages (no AI yet)
- All existing job features still work (payments, Jibble, status, rename, delete)
- No regressions on quote assistant side
- `invoiceOverrides` removed from job_sections
- Old invoice modal code removed
