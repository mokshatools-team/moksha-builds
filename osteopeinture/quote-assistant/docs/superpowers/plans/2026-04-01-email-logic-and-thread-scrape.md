# Email Logic And Thread Scrape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Gmail scrape pipeline to capture relevant email-thread context from January 1, 2025 through today, derive a reusable email pattern dataset, and codify those patterns in `EMAIL_LOGIC.md` for Quote Assistant.

**Architecture:** Keep the existing IMAP-based scraper, but split the workflow into focused phases: message/thread extraction, thread grouping, pattern analysis, and final email-logic authoring. Persist structured JSON under `past-quotes/email-history/`, persist human-readable pattern analysis in `past-quotes/email-patterns.md`, and keep the reusable operating rules in a top-level `EMAIL_LOGIC.md` separate from `QUOTING_LOGIC.md`.

**Tech Stack:** Node.js, IMAP/mailparser, local JSON artifacts, markdown documentation, existing `past-quotes/` tooling.

---

## File Structure

- Modify: `osteopeinture-quote-assistant/past-quotes/scrape-gmail.js`
- Create: `osteopeinture-quote-assistant/past-quotes/analyze-email-patterns.js`
- Create: `osteopeinture-quote-assistant/past-quotes/email-history/threads.json`
- Create: `osteopeinture-quote-assistant/past-quotes/email-history/messages.json`
- Create: `osteopeinture-quote-assistant/past-quotes/email-history/attachments.json`
- Create: `osteopeinture-quote-assistant/past-quotes/email-patterns.md`
- Create: `osteopeinture-quote-assistant/EMAIL_LOGIC.md`
- Optionally modify: `osteopeinture-quote-assistant/past-quotes/package.json`

### Task 1: Upgrade The Gmail Scraper To Capture Email Context

**Files:**
- Modify: `osteopeinture-quote-assistant/past-quotes/scrape-gmail.js`
- Create: `osteopeinture-quote-assistant/past-quotes/email-history/threads.json`
- Create: `osteopeinture-quote-assistant/past-quotes/email-history/messages.json`
- Create: `osteopeinture-quote-assistant/past-quotes/email-history/attachments.json`

- [ ] **Step 1: Add output directories and filenames**

Update `past-quotes/scrape-gmail.js` so it initializes:

```js
const EMAIL_HISTORY_DIR = path.join(__dirname, 'email-history');
const THREADS_PATH = path.join(EMAIL_HISTORY_DIR, 'threads.json');
const MESSAGES_PATH = path.join(EMAIL_HISTORY_DIR, 'messages.json');
const ATTACHMENTS_PATH = path.join(EMAIL_HISTORY_DIR, 'attachments.json');

if (!fs.existsSync(EMAIL_HISTORY_DIR)) {
  fs.mkdirSync(EMAIL_HISTORY_DIR, { recursive: true });
}
```

- [ ] **Step 2: Add reusable body/header normalization helpers**

Add helpers in `scrape-gmail.js` for:

- subject normalization
- participant normalization
- body-text cleanup
- signature extraction
- sign-off extraction
- header extraction for `message-id`, `in-reply-to`, and `references`

Expected helper shape:

```js
function normalizeSubject(subject) {
  return String(subject || '')
    .replace(/^\s*((re|fwd):\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmailBody(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractHeaderValue(parsed, headerName) {
  return parsed.headers?.get(headerName) || null;
}
```

- [ ] **Step 3: Expand message extraction beyond PDF attachments**

Inside the message parse flow, collect a structured message record like:

```js
const messageRecord = {
  account: user,
  folder,
  uid: uid,
  date: parsed.date ? new Date(parsed.date).toISOString() : null,
  direction: folder.includes('Sent') ? 'sent' : 'received',
  subject: parsed.subject || '',
  normalizedSubject: normalizeSubject(parsed.subject),
  from: parsed.from?.text || '',
  to: parsed.to?.text || '',
  cc: parsed.cc?.text || '',
  messageId: extractHeaderValue(parsed, 'message-id'),
  inReplyTo: extractHeaderValue(parsed, 'in-reply-to'),
  references: extractHeaderValue(parsed, 'references'),
  text: normalizeEmailBody(parsed.text || parsed.html || ''),
  attachments: (parsed.attachments || []).map((att) => ({
    filename: att.filename || null,
    contentType: att.contentType || null,
    size: att.size || att.content?.length || 0,
    isPdf: (att.filename || '').toLowerCase().endsWith('.pdf'),
  })),
};
```

- [ ] **Step 4: Restrict the scrape window to January 1, 2025 through today**

Replace the old date search with:

```js
imap.search([['SINCE', '1-Jan-2025']], (err, uids) => {
```

