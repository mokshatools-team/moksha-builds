# CONTEXT — Transcript Chat Assistant
**Company:** FIDELIO Productions
**Last updated:** 2026-04-03

---

## What This Tool Does

Transcript Chat Assistant is a standalone web app for studying a video transcript without generating overlays. You give it a video file or YouTube URL — it transcribes the audio using OpenAI Whisper, displays the full transcript in the browser, and lets you chat with Claude about the content.

The transcript is the grounding context for the conversation: Claude only answers from what's in the transcript. The editor can read, copy, or download the transcript as `.txt` or `.md`, and hold a multi-turn conversation about it (summarize sections, pull quotes, ask questions about the content).

This is a lighter tool than Text Overlay Assistant — it has no overlay analysis and no DaVinci Resolve integration. It's designed for quick transcript review and Q&A.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.9+, Flask |
| Transcription | OpenAI Whisper API (`whisper-1`), via `openai` SDK |
| Audio extraction | ffmpeg (installed via nixpacks: `apt.txt`) |
| YouTube download | yt-dlp |
| YouTube captions | Google OAuth 2.0 + YouTube Data API v3 (optional) |
| Chat | Anthropic Claude API (model configurable via `ANTHROPIC_MODEL`, default `claude-sonnet-4-5`) |
| Frontend | Single-page HTML/CSS/JS in `templates/index.html` |
| Server | gunicorn (via Procfile) |
| Deployment | Railway, nixpacks builder |

---

## Live Railway URL

**https://transcript-chat.up.railway.app**

Service name in Railway: `transcript-chat-assistant` (project: `moksha-tools`)

---

## Current Status

**What works:**
- Transcription of uploaded video files (mp4, mov, mxf, avi) via ffmpeg + Whisper
- Transcription of YouTube URLs via yt-dlp + Whisper
- YouTube OAuth flow to connect a Google account (fetches captions from YouTube Data API)
- Full transcript display in browser
- Transcript download as `.txt` or `.md`
- Multi-turn chat with Claude grounded on the active transcript
- Route validation tests and transcript fetcher tests

**What's incomplete or unknown:**
- Live URL end-to-end testing not recorded — Railway service exists but no confirmed working test has been documented
- YouTube OAuth was not fully verified against the deployed Railway URL
- App state is held in a global Python dict (`_active_state`) — will reset on server restart or worker rotation. On Railway with multiple gunicorn workers, different requests could hit different workers and lose state mid-session. This is a known architectural limitation.

---

## Known Issues and Limitations

1. **Global in-memory state:** `_active_state` in `app.py` is a module-level dictionary. On Railway with gunicorn workers, state is not shared between workers. If a user's requests are routed to different workers, the transcript session may disappear mid-conversation. A proper session store (cookie, Redis, or session file) would fix this.

2. **No transcript persistence:** There is no database or file storage. Once the server restarts or the worker resets, the transcript is gone. The user must re-upload or re-fetch.

3. **YouTube IP blocking risk:** Same risk as text-overlay-assistant — Railway's IP range may be blocked by YouTube for yt-dlp downloads. If this happens, the YouTube URL transcription flow breaks on the deployed app.

4. **OAuth uses `include_granted_scopes`:** The YouTube OAuth flow passes `include_granted_scopes="true"`, which is a flag that text-overlay-assistant removed (it was linked to a test failure there). Worth aligning behavior between the two builds.

5. **Model is configurable but default is stale:** `ANTHROPIC_MODEL` defaults to `claude-sonnet-4-5` which is a prior-generation model. Should be updated to `claude-sonnet-4-6` or set explicitly in Railway env vars.

---

## Next Planned Feature or Fix

Not formally scoped. Based on the architecture docs in `video-post-studio/`, this tool is intended to eventually be absorbed into Video Post Studio as the "Transcript Chat" module. Until that happens it runs as its own standalone service.

Suggested priorities for next session:
1. End-to-end test the live Railway URL: https://transcript-chat.up.railway.app
2. Fix the global state problem (use cookie-based or file-based session)
3. Update default Claude model to `claude-sonnet-4-6`

---

## Key Files

| File | What it does |
|---|---|
| `app.py` | Main Flask app. Routes: transcription, YouTube OAuth, chat, transcript download. Holds active state in a global dict. |
| `transcript_fetcher.py` | Audio extraction and Whisper transcription. Supports local video files (ffmpeg) and YouTube URLs (yt-dlp). Also fetches YouTube titles via yt-dlp `--print title`. |
| `templates/index.html` | Single-page frontend. Transcript display, copy, download, and chat UI. |
| `requirements.txt` | Python dependencies: flask, anthropic, openai, yt-dlp, google-auth-oauthlib, youtube-transcript-api. |
| `Procfile` | gunicorn startup command. |
| `nixpacks.toml` | Installs `nodejs_20` and `ffmpeg` on Railway at build time. |
| `apt.txt` | System packages (ffmpeg fallback for nixpacks). |
| `tests/test_app_routes.py` | Route tests. |
| `tests/test_transcript_fetcher.py` | Transcript fetcher unit tests. |

---

## Required Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for transcript chat |
| `OPENAI_API_KEY` | Yes | Whisper transcription API key |
| `FLASK_SECRET_KEY` | Yes (prod) | Flask session signing secret. Has insecure dev default — must be set on Railway. |
| `GOOGLE_CLIENT_SECRETS` | No | Base64-encoded Google OAuth client secrets JSON (for YouTube account connect) |
| `GOOGLE_CLIENT_SECRETS_FILE` | No | Path to client secrets JSON (alternative to above) |
| `ANTHROPIC_MODEL` | No | Claude model to use for chat. Defaults to `claude-sonnet-4-5`. Recommend setting to `claude-sonnet-4-6`. |
