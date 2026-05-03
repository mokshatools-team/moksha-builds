# Job Chat Brain — Design Spec (Part 2)

**Date:** 2026-05-03
**Status:** Draft
**Build:** OP Hub Quote Assistant (osteopeinture/quote-assistant)
**Prerequisite:** Jobs Dual-Panel Part 1 (deployed, tagged v1.1-dual-panel)

---

## Overview

Add Claude AI to the job chat tab. The chat is the job's brain — it understands the full job context (quote, sections, payments, status) and can act on it. Paste anything, Claude routes it to the right section. Ask it to record a payment, generate a document, or update job fields.

### Goals
1. Intelligent section management — Claude reads existing content, merges new data, never deletes without being asked
2. Smart paste — paste raw text (Apple Notes, color codes, task lists), Claude categorizes and routes to the right sections
3. Tool use — update sections, record payments, generate documents, update fields
4. Guardrails — diff check prevents accidental data loss, undo button for mistakes, Sonnet fallback on Haiku failure

### Non-goals
- No multi-user awareness (single-user tool)
- No real-time sync between chat and manual edits (refresh on focus handles this)
- No complex workflow orchestration (just tools, not a state machine)

---

## System Prompt

Rebuilt on every message to include current job state.

```
You are the job management assistant for Ostéopeinture. You help manage
active painting jobs — updating sections, tracking payments, organizing
information, and generating documents.

Be casual, direct, brief. No flattery. Operational tone.

## CURRENT JOB STATE

Client: {client_name}
Address: {address}
Project: {job_number}
Status: {status}
Payment type: {payment_type}
Quote total: ${quote_total}
Paid: ${total_paid}
Balance: ${balance}

### Accepted Quote Summary
{sections with totals, paints, modalities — from accepted_quote_json}

### Current Job Sections
TO DO:
{current todo content or "(empty)"}

TO CLARIFY:
{current toClarify content or "(empty)"}

TO BRING:
{current toBring content or "(empty)"}

PRODUCTS:
{current products content or "(empty)"}

EXTRAS:
{current extras content or "(empty)"}

SCRATCHPAD:
{current scratchpad content or "(empty)"}

## TOOLS

You have tools to modify the job. Use them proactively when the user
provides information that belongs in a section.

### Section Updates (update_job_section)
When updating a section:
1. Read the current content shown above
2. NEVER remove existing content unless the user explicitly says to delete/remove something
3. Merge new information into existing content:
   - Adding items: append in the same format as existing entries
   - Updating items: find the matching entry and modify it in place
   - User says something is "done": remove it or mark it done, based on context
   - Raw unstructured text pasted: parse it, categorize each piece, update the appropriate section(s)
4. Maintain existing formatting and line structure
5. The content parameter must be the COMPLETE section text after merging

### Payments (record_payment)
When recording a payment, state clearly in your response what you recorded:
"Recorded $X {method} payment on {date}. New balance: $Y"

### Documents (generate_document)
When asked to generate an invoice or cost update, call the tool.
Tell the user: "Saved {type} v{N} — check the Docs tab."
```

---

## Tool Definitions

### update_job_section

```json
{
  "name": "update_job_section",
  "description": "Update a job section by providing the complete merged content. Read the current section content from the system prompt, merge the user's new information into it, and provide the full result.",
  "input_schema": {
    "type": "object",
    "required": ["section", "content"],
    "properties": {
      "section": {
        "type": "string",
        "enum": ["todo", "toClarify", "toBring", "products", "extras", "scratchpad"],
        "description": "Which section to update"
      },
      "content": {
        "type": "string",
        "description": "The complete new section content after merging existing + new data"
      }
    }
  }
}
```

### update_job_field

```json
{
  "name": "update_job_field",
  "description": "Update a simple job field like status, client phone, or client email.",
  "input_schema": {
    "type": "object",
    "required": ["field", "value"],
    "properties": {
      "field": {
        "type": "string",
        "enum": ["status", "scratchpad", "client_phone", "client_email", "client_name"],
        "description": "Which field to update"
      },
      "value": {
        "type": "string",
        "description": "New value for the field"
      }
    }
  }
}
```

### record_payment

```json
{
  "name": "record_payment",
  "description": "Record a payment received for this job. Always state what was recorded in your response.",
  "input_schema": {
    "type": "object",
    "required": ["amount_cents", "method", "date"],
    "properties": {
      "amount_cents": {
        "type": "integer",
        "description": "Payment amount in cents (e.g., 50000 for $500)"
      },
      "method": {
        "type": "string",
        "enum": ["e_transfer", "cash", "cheque"],
        "description": "Payment method"
      },
      "date": {
        "type": "string",
        "description": "Payment date in YYYY-MM-DD format"
      }
    }
  }
}
```

