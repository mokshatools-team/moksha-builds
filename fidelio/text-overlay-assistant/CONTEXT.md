# CONTEXT — Text Overlay Assistant
**Company:** FIDELIO Productions
**Last updated:** 2026-04-03

---

## What This Tool Does

Text Overlay Assistant is a web app for video editors. You give it a video file or a YouTube URL, it transcribes the audio using OpenAI Whisper, then sends the transcript to Claude. Claude reads the transcript and identifies the most important moments — section transitions, quick lists of items, and key phrases worth highlighting. It returns a structured list of text overlays sorted by timecode.

The editor reviews the overlay list in the browser, approves it, and downloads a JSON file. That JSON is then loaded into DaVinci Resolve by a companion utility script (`place_overlays.py`), which automatically places the overlay titles onto V2/V3/V4 of the timeline at the correct timecodes.

The full workflow: upload or paste URL → transcribe → Claude analysis → review → download JSON → run in Resolve → overlays appear on timeline.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.9+, Flask |
| Transcription | OpenAI Whisper API (`whisper-1`), via `openai` SDK |
| Audio extraction | ffmpeg (for local video files) |
| YouTube download | yt-dlp |
| YouTube captions | Google OAuth 2.0 + YouTube Data API v3 (alternative to Whisper for YouTube sources) |
| AI analysis | Anthropic Claude API (`claude-sonnet-4-6`) |
| Frontend | Single-page HTML/CSS/JS in `templates/index.html` |
| Server | gunicorn (2 workers, 120s timeout) |
| Deployment | Railway, nixpacks builder |
| Auth | Google OAuth via `google-auth-oauthlib` |

---

## Live Railway URL

**https://toa.up.railway.app**

Service name in Railway: `fidelio - text overlay assistant` (project: `moksha-tools`)

---

## Known Blockers — Do Not Touch Without Reading This

### YouTube 429 — Railway IP Blocked
YouTube is actively blocking Railway's server IPs from downloading audio via yt-dlp.
This affects TOA, transcript-chat-assistant, and video-post-studio — all three share the same root problem.

Do NOT attempt to fix this within this build alone. It must be solved at the shared infrastructure level across all three builds in one dedicated session.

Current workaround: Use the FILE UPLOAD tab instead of YouTube URL. File uploads work correctly.

Fix options (for future session):
- Option A (recommended): Switch to YouTube caption API — no yt-dlp, no ffmpeg, no IP blocking. Works for any video with captions.
- Option B: Proxy layer routing downloads through a non-Railway service
- Option C: Cookie-based auth for yt-dlp — fragile, not recommended

Secondary issues also blocked until 429 is resolved:
- nixpacks.toml missing (ffmpeg + Node.js not installed) — one-file fix but pointless until 429 is solved
- youtube_transcript_api referenced in code but not in requirements.txt — dead code

Status: ON HOLD. Do not work on YouTube ingestion until dedicated cross-build session is scheduled.

---

## Current Status

**What works:**
- Full transcription pipeline for local video files (mp4, mov, mxf, avi) via ffmpeg + Whisper
- Full transcription pipeline for YouTube URLs via yt-dlp + Whisper
- YouTube OAuth flow: connect a Google account, fetch captions directly from YouTube Data API (faster, no Whisper cost), with fallback to Whisper if captions unavailable
- Claude analysis with four density modes (Minimal / Balanced / Detailed / Maximum)
- Three overlay types: CHAPTER (section titles), LIST (enumerated items), KEYWORD (italic emphasis)
- Two deployment modes: local watch folder mode (WATCH_FOLDER_PATH set) and upload mode (Railway)
- JSON download for use with DaVinci Resolve
- `place_overlays.py` DaVinci Resolve script for placing overlays onto V2/V3/V4
- Route validation tests covering transcription, OAuth flow, and video listing

**What's incomplete or unknown:**
- Live Railway URL confirmed: https://toa.up.railway.app (not end-to-end tested yet)
- No end-to-end test against the live Railway deployment has been recorded
- YouTube transcript API (`youtube_transcript_api`) is listed as a fallback path in code but is **not** in `requirements.txt` — it would fail silently on Railway if that path is ever triggered

