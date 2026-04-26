# OstéoPeinture Finance Chat — Build Spec
## Conversational transaction entry for mobile

---

## What We're Building

A mobile-first chat interface where Loric types plain English like "Paid Lubo $800 cash for Murray Hill" and it becomes a validated row in the 2026 Google Sheet. Deployed on Railway. Works on iPhone (Safari and Chrome).

**This is NOT:**
- A full accounting system
- A multi-user platform
- Connected to the quote-assistant (manual for now)
- Backed by Postgres (Sheets-direct for MVP — migration path exists)

---

## Architecture

```
Loric's phone (Safari/Chrome)
    ↓ HTTPS
Railway FastAPI app
    ↓ Claude API (structured extraction)
    ↓ Deterministic validation rules
    ↓ gspread (service account)
Google Sheets — Transactions tab
```

Single app. No database. No background jobs. No sync layer.

Session state (conversation history) stored in-memory on the server. If the app restarts, history resets — acceptable for MVP.

---

## Tech Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Backend | Python + FastAPI | Simple, async, Railway-friendly |
| Frontend | Single HTML file with vanilla JS | Same pattern as quote-assistant, no build step |
| Sheets access | gspread + service account | Server-side, permanent auth, no token refresh |
| NLP | Claude API (Sonnet) | Structured extraction with tool_use schema |
| Hosting | Railway | Existing account, Dockerfile deploy |
| Mobile | Responsive HTML/CSS | Same iOS patterns as quote-assistant |

---

## Supported Transaction Types (MVP — 5 only)

| # | Type | Example Input | What Gets Written |
|---|------|--------------|-------------------|
| 1 | **Supply purchase** | "Home Depot $340 paint for Murray Hill" | Account: BMO MC or Cash, Category: Supplies, Job: KENNERKNECHT_01 |
| 2 | **Owner draw/dividend** | "Paid Loric $2,000 advance" | Account: RBC/Cash, Counterpart: Owner: Loric, Category: Transfer, Transfer Type: Owner Advance |
| 3 | **Transfer** | "Paid BMO card $1,500 from RBC" | Account: RBC (-$1,500), Counterpart: BMO MC (+$1,500), Category: Transfer, Transfer Type: Credit Card Payment |
| 4 | **Client revenue** | "Received $16,500 from Kennerknecht job" | Account: RBC, Category: Contract Revenue, Job: KENNERKNECHT_01 |
| 5 | **Worker payment** | "Paid Edler $650 cash for Chaut job" | Account: Cash, Category: Labor Wages, Job: CHAUT_01 |

Anything outside these 5: the app says "I don't recognize this type — please enter it manually in the sheet."

---

## Claude Extraction Schema

Input: user's plain text message + current date.

Claude returns structured JSON (via tool_use), NOT free-form text:

```json
{
  "transaction_date": "2026-04-04",
  "description": "Paid Edler $650 cash for Chaut job",
  "amount": 650.00,
  "direction": "money_out",
  "payment_method": "cash",
  "counterparty": "Edler",
  "job_hint": "Chaut",
  "category_hint": "labor",
  "confidence": 0.95,
  "ambiguities": []
}
```

Claude does NOT decide final account mappings. Deterministic rules do that.

---

## Validation Rules (deterministic — no LLM)

### Account Mapping Rules

```
IF direction = money_out AND payment_method = cash     → Account = Cash
IF direction = money_out AND payment_method = bank     → Account = RBC
IF direction = money_out AND payment_method = e_transfer → Account = RBC
IF direction = money_out AND payment_method = credit_card → Account = BMO MC
IF direction = money_in  AND payment_method = cash     → Account = Cash
IF direction = money_in  AND payment_method = e_transfer → Account = RBC
IF direction = money_in  AND payment_method = bank     → Account = RBC
```

### Category Mapping Rules

```
IF category_hint = labor        → Category = Labor Wages, Source = Manual
IF category_hint = supplies     → Category = Supplies (Paint & Consumables)
IF category_hint = revenue      → Category = Contract Revenue
IF category_hint = owner_draw   → Category = Transfer, Transfer Type = Owner Advance
IF category_hint = transfer     → Category = Transfer, Transfer Type = (inferred from context)
IF category_hint = fuel         → Category = Van - Gas
```

