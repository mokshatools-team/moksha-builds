---
name: TOA technical architecture
description: File paths, key functions, and architectural patterns for Text Overlay Assistant
type: project
---

**Why:** Reference for making code changes without re-exploring from scratch.
**How to apply:** Use when modifying app.py, transcript_fetcher.py, or index.html.

## Key files
- `/Users/loric/MOKSHA/FIDELIO Automations/text-overlay-assistant/app.py`
- `/Users/loric/MOKSHA/FIDELIO Automations/text-overlay-assistant/transcript_fetcher.py`
- `/Users/loric/MOKSHA/FIDELIO Automations/text-overlay-assistant/templates/index.html`
- `/Users/loric/MOKSHA/FIDELIO Automations/text-overlay-assistant/place_overlays.py`
- `/Users/loric/MOKSHA/FIDELIO Automations/text-overlay-assistant/requirements.txt`
- `/Users/loric/MOKSHA/FIDELIO Automations/text-overlay-assistant/railway.toml`
- `/Users/loric/MOKSHA/FIDELIO Automations/text-overlay-assistant/apt.txt`

## Backend architecture
- `transcript_fetcher.py`: standalone module. `fetch_transcript_entries(source, offset_seconds)` dispatches on YouTube URL vs local file path. `download_youtube_audio()` uses yt-dlp via `sys.executable -m yt_dlp`. `transcribe_media_segments()` calls Whisper API (verbose_json, segment timestamps).
- `app.py` imports `fetch_transcript_entries`. `/transcribe` route accepts `{filename, youtube_url, offset_str}` — either file or URL, not both.
- Google OAuth: `GOOGLE_CLIENT_SECRETS` env var (base64 JSON) decoded at startup to temp file. Routes: `/auth/youtube`, `/auth/callback`, `/auth/status`, `/auth/disconnect`. `/transcript/youtube-oauth` fetches captions via YouTube Data API.
- MAX_CONTENT_LENGTH = 4GB. ProxyFix for Railway HTTPS.

## Frontend architecture (index.html)
- Light Moksha theme: `--bg: #F7F3EE`, `--accent: #C8622A`, Cormorant Garamond + Outfit + JetBrains Mono
- Three ingestion tabs: FILE / YOUTUBE URL / YOUTUBE ACCOUNT (tab switching, only one active)
- Screens: screen-pick, screen-loading (two-phase badge), screen-review
- Loading phases: `setLoadingPhase(1/2, messages)` — "1/2 — Transcription" then "2/2 — Analysis"
- Stable `_id` system for overlay DOM management: `ov-{timestamp}-{counter}`
- `buildOutline()`: sorts by timestamp, groups into chapter sections, inserts insert-zones
- Soft delete: `_disabled` flag, `row-struck` CSS class
- Inline edit: `contenteditable`, saves on blur
- Insert form: type buttons (KW/CH/LS), time + text inputs, `saveInsert()` pushes to overlays and re-renders
- `downloadJSON()`: strips `_id`, `_disabled`, `_added` from export
