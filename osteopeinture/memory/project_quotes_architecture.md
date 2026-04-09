---
name: Ostéopeinture Quote Assistant — Technical Architecture
description: Stack, key patterns, Docker setup, and how the quoting pipeline works end-to-end
type: project
---

## Stack
- Runtime: Node.js / Express
- AI: Anthropic SDK (claude-sonnet-4-6)
- PDF: Playwright (headless Chromium) — renders HTML quote template to PDF
- DB: better-sqlite3 (SQLite) — sessions, quote JSON, client data
- Email: nodemailer + Gmail SMTP (App Password for info@osteopeinture.com)
- Frontend: vanilla JS, marked.js CDN for markdown rendering
- Base Docker image: `mcr.microsoft.com/playwright:v1.44.0-jammy`

## Dockerfile — critical detail
Must install build tools BEFORE npm install (better-sqlite3 requires native compilation):
```dockerfile
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
```
Without this, Railway build fails with `gyp ERR! not found: make`.

## Quoting pipeline
1. User chats → Claude gathers: client name, address, room list, surfaces, conditions
2. Phase 2: Claude generates a pre-generation markdown summary (### headers, bullets, bold numbers — NO tables)
3. User confirms → Claude outputs structured JSON (quote data)
4. Server parses JSON → renders HTML template → Playwright renders PDF
5. UI shows "Send Email" button → user enters client email → nodemailer sends PDF attachment

## Quote JSON structure (key fields)
- clientName, projectId (LASTNAME_01 format), address, projectType
- sections[] → each has floor label, items[] with description + price
- paintProducts[] → product name, quantity, unit price, total
- laborHours, laborRate, consumables, subtotal, deposit, taxes, total
- paymentTerms, generalConditions[]

## SQLite persistence
- Survives container restarts, wiped on Railway redeploy (no volume mounted for SQLite)
- DATA_DIR env var controls DB location (/data on Railway — but no volume = ephemeral)

## Paint pricing logic (system prompt rules)
- SW prices are already client prices (pre-tax + 15% markup baked in)
- BM prices are pre-tax; 15% markup applied; QC taxes added at invoice
- High-end tier: Duration Home walls + BM Advance trim
- Standard tier: SuperPaint walls + PM200 HP trim
- Primers: match surface condition exactly (Extreme Bond=glossy, Extreme Block=oil/stains, Shellac=knots/smoke)

## QC Taxes
- GST: 5.000% — #7784757551RT0001
- QST: 9.975% — #1231045518
- Applied to full subtotal at invoice