### Job Code Resolution

Known jobs (loaded from Accounts/Categories tabs or hardcoded for MVP):
```
"Murray Hill" → KENNERKNECHT_01
"Kennerknecht" → KENNERKNECHT_01
"Chaut" → CHAUT_01
"Laval" → CHAUT_01
"Dufresne" → DUFRESNE_01
```

If job_hint doesn't match: leave Job blank, flag in preview.

### Validation Before Write

All must pass:
1. Amount > 0
2. Account exists in dropdown list
3. Category exists in dropdown list
4. If Category = Transfer, Transfer Type must be set
5. Date is not in the future
6. No duplicate (same date + amount + account in last 24 hours)

If any fail: show error, ask user to correct. Never write invalid data.

---

## Conversation Flow

```
USER: "Paid Edler $650 cash for Chaut job"

APP: I'll add this transaction:

    Date:        2026-04-04
    Description: Paid Edler $650 cash for Chaut job
    Account:     Cash
    Counterpart: (none — expense)
    Amount:      -$650.00
    Category:    Labor Wages
    Job:         CHAUT_01
    Source:      Manual

    ✅ Confirm    ✏️ Edit    ❌ Cancel

USER: [taps Confirm]

APP: ✓ Written to row 7 in Transactions.
     Cash balance: $311.00
```

### Query Flow

```
USER: "What did we make on Murray Hill?"

APP: Per-Job P&L for KENNERKNECHT_01:
     Revenue:        $18,900.00
     Labor (Wages):  -$1,620.00
     Direct Expenses: -$2,400.00
     Net:            $14,880.00
```

### Error Flow

```
USER: "Bought something yesterday"

APP: I need more details:
     - What was bought?
     - How much?
     - How was it paid (cash, card, e-transfer)?
```

---

## Read Queries Supported (MVP)

| Query | What It Does |
|-------|-------------|
| "What's the balance on RBC?" | Reads Account Balances tab |
| "What does the company owe Graeme?" | Reads Owner Balances tab |
| "What did we make on [job]?" | Reads Per-Job P&L tab |
| "Show last 5 transactions" | Reads last 5 rows from Transactions |
| "What's our revenue this month?" | Reads Dashboard YTD/month P&L |

All reads go through gspread. No caching for MVP.

---

## Mobile / iOS Compatibility

### Confirmed Working Patterns (from quote-assistant)

The quote-assistant is already live on Railway with a chat UI that works on iOS. We copy these exact patterns:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="mobile-web-app-capable" content="yes">
```

### iOS-Specific CSS Required

```css
/* Use dvh not vh — fixes iOS Safari address bar resize */
height: 100dvh;

/* Safe area insets for notch/home indicator */
padding-bottom: max(14px, env(safe-area-inset-bottom));
padding-top: max(14px, env(safe-area-inset-top));

/* Prevent iOS zoom on input focus */
input, textarea { font-size: 16px; }

/* Smooth scrolling for chat messages */
-webkit-overflow-scrolling: touch;
overflow-y: auto;
```

### Known iOS Quirks to Handle

1. **Keyboard push** — when the on-screen keyboard opens, iOS Safari resizes the viewport. The chat input must stay above the keyboard. Fix: use `visualViewport` API to detect keyboard height and adjust.
2. **100vh lie** — iOS Safari's `100vh` includes the address bar. Use `100dvh` (dynamic viewport height) instead.
3. **Double-tap zoom** — disabled by `maximum-scale=1.0` and `user-scalable=no` in viewport meta.
4. **SSE streaming** — works on iOS Safari 14+. No issues on Railway's HTTPS proxy.
5. **PWA add-to-home** — the `apple-mobile-web-app-capable` meta makes it behave like a native app when added to home screen. Include a `manifest.json`.

### Railway-Specific

- Railway provides HTTPS by default — no SSL issues on iOS.
- Railway's proxy passes through SSE and WebSocket correctly.
- No known iOS-specific Railway bugs.

**Bottom line: confirmed safe for iOS Safari and Chrome.** The quote-assistant proves the pattern works.

---

## File Structure

```
osteopeinture/finance-chat/
  app/
    main.py              # FastAPI app, routes, startup
    config.py            # Env vars, constants
    extract.py           # Claude API structured extraction
    rules.py             # Deterministic validation + account mapping
    sheets.py            # gspread read/write operations
    jobs.py              # Job code aliases + resolution
  public/
    index.html           # Single-file frontend (HTML + CSS + JS)
    manifest.json        # PWA manifest for add-to-home
  requirements.txt
  Dockerfile
  railway.toml
  CONTEXT.md
