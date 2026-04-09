---
name: Ostéopeinture Quote Assistant — Status & Pending
description: Live Railway deployment status, all shipped fixes, and next-session tasks for the quote assistant
type: project
---

## What it is
A Node.js/Express chat-based quoting tool for Ostéopeinture. User describes a job in chat, Claude (claude-sonnet-4-6) gathers info, generates a structured quote, renders a PDF, and emails it to the client.

## Live deployment
- **Railway project:** moksha-tools
- **Service:** osteopeinture-quotes
- **Repo:** mokshatools-team/osteopeinture-quotes (GitHub, connected to Railway main branch — push to main = auto-deploy)
- **Local path:** `/Users/loric/MOKSHA/FIDELIO Automations/osteopeinture-quote-assistant/`
- **Railway env vars set:** ANTHROPIC_API_KEY, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, PORT, DATA_DIR=/data
- **Local .env:** created at project root with ANTHROPIC_API_KEY (for running past-quotes scripts locally)

## All shipped (as of 2026-04-01)
1. Atelier Noir dark UI redesign (Cormorant + Outfit fonts)
2. Quoting Rules admin modal — edit QUOTING_LOGIC.md from browser, no redeploy needed
3. QUOTING_LOGIC.md seeded from repo to /data on first deploy, editable in browser
4. Dynamic system prompt built from QUOTING_LOGIC.md on every request
5. Two-mode quoting flow: ballpark vs full quote
6. Node 20 Dockerfile fix (was breaking on Node 24)
7. Image upload pipeline: up to 15 images, HEIC conversion, drag-and-drop (Codex — implemented but NOT smoke-tested)
8. QUOTING_LOGIC.md now covers both interior AND exterior quoting (Sections 1–29)
9. Exterior quoting logic added: products with prices, access equipment, benchmarks, quote structure
10. Trim tiers simplified: PM200 HP default, BM Advance as optional upgrade
11. Interior room price benchmarks added (Section 22) from 2024–2025 quote analysis
12. Sidebar quote names now show LASTNAME_## (project_id) as primary label
13. Mobile-friendly layout: sliding sidebar overlay, quote panel full-screen on mobile, hamburger + back buttons
14. Chat header title now shows LASTNAME_## / client name dynamically (not static "Chat")
15. iOS autofill toolbar suppressed via autocomplete/form-type attributes
16. PWA support added: manifest.json + apple-mobile-web-app meta tags — Add to Home Screen = full-screen, no browser chrome
17. Safe-area insets for iPhone notch on input area

## iOS autofill bar note
autocomplete="off" reduces but doesn't fully eliminate iOS autofill bar in Safari browser tab. Full fix: Add to Home Screen (PWA standalone mode) — no autofill bar, no browser chrome at all.

## Past quotes pipeline (local, not deployed)
- 252 PDFs scraped from Gmail (info@ + osteopeinture@)
- Classified into: interior/133, exterior/70, both/10, not-quotes/35
- 2024 PDFs (111) scraped separately (were missing from first scrape)
- Extraction run on 2024–2025 quotes only (94 total): extracted-interior.json, extracted-exterior.json, extracted-both.json
- interior-patterns.md + exterior-patterns.md generated — used to build QUOTING_LOGIC.md exterior section
- Scripts: `past-quotes/classify.js`, `past-quotes/scrape-gmail.js`, `past-quotes/extract.js`

## Pending next session
1. **Exterior primer prices** — Seal Grip, SW Oil-Based Wood Primer, Kembond, ProCry — user to provide cost prices, apply 15% margin, update Section 25 of QUOTING_LOGIC.md
2. **Smoke test image upload** — Codex implemented it (lib/image-upload.js) but never tested. Test: upload HEIC from iPhone, drop 10-15 images, generate quote + send test email
3. **search_past_quotes tool** — low priority. Load extracted JSON into server, add tool-use so assistant can reference past quotes by client/address/type