Use a runtime date cutoff if needed to exclude future-dated anomalies.

- [ ] **Step 5: Filter messages to the relevant email-analysis corpus**

Add a filter helper in `scrape-gmail.js`:

```js
function isRelevantEmailRecord(message) {
  const haystack = [
    message.subject,
    message.text,
    ...message.attachments.map((att) => att.filename || ''),
  ].join(' ').toLowerCase();

  const signals = [
    'quote',
    'painting quote',
    'soumission',
    'estimate',
    'devis',
    'visit',
    'estimate booking',
    'photos',
    'project',
    'intake',
  ];

  const hasPdf = message.attachments.some((att) => att.isPdf);
  return hasPdf || signals.some((signal) => haystack.includes(signal));
}
```

Store only relevant messages in the JSON dataset, but continue saving quote PDFs to `pdfs/` when present.

- [ ] **Step 6: Group relevant messages into threads conservatively**

After scraping all relevant messages, build thread groups using:

1. `messageId` / `inReplyTo` / `references`
2. fallback subject normalization
3. participant overlap and close date proximity

Expected thread record shape:

```js
const threadRecord = {
  id: threadId,
  account,
  firstDate,
  lastDate,
  participants,
  normalizedSubject,
  messageIds,
  directions,
  hasPdfQuote,
  includesEstimateVisit,
  includesPhotoRequest,
  includesFormRequest,
};
```

- [ ] **Step 7: Persist the extracted dataset**

Write:

```js
fs.writeFileSync(MESSAGES_PATH, JSON.stringify(messages, null, 2));
fs.writeFileSync(THREADS_PATH, JSON.stringify(threads, null, 2));
fs.writeFileSync(ATTACHMENTS_PATH, JSON.stringify(attachments, null, 2));
```

- [ ] **Step 8: Run the scraper and verify artifact creation**

Run: `node past-quotes/scrape-gmail.js`

Expected:

- `past-quotes/email-history/messages.json` exists
- `past-quotes/email-history/threads.json` exists
- `past-quotes/email-history/attachments.json` exists
- existing PDF download behavior still works for relevant quote attachments

- [ ] **Step 9: Commit**

```bash
git add past-quotes/scrape-gmail.js past-quotes/email-history
git commit -m "feat: scrape relevant quote and lead email threads"
```

### Task 2: Build A Pattern Analysis Script For The Email Dataset

**Files:**
- Create: `osteopeinture-quote-assistant/past-quotes/analyze-email-patterns.js`
- Create: `osteopeinture-quote-assistant/past-quotes/email-patterns.md`
- Optionally modify: `osteopeinture-quote-assistant/past-quotes/package.json`

- [ ] **Step 1: Create a script that loads the thread dataset**

Create `past-quotes/analyze-email-patterns.js`:

```js
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const EMAIL_HISTORY_DIR = path.join(__dirname, 'email-history');
const THREADS_PATH = path.join(EMAIL_HISTORY_DIR, 'threads.json');
const MESSAGES_PATH = path.join(EMAIL_HISTORY_DIR, 'messages.json');
const OUTPUT_PATH = path.join(__dirname, 'email-patterns.md');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const threads = readJson(THREADS_PATH);
const messages = readJson(MESSAGES_PATH);
```

- [ ] **Step 2: Add first-pass scenario classification**

Add classification helpers for:

- quote_send
- quote_revision
- quote_follow_up
- lead_triage
- lead_more_info
- decline
- mixed / unknown

Example shape:

```js
function classifyThread(thread, threadMessages) {
  const text = threadMessages.map((m) => `${m.subject}\n${m.text}`).join('\n').toLowerCase();
  if (text.includes('attached') && text.includes('quote')) return 'quote_send';
  if (text.includes('revised') || text.includes('updated quote')) return 'quote_revision';
  if (text.includes('not a fit') || text.includes('fully booked')) return 'decline';
  if (text.includes('send photos') || text.includes('more details')) return 'lead_more_info';
  return 'mixed';
}
```

- [ ] **Step 3: Extract recurring pattern signals**

Summarize at minimum:

- top subject patterns
- signer/sign-off patterns
- signature block variants
- language split
- quote-send body styles
- when explanatory / phased emails are used
- decline patterns
- more-info / intake-request patterns

Generate markdown sections like:

```md
## Subject Patterns
## Signer Patterns
## Quote Send Patterns
## Revision Patterns
## Decline Patterns
## More-Info / Intake Patterns
```

- [ ] **Step 4: Write the pattern analysis artifact**

Write `past-quotes/email-patterns.md` with a concise analysis derived from the dataset.

- [ ] **Step 5: Add a package script if useful**

If `past-quotes/package.json` exists, add:

```json
{
  "scripts": {
    "analyze-email": "node analyze-email-patterns.js"
  }
}
```

- [ ] **Step 6: Run the analysis script**

Run: `node past-quotes/analyze-email-patterns.js`

Expected:

- `past-quotes/email-patterns.md` is created or updated
- output sections reflect the 2025-present dataset

- [ ] **Step 7: Commit**

```bash
git add past-quotes/analyze-email-patterns.js past-quotes/email-patterns.md past-quotes/package.json
git commit -m "feat: analyze scraped email threads into pattern summary"
```

### Task 3: Author The Shared EMAIL_LOGIC.md File

**Files:**
- Create: `osteopeinture-quote-assistant/EMAIL_LOGIC.md`
- Read: `osteopeinture-quote-assistant/past-quotes/email-patterns.md`

- [ ] **Step 1: Create the EMAIL_LOGIC.md skeleton**

Create:

```md
# OSTÉOPEINTURE — EMAIL LOGIC

## 1. PURPOSE
## 2. SHARED TONE RULES
## 3. LANGUAGE RULES
## 4. SUBJECT LINE RULES
## 5. SIGNER RULES
## 6. QUOTE-SEND EMAIL RULES
## 7. QUOTE-REVISION EMAIL RULES
## 8. QUOTE FOLLOW-UP RULES
## 9. LEAD TRIAGE RULES
## 10. MORE-INFO / INTAKE-REQUEST RULES
## 11. DECLINE RULES
## 12. REQUIRED VARIABLES BEFORE DRAFTING
## 13. WHAT TO AVOID
```

- [ ] **Step 2: Populate subject-line rules from the analyzed patterns**

Document rules for:

- `Painting Quote`
- address
- short-form location/address token
- month when known
- season when month is not known

Include examples:

```md
- Preferred English subject pattern: `Painting Quote — <address> — <short token> — <month/season year>`
- Preferred French subject pattern: `Soumission peinture — <address> — <short token> — <month/season year>`
```

- [ ] **Step 3: Populate signer rules for Loric, Graeme, and Lubo**

Capture:

- explicit signer selection requirement
- preferred sign-off wording per signer
- signature block per signer

Expected style:

```md
- Quote Assistant should ask: `Who should sign this? Loric / Graeme / Lubo`
- Use the signer-specific sign-off and signature block exactly as defined below.
```

- [ ] **Step 4: Populate quote-send and quote-revision logic**

Write scenario rules for:

- minimal direct quote-send
- slightly contextual quote-send
- phase-heavy / explanation-heavy quote-send
- revised quote sends
- when to reference the call, visit, or prior discussion

- [ ] **Step 5: Populate lead-triage and more-info logic at the branch level**

Do **not** build the intake workflow. Only define branch logic for future reuse:

- decline:
  - too busy
  - outside service area
  - wrong job type
  - not interested / low-fit
- more info:
  - ask for photos
  - ask for scope details
  - ask for scheduling constraints
  - ask for budget-priority signal

- [ ] **Step 6: Add drafting variable requirements**

Document required fields before drafting:

- signer
- client name
- address
- quote timing token
- language
- scenario type
- whether phases / revisions need to be mentioned

- [ ] **Step 7: Review the file for overfitting**

Read the file once and remove:

- one-off phrasing that appears idiosyncratic
- examples that are too specific to one client
- logic that belongs in a future intake-form build instead of this file

- [ ] **Step 8: Commit**

```bash
git add EMAIL_LOGIC.md
git commit -m "docs: add reusable email drafting logic"
```

### Task 4: Record Verification Notes And Handoff Constraints

**Files:**
- Modify: `osteopeinture-quote-assistant/docs/superpowers/plans/2026-04-01-email-logic-and-thread-scrape.md`

- [ ] **Step 1: Run the end-to-end local flow**

Run:

- `node past-quotes/scrape-gmail.js`
- `node past-quotes/analyze-email-patterns.js`

Expected:

- email-history JSON files exist
- `email-patterns.md` exists
- `EMAIL_LOGIC.md` exists

- [ ] **Step 2: Manually inspect the dataset quality**

Manual checks:

- confirm at least a few threads include both sent and received messages
- confirm signer inference is usable
- confirm subject patterns resemble real quote-send history
- confirm the resulting `EMAIL_LOGIC.md` is useful for Quote Assistant immediately

- [ ] **Step 3: Append verification notes to this plan**

Append:

```md
## Verification Notes

- Date:
- Commands run:
- Thread/sample checks:
- Pattern-analysis checks:
- Remaining risks:
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-04-01-email-logic-and-thread-scrape.md
git commit -m "docs: record email logic pipeline verification results"
```
