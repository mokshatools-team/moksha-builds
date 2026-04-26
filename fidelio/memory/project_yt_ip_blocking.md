---
name: YouTube IP blocking on Railway — confirmed unfixable without OAuth
description: Comprehensive test results on what works/doesn't for YouTube ingestion from Railway IPs
type: project
---

**Why:** Spent 2026-04-06/07 thoroughly testing every YouTube ingestion method from Railway. Settling the question once and for all so we don't waste another session chasing yt-dlp workarounds.

## Confirmed unfixable on Railway (tested live via SSH on the actual server)

1. **yt-dlp** → HTTP 429 bot detection + SABR streaming errors. Adding `nodejs` to nixpacks fixes the "no JS runtime" warning but YouTube still blocks with `Sign in to confirm you're not a bot`.
2. **youtube-transcript-api** → `IpBlocked` exception. YouTube blocks this library the same way as yt-dlp. Tested directly on Railway server — fails cleanly.
3. The blocking is IP-based on YouTube's side — affects ANY data-center IP, not just Railway. Cloud providers are all blacklisted.

## What DOES work on Railway

**YouTube Data API v3 via Google OAuth** — this is the ONLY free/simple path. Goes through Google's official API endpoint which isn't IP-blocked. Requires user to connect their Google account once.

## What works on the laptop (residential IP)

- **youtube-transcript-api** → Works perfectly. 792 segments fetched from the test video in under 2 seconds.
- **yt-dlp** → Hit 403 Forbidden + SABR issues even from residential IP on Python 3.9 venv. Needs further investigation — may be a Python version / yt-dlp version issue, not pure IP blocking.

## Architecture decision: split local vs Railway

**transcript-chat-assistant (TOA's sibling):**
- **Local** (laptop) — all 3 tabs visible. Uses `youtube-transcript-api` fast-path before falling back to yt-dlp+Whisper. Runs at `http://localhost:5055` via `python app.py`.
- **Railway** — URL tab hidden. File Upload + YouTube Account tabs only.

**text-overlay-assistant (TOA):**
- **Railway** — URL tab hidden. File Upload + YouTube Account only.
- Loric can run local copy the same way if file sizes exceed Railway limits.

## Paid workarounds NOT pursued

- **Residential proxy** (~$6/mo Webshare) — would let yt-dlp work on Railway, but costs money and adds latency
- **Cookie auth** — fragile, needs refresh every 2-4 weeks

## Google OAuth setup notes

Google Cloud Console OAuth client needs the Railway callback URL whitelisted. For transcript-chat-assistant:
- Project: `transcript-chat-assistant`
- Authorized redirect URIs include: `http://127.0.0.1:5000/auth/callback`, `https://transcript-chat.up.railway.app/auth/callback`, `https://yt-transcript.up.railway.app/auth/callback`
- Railway env var `GOOGLE_OAUTH_REDIRECT_URI` must match the actual domain being used

**Known issue:** OAuth PKCE session loss on Railway with 2 gunicorn workers — the `code_verifier` stored in Flask session on `/auth/youtube` can be missed when `/auth/callback` hits a different worker. Fix: drop to 1 worker OR use persistent session store. Not fixed yet (user moved to local instead).
