# OstéoPeinture Quote Assistant — CONTEXT.md

Last updated: 2026-04-03

---

## What This Tool Does

The Quote Assistant is an internal web app used by Loric, Graeme, and Lubo to build painting quotes and draft client emails. It is not a client-facing tool — it is an admin dashboard for the OstéoPeinture team.

You describe the job to the AI assistant (client name, address, surfaces, scope, materials). The assistant asks clarifying questions, applies the quoting rules from `QUOTING_LOGIC.md`, and produces a structured quote as a JSON object. That JSON then renders into a formatted PDF quote ready to send. A separate email panel in the same app generates the client-facing covering email for that quote.

---

## The Two Sub-Tools

### 1. Quote Generator

**What it does:** Chat-based AI interface. You describe a job, the assistant gathers details, runs the math, and outputs a structured JSON quote. Covers interior and exterior jobs, room-by-room or surface-by-surface. The JSON renders into a styled HTML page and can be downloaded as a PDF via the `/preview/:id` and `/api/sessions/:id/pdf` routes.

**Brain:** `QUOTING_LOGIC.md` — full interior and exterior estimating rules, labour rates, paint products, primers, floor protection, consumables, taxes, deposit logic, and client-facing quote structure. The server seeds this file to the persistent `data/` volume on first run so it survives Railway restarts.

**Status:** Working. Core quote flow (chat → JSON → PDF) is complete and deployed. Image uploads (up to 15 images, JPEG/PNG/WebP/HEIC) are supported. Drag-and-drop image attachment works globally on the page.

**Known limitations:**
- Exterior quoting is supported in `QUOTING_LOGIC.md` but some primer prices are marked `⚠️ Price TBC` (Seal Grip, Kembond Metal, galvanized metal primer).
- Ceiling and area-measured trim benchmarks are provisional — they fall back to the wall rate (1.64 min/sqft) until proper benchmarks are confirmed.
- Operational time items (setup, teardown, protection, prep, touch-ups, cleanup) are flagged as `fallback allowance / manual-adjustment items` — not exact formulas.
- PDF generation depends on Playwright/Chromium running inside the Docker container. If Playwright fails on Railway, PDF generation breaks silently.
- `quoting-logic` editor UI at `/api/quoting-logic` (GET/PUT) exists but is only useful for admin review — changes go to the persistent volume, not back to the repo file.

---

### 2. Email Draft Tool

**What it does:** After a quote is built, a side panel in the same UI generates a client-facing email draft. The assistant selects a scenario (`quote_send`, `quote_revision`, `quote_follow_up`, `quote_promise`, `decline`, `lead_more_info`, `lead_follow_up`, `project_update`), picks the signer (Loric / Graeme / Lubo), and drafts a short bilingual email in the tone defined by `EMAIL_LOGIC.md`.

**Brain:** `EMAIL_LOGIC.md` — tone rules, subject line format, signer-specific sign-offs, scenario logic for each email type, detail-level rules (minimal / standard / detailed), and what not to do. The file was written by analyzing scraped OstéoPeinture Gmail threads from January 2025 onward.

**Future connection:** `EMAIL_LOGIC.md` is intentionally shared — it is the communication brain for future lead intake and email automation. The Quote Assistant currently only exposes `quote_send` and `quote_revision` in its UI. The other branches are preserved in the code for future automation use.

**Status:** Implemented and deployed. The email panel builds a draft on the server using `buildScenarioBody()` and `buildEmailSubject()`. The `/api/sessions/:id/send-email` route attaches the quote as a PDF and sends it via SMTP (Gmail). Auto-scenario detection from conversation text is in place. Manual scenario override is also supported via the email panel UI.

**Known limitations:**
- `send-email` depends on SMTP credentials (`SMTP_USER`, `SMTP_PASS`) set in Railway. If those are missing, email sending fails silently — no visible error in the UI.
- The email panel is only available when a quote JSON exists for the session. You cannot draft a standalone email without first completing a quote.
- The Gmail scraper (`past-quotes/scrape-gmail.js`) ran and produced the email dataset. The `past-quotes/email-history/` artifacts exist. This scraper is a one-time local tool — it is not deployed or accessible on Railway.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥20 |
| Framework | Express 4 |
| AI | Anthropic Claude API (`claude-sonnet-4-6`), `@anthropic-ai/sdk` |
| Database | SQLite via `better-sqlite3` (sessions, quote JSON, email metadata) |
| PDF generation | Playwright + Chromium (headless, runs in Docker) |
| Email sending | Nodemailer (SMTP, defaults to Gmail) |
| Image handling | Multer (upload), Sharp (resize/compress), heic-convert (HEIC → JPEG) |
| Containerization | Docker (Railway uses Dockerfile) |
| Deployment | Railway (manual deploy via `railway up`) |
| Unique IDs | `uuid` |

**Environment variables required (set in Railway dashboard):**
- `ANTHROPIC_API_KEY` — Claude API key
- `SMTP_USER` — Gmail address for outbound email
- `SMTP_PASS` — Gmail app password for SMTP
- `SMTP_HOST` — optional, defaults to `smtp.gmail.com`
- `SMTP_PORT` — optional, defaults to `587`
- `DATA_DIR` — optional, defaults to `./data`; Railway volume should mount here for persistence

---

## Live Railway URL

**https://op-quote-assistant.up.railway.app**

---

## Current Status