```

---

## Environment Variables (Railway)

```
PORT=8000
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_SHEET_ID=1de_L-9HyVC4tWBGwYTXh8HuldMUjgkW96x5xvLmpmn4
APP_PIN=<optional 4-digit PIN for basic access control>
```

- `GOOGLE_SERVICE_ACCOUNT_JSON` — the full service account key JSON, stored as a Railway env var (not a file)
- Sheet must be shared with the service account email (editor access)

---

## Future Migration Path (Sheets → Postgres)

If/when Sheets becomes a bottleneck:

1. Add hidden columns to Transactions: `entry_id` (UUID), `created_at` (timestamp)
2. Start writing these with every new entry NOW — costs nothing
3. Later: add Postgres, import historical rows, dual-write for 2 weeks
4. Switch reads to Postgres, keep Sheets as reporting surface
5. Drop dual-write, Sheets becomes sync-only

**Action for MVP:** Include `entry_id` and `created_at` in every row written. This is free insurance.

---

## Working Plan — Session by Session

### Session 1: Scaffold + Deploy Empty Shell
- Create `osteopeinture/finance-chat/` folder
- Scaffold FastAPI app with health check route
- Create Dockerfile + railway.toml
- Create single-file frontend (chat UI shell — no functionality)
- Deploy to Railway, confirm 200 OK on mobile Safari
- **Done when:** App loads on Loric's phone, shows empty chat UI

### Session 2: Google Sheets Connection
- Create service account in Google Cloud
- Share 2026 sheet with service account
- Implement `sheets.py` — read balances, read last N transactions, write row
- Test read/write from Railway logs
- **Done when:** App can read and write to the live sheet from Railway

### Session 3: Claude Extraction + Rules Engine
- Implement `extract.py` — Claude tool_use call with transaction schema
- Implement `rules.py` — account mapping, category mapping, job resolution
- Implement `jobs.py` — job alias lookup
- Wire up: message → extract → validate → preview JSON
- Test with the 5 transaction types
- **Done when:** Typing "Paid Edler $650 cash for Chaut" returns correct preview

### Session 4: Full Chat Flow
- Wire frontend to backend — send message, receive preview, confirm/cancel
- Implement confirmation → write to Sheets
- Implement post-write balance display
- Implement edit flow (user corrects a field before confirming)
- Handle error cases (ambiguous input, missing fields, duplicates)
- **Done when:** Full cycle works: type → preview → confirm → written to sheet

### Session 5: Read Queries + Polish
- Implement balance queries, job P&L queries, recent transactions
- Add PIN gate (optional)
- PWA manifest + add-to-home-screen support
- Mobile keyboard handling (visualViewport API)
- CSS polish for iPhone
- **Done when:** Loric can enter transactions AND query balances from phone

### Session 6: Real Data Testing + Launch
- Enter 10 real transactions from Loric's recent memory
- Verify all report tabs update correctly (P&L, balances, GST/QST)
- Fix edge cases found during testing
- Update CONTEXT.md with live URL and status
- **Done when:** Loric uses it for a full day of real work

### Post-Launch (as needed)
- Session 7: CSV import support (paste bank CSV, auto-categorize)
- Session 8: Uncategorized transaction flagging
- Session 9: Quote-assistant → finance connection (if wanted)
- Session 10+: Postgres migration (if needed)

---

## What This Spec Does NOT Cover

- Invoice generation (separate build in quote-assistant)
- Jibble integration (separate session after core is live)
- Multi-user auth (Loric only for now)
- Postgres backend (future migration, not MVP)
- Bank CSV auto-import from Drive folder (post-launch)
- Receipt OCR / PDF screenshot parsing (future phase)

---

*OstéoPeinture Finance Chat — Build Spec v1. Written 2026-04-04.*
