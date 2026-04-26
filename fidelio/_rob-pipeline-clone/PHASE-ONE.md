# Phase One: Editor Onboarding & Launch

This doc is for Robert. Not for editors — that's `onboarding.html`.

---

## Before You Push

- [ ] `.env` is in `.gitignore` — confirm it's not tracked (`git status` should not show `.env`)
- [ ] `credentials.json` is NOT in the repo — confirm it lives at an absolute path outside the repo folder
- [ ] `config/clients/dre-alexandra.json` has placeholder paths (no hardcoded `/Users/robertsinclair/...`)
- [ ] Add `review_token` to `config/clients/dre-alexandra.json` — generate one: `python3 -c "import secrets; print(secrets.token_hex(20))"`
- [ ] Create `config/clients/dre-alexandra.template.json` with empty placeholder paths as reference for editors
- [ ] Push to GitHub (private repo)
- [ ] Share the Google Sheet with each editor's service account email (visible inside their `credentials.json` under `client_email`)

---

## What to Send Each Editor

1. Link to the private GitHub repo
2. The `credentials.json` file (direct file send — do NOT commit it)
3. The `BLOTATO_API_KEY` value
4. Their `review_token` and the full client review URL: `http://localhost:5400/client/dre-alexandra?token=<token>`
5. Link to `onboarding.html` (open locally in browser, or host it somewhere)

---

## Editor Setup Sequence

1. Check system requirements (onboarding.html header bar)
2. Clone repo: `git clone <repo-url>`
3. Run: `bash setup.sh`
4. Place `credentials.json` somewhere stable (e.g. `~/.fidelio/credentials.json`)
5. Fill in `.env` — use the API Keys section in `onboarding.html` as reference
6. Update `config/clients/dre-alexandra.json` — set `ingest_folder` and `watch_folder` to their local paths
7. Start: `source venv/bin/activate && python local/start.py --client dre-alexandra`
8. Drop a 30-second test clip into `ingest_folder` → verify Monitor shows progress → verify row appears in Sheet

---

## Smoke Test (each editor runs independently)

- [ ] Drop test clip → Monitor UI at `localhost:5401` shows processing stages
- [ ] Pass 1 completes → row appears in `Clip Index` tab of Google Sheet
- [ ] Drop same clip (or a short export) into `watch_folder` → Pass 2 runs
- [ ] Pass 2 completes → row in `Exports` tab → `Review URL` column populated with FAL CDN link
- [ ] Open `localhost:5400/review/dre-alexandra` → clip visible in sidebar
- [ ] Open `localhost:5400/client/dre-alexandra?token=<token>` → clip card visible with Watch button
- [ ] Approve clip in Review UI → Sheet `Status` updates to `Approved`
- [ ] Client approve in client review page → Sheet `Status` updates to `Client Approved`

---

## Ongoing Update Protocol

| Change | What to do |
|--------|-----------|
| Code update (pipeline logic, UI) | Robert: `git commit` + `git push` · Editor: `git pull` + restart daemon |
| Google Sheet structure (new column, tab) | Coordinate first — changes are live for everyone immediately |
| Client JSON paths | Each editor edits their own copy locally — not pushed |
| API key rotation | Each editor updates their own `.env` — not pushed |
| Client review token rotation | Update `config/clients/<id>.json` + push + editor pulls |

---

## Phase One Scope Limits

- Review UI is localhost-only on each editor's machine — no shared server
- Client review page is also localhost for now — Railway deployment is Phase Two
- One active client config: `dre-alexandra`
- Adding a new client: copy `config/clients/dre-alexandra.json` → new file → update paths + `sheets_id` + `review_token`