| Feature | Status |
|---|---|
| Quote chat (interior) | Working |
| Quote chat (exterior) | Working (some primer prices TBC) |
| Quote JSON → HTML render | Working |
| Quote JSON → PDF download | Working (requires Playwright in Docker) |
| Image upload (JPEG/PNG/WebP) | Working |
| Image upload (HEIC) | Working |
| Drag-and-drop image attachment | Working |
| Email draft panel | Working |
| Email send via SMTP | Working (requires SMTP env vars) |
| Session list / history | Working |
| Quoting logic editor (admin) | Working (edits volume only, not repo) |
| Gmail scraper (past-quotes) | Ran once locally — dataset exists, not deployed |
| Email pattern analysis | Ran once locally — `email-patterns.md` exists |

---

## Known Issues and Limitations

1. **Railway URL not confirmed** — cannot verify the live deployment without relinking.
2. **Exterior primer prices TBC** — Seal Grip, Kembond, galvanized primer prices are flagged in `QUOTING_LOGIC.md` but not finalized.
3. **Ceiling/trim benchmarks are provisional** — the wall benchmark is used as a fallback; real ceiling and trim benchmarks are not yet confirmed from job data.
4. **Playwright Chromium risk** — PDF and email attachment generation depend on Chromium running inside Docker. If Playwright fails to launch (e.g., missing system deps in the Docker build), both `/api/sessions/:id/pdf` and `/api/sessions/:id/send-email` will fail. Check Railway logs if PDF is broken.
5. **Email send has no visible failure state in the UI** — if SMTP credentials are wrong or missing, the send fails but the frontend may not surface a clear error.
6. **Email panel requires a quote** — you cannot use the email tool without completing a quote first. Standalone email drafting is not possible in the current UI.
7. **No automated tests for the full server flow** — `tests/` has `image-upload.test.js` and `server-messages.test.js` but coverage is partial.
8. **Session storage is local SQLite** — sessions are stored in `data/sessions.db` on the Railway volume. If the volume is wiped or not mounted, all session history is lost.

---

## What Was Last Worked On (as of 2026-04-01 to 2026-04-03)

Two major implementation plans were executed:

1. **Upload pipeline and internal tone** (`2026-04-01-upload-pipeline-and-internal-tone.md`):
   - Added `lib/image-upload.js` with HEIC conversion, Sharp-based compression, request budgeting, and batch normalization.
   - Wired the image pipeline into the `/api/sessions/:id/messages` route.
   - Switched the assistant system prompt to an internal admin tone (terse, no pleasantries).
   - Added global drag-and-drop image attachment on the frontend.

2. **Email logic and Gmail thread scrape** (`2026-04-01-email-logic-and-thread-scrape.md`):
   - Ran the Gmail scraper (`past-quotes/scrape-gmail.js`) to capture OstéoPeinture email history since January 2025.
   - Built `past-quotes/analyze-email-patterns.js` and generated `past-quotes/email-patterns.md`.
   - Authored `EMAIL_LOGIC.md` from the pattern analysis.
   - Integrated `EMAIL_LOGIC.md` into the server's email draft panel.

---

## What Needs to Happen Next

### Quote Generator
- [ ] Confirm live Railway URL and verify the full quote flow end to end on the live server.
- [ ] Confirm or replace the TBC exterior primer prices in `QUOTING_LOGIC.md` (Seal Grip, Kembond Metal, galvanized metal).
- [ ] Validate the ceiling benchmark from actual job data and update `QUOTING_LOGIC.md` Section 20 when confirmed.
- [ ] Test Playwright PDF generation on the live Railway deploy — confirm it works or diagnose Chromium issue.

### Email Draft Tool
- [ ] Confirm SMTP credentials are set in Railway and test a live email send.
- [ ] Verify auto-scenario detection is producing the right scenario for recent jobs.
- [ ] Future: expose the other email scenarios (follow-up, decline, lead) in the UI for standalone email drafting (not dependent on a quote session).
- [ ] Future: connect to the lead intake and email automation workflow — `EMAIL_LOGIC.md` is already structured for this.

---

## Key Files

| File | What It Does |
|---|---|
| `server.js` | Main Express server — all routes, Claude integration, session management, email logic, PDF generation |
| `QUOTING_LOGIC.md` | Estimating brain — all quoting rules (interior + exterior), labour rates, paint products, primers, taxes, deposit logic |
| `EMAIL_LOGIC.md` | Communication brain — email tone, scenario rules, subject line format, signer sign-offs |
| `lib/image-upload.js` | Image normalization pipeline — HEIC conversion, Sharp compression, Anthropic request builder |
| `public/index.html` | Single-page frontend — chat UI, image picker, drag-and-drop, email panel, session list |
| `public/quote_template.html` | Quote HTML template used for PDF rendering and preview |
| `railway.toml` | Railway deployment config — uses Dockerfile, starts with `node server.js` |
| `Dockerfile` | Container build — Node.js base, installs Playwright/Chromium for PDF generation |
| `data/sessions.db` | SQLite database on Railway volume — stores sessions, quote JSON, email metadata |
| `data/QUOTING_LOGIC.md` | Persistent copy of quoting logic on the Railway volume (seeded from repo on first run) |
| `data/EMAIL_LOGIC.md` | Persistent copy of email logic on the Railway volume (seeded from repo on first run) |
| `past-quotes/scrape-gmail.js` | Local-only Gmail scraper — ran once to extract OstéoPeinture email history |
| `past-quotes/email-history/` | Output of the scraper — `messages.json`, `threads.json`, `attachments.json` |
| `past-quotes/email-patterns.md` | Pattern analysis output — signer styles, subject patterns, scenario classifications |
| `tests/image-upload.test.js` | Unit tests for the image normalization module |
| `tests/server-messages.test.js` | Integration tests for the message route |
| `docs/superpowers/plans/` | Implementation plans for the upload pipeline and email logic builds |
