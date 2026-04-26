---
name: TOA Railway deployment & feature status
description: Current deployment state, Railway URL, env vars, and feature completeness of Text Overlay Assistant
type: project
---

Text Overlay Assistant (TOA) is deployed on Railway at https://toa.up.railway.app. Current build folder: `/Users/loric/MOKSHA/MOKSHA BUILDS/fidelio/text-overlay-assistant/`.

## Current Railway service (as of 2026-04-07)

- Project: `fidelio` (ID: `afc0e272-8012-4279-bd43-b06b052d5d26`)
- Service: `text-overlay-assistant` (ID: `a6a65ad0-ee3a-4305-8aa7-d5d5694f906c` — fresh service, old one was deleted during Railway incident recovery)
- Domain: `https://toa.up.railway.app`
- No volume (removed 2026-04-06 — not needed for Railway version since file uploads are limited anyway)

## Ingestion tabs visible on Railway

- **File Upload** — works but limited by Railway request timeout / body size for big files
- **YouTube URL** — HIDDEN (`style="display:none;"`) — blocked by YouTube bot detection on Railway IPs (see `project_yt_ip_blocking.md`)
- **YouTube Account** — works via Google OAuth, uses YouTube Data API v3. Dropdown→input fallback bug fixed 2026-04-06.

## Railway env vars (current)

- ANTHROPIC_API_KEY
- OPENAI_API_KEY
- FLASK_SECRET_KEY
- GOOGLE_CLIENT_SECRETS (base64-encoded)
- GOOGLE_OAUTH_REDIRECT_URI = `https://toa.up.railway.app/auth/callback`
- NIXPACKS_PYTHON_VERSION = 3.13
- DATA_DIR was removed (no volume)
- GUNICORN_CMD_ARGS was removed (managed via railway.toml startCommand now)

## Build config

- `nixpacks.toml` — `nodejs_20`, `ffmpeg`, `python313`
- `railway.toml` — gunicorn startCommand with 300s timeout, restart policy ON_FAILURE max 5
- yt-dlp invoked with `--js-runtimes node` flag (fixed "no JS runtime" warning in yt-dlp 2025+)

## Google OAuth

- Google Cloud Console project: `text-overlay-assistant`
- Authorized redirect URIs include `https://toa.up.railway.app/auth/callback` (confirmed working)
- OAuth flow tested live — redirects correctly to Google consent screen

## Setup card in UI

- Server-side steps removed (editors don't need to set API keys, install ffmpeg, etc.)
- Only DaVinci Resolve steps shown: download `place_overlays.py`, create Fusion Title templates
- Changed 2026-04-04 based on Loric's feedback

## Known not working / unfixable on Railway

- YouTube URL (yt-dlp) — bot detection, tested extensively 2026-04-06
- See `project_yt_ip_blocking.md` for full details

## DaVinci Resolve integration

- Template names: `TOA_Chapter`, `TOA_List`, `TOA_Keyword` (case-sensitive)
- `place_overlays.py` script placed in Resolve's Fusion/Scripts/Utility folder
- README has stale `OA_*` names — needs fix

## Open items

- README template name fix (`OA_*` → `TOA_*`)
- README model version fix (`claude-opus-4-5` → `claude-sonnet-4-6`)
- Remove dead `youtube_transcript_api` code path or add to requirements.txt
- Delete legacy services from `moksha-tools` Railway project (deployments already down)
- Consider applying the transcript-chat UI improvements to TOA too (markdown rendering, wider layout, max_tokens bump, sans-serif transcript)

**Next session:** End-to-end test `toa.up.railway.app` YouTube Account flow with a real video. Decide whether to port UI improvements from transcript-chat.