---

## Known Issues and Limitations

1. **Template name discrepancy:** `README.md` documents the DaVinci Resolve template names as `OA_Chapter`, `OA_List`, `OA_Keyword`. The actual script `place_overlays.py` uses `TOA_Chapter`, `TOA_List`, `TOA_Keyword`. The README is wrong — the script is the source of truth.

2. **README model mismatch:** `README.md` says the default Claude model is `claude-opus-4-5`. The actual code in `app.py` uses `claude-sonnet-4-6`. README is stale.

3. **YouTube IP blocking:** The README explicitly warns that Railway's IP range may be blocked by YouTube for `yt-dlp` downloads. If that happens, the YouTube URL flow breaks on the deployed app. Local usage is unaffected.

4. **`youtube_transcript_api` not in requirements:** There is a code path in `app.py` (`_fetch_transcript_entries_via_youtube_transcript_api`) that tries to import `youtube_transcript_api`. This package is not listed in `requirements.txt` and will not be installed on Railway, so that fallback will always raise a RuntimeError. The code handles it gracefully and continues to the next fallback, but it's dead weight on Railway.

5. **Large file uploads:** The app accepts up to 4 GB uploads, but Railway's free tier may have request timeout limits shorter than the time needed to upload and transcribe a large file.

6. **Session-based Google credentials:** YouTube OAuth credentials are stored in the Flask session (in-memory). On Railway with 2 gunicorn workers, a user could lose their session if requests hit different workers. A persistent session store (e.g. Redis) would fix this, but is not implemented.

---

## Next Planned Feature or Fix

Not formally documented. Based on the `docs/superpowers/plans/2026-03-31-transcript-module.md` plan, the transcript fetching module was a recent addition. No follow-up work has been scoped yet.

Suggested priorities for next session:
1. End-to-end test the live URL https://toa.up.railway.app (upload a file or YouTube URL → analyze → download JSON)
2. Fix the README template name discrepancy (`OA_` vs `TOA_`)
3. Remove the dead `youtube_transcript_api` import path or add it to requirements.txt

---

## Key Files

| File | What it does |
|---|---|
| `app.py` | Main Flask app. All routes: OAuth, file upload, transcription, Claude analysis, JSON download. ~856 lines. |
| `transcript_fetcher.py` | Handles audio extraction and Whisper transcription. Supports local video files (via ffmpeg) and YouTube URLs (via yt-dlp). Called by `app.py`. |
| `place_overlays.py` | DaVinci Resolve utility script. Reads the downloaded JSON and inserts Fusion Title templates onto V2/V3/V4 at the correct timecodes. Copy to Resolve's Scripts/Utility folder. |
| `templates/index.html` | Single-page frontend. All UI logic lives here. |
| `requirements.txt` | Python dependencies. Key: flask, anthropic, openai, yt-dlp, google-auth-oauthlib. |
| `Procfile` | `gunicorn app:app --timeout 120 --workers 2` |
| `railway.toml` | Minimal — just sets builder to nixpacks. |
| `.env.example` | Documents required env vars (see below). |
| `tests/test_app_routes.py` | Unit tests for routes: transcription input validation, OAuth flow, video listing logic. |
| `tests/test_transcript_fetcher.py` | Unit tests for the transcript fetcher module. |

---

## Required Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `OPENAI_API_KEY` | Yes | Whisper transcription API key |
| `WATCH_FOLDER_PATH` | No | Absolute path to local video folder. If set, enables local watch-folder mode. Leave unset on Railway (upload mode). |
| `GOOGLE_CLIENT_SECRETS` | No | Base64-encoded Google OAuth client secrets JSON (for YouTube account connect) |
| `GOOGLE_CLIENT_SECRETS_FILE` | No | Path to Google OAuth client secrets JSON file (alternative to above) |
| `GOOGLE_OAUTH_REDIRECT_URI` | No | Explicit OAuth callback URL (e.g. `https://your-domain/auth/callback`). Required if Google Console redirect_uris doesn't match Railway's auto-assigned domain. |
| `FLASK_SECRET_KEY` | No | Flask session secret. Has a hardcoded dev default — set this in production. |