### generate_document

```json
{
  "name": "generate_document",
  "description": "Generate and save a new version of an invoice or cost update document.",
  "input_schema": {
    "type": "object",
    "required": ["doc_type"],
    "properties": {
      "doc_type": {
        "type": "string",
        "enum": ["invoice", "cost_update"],
        "description": "Type of document to generate"
      }
    }
  }
}
```

---

## Guardrails

### 1. Diff Check on Section Updates

When `update_job_section` is called, before saving:
- Compare old content lines vs new content lines
- If more than 30% of existing non-empty lines were removed AND the user's message doesn't contain words like "remove", "delete", "clear", "replace", "redo": **reject the update**
- Return an error to Claude: "Update rejected — too many lines removed. The user didn't ask to delete content. Try again, preserving all existing content."
- Claude retries with the existing content preserved

This catches the worst merge failures without blocking intentional deletions.

### 2. Undo Button

- Every tool call that modifies data saves a snapshot: `{ section, oldContent }` or `{ paymentId }`
- Undo button appears in the chat header (top-right) after any modification
- One level of undo — last action only
- Undo for sections: restores old content via PATCH
- Undo for payments: deletes the payment
- Stored in client-side state (not DB)
- Button disappears after 60 seconds or next message

### 3. Sonnet Fallback

- If Haiku returns a malformed tool call (JSON parse error, missing required fields): automatically retry the same message with Sonnet
- If Sonnet also fails: return the error to the user
- Log model upgrades for monitoring: `[job-chat] Haiku failed, retrying with Sonnet`

### 4. Message History Cap

- Send only the last 15 messages to Claude (not the full history)
- The system prompt always has current job state, so older context isn't needed for section management
- Full history is stored in `job_messages` table and shown in the UI — just not sent to Claude

---

## API

### Modified Endpoint

**POST `/api/jobs/:id/chat`** (replaces the simple POST `/api/jobs/:id/messages`)

Request: `{ message: string }` (user's text)

Response: SSE stream (same pattern as quote chat):
```
data: {"type":"text","text":"partial response..."}
data: {"type":"tool_use","name":"update_job_section","input":{...}}
data: {"type":"tool_result","result":"Section updated"}
data: {"type":"done","text":"full response","toolsUsed":["update_job_section"]}
```

The simple GET `/api/jobs/:id/messages` stays for loading history.
The simple POST `/api/jobs/:id/messages` stays for storing messages (used internally by the chat handler).

### Tool Execution (server-side)

When Claude calls a tool, the server:
1. Validates the input
2. For `update_job_section`: runs the diff check, then PATCHes the job
3. For `record_payment`: calls the existing payment recording logic
4. For `generate_document`: calls the existing document version save logic
5. Returns the result to Claude for the next turn
6. Includes the result in the SSE stream so the frontend knows what changed

---

## Frontend Changes

### Modified: public/js/jobs/chat.js

- Replace the simple message POST with SSE streaming (same pattern as quotes/chat.js)
- After any tool call, refresh the job detail panel to show updated sections
- Add undo button rendering after tool calls
- Handle streaming text display (typing indicator, progressive render)

### Modified: public/js/jobs/panel.js

- Add undo state management
- Add undo button to chat header

### Modified: public/js/state.js

- Add: `var jobChatUndoState = null;`

---

## Server Files

### New

```
routes/job-chat.js               — SSE chat endpoint, tool dispatch
services/job-chat-service.js     — system prompt builder, tool handlers, diff check
```

### Modified

```
server.js                        — mount job-chat route
```

---

## Model Selection

- **Haiku** for all job chat messages
- **Sonnet fallback** only on Haiku tool-call failure (automatic, transparent)
- No Opus — overkill for section management

---

## Execution Phases

| Phase | Scope | Estimate |
|-------|-------|----------|
| A | System prompt builder + tool definitions | 0.5 session |
| B | SSE chat endpoint + tool dispatch (section updates, field updates) | 1 session |
| C | Payment + document tools, diff check, Sonnet fallback | 0.5 session |
| D | Frontend: SSE streaming, undo button, panel refresh | 1 session |

**Total: ~3 sessions**

---

## Success Criteria

- Paste raw text → Claude categorizes and fills the right sections
- Paste color codes → Products section updated with existing content preserved
- "Sand railings is done" → removed from To Do
- "Record $500 e-transfer today" → payment recorded, balance updated in chat
- "Generate invoice" → new version saved, "check Docs tab" response
- Diff check blocks accidental deletions
- Undo button reverts last change
- Haiku handles 90%+ of interactions without fallback
- Chat history capped at 15 messages sent to Claude
- Job detail panel refreshes after every tool call
