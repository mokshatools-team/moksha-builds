---
name: Transcript Chat — local setup on Loric's laptop
description: How to run transcript-chat-assistant locally, what was fixed, pending improvements
type: project
---

**Why:** Railway version was half-broken (file uploads timeout for big files, YouTube URL blocked by IP detection). Loric moved to local-only workflow. This captures current state and pending improvements.

## How to run it locally

```
cd "/Users/loric/MOKSHA/MOKSHA BUILDS/fidelio/transcript-chat-assistant"
source venv/bin/activate
python app.py
```

Then open `http://localhost:5055`.

**Port note:** Port 5000 is used by macOS AirPlay Receiver. `app.py` now reads `PORT` env var with default 5055 to avoid the conflict. Don't revert this to 5000.

**Prereqs installed:** ffmpeg (Homebrew), nodejs, Python 3.9 venv, all requirements.txt deps. `.env` file has OPENAI_API_KEY, ANTHROPIC_API_KEY, FLASK_SECRET_KEY.

## UI/backend overhaul done 2026-04-07

Plan file: `/Users/loric/.claude/plans/stateless-finding-cake.md`

**Fixed:**
- `.hidden { display: none !important; }` CSS rule added — was missing, caused loading bar to animate forever even after "Reply ready"
- Transcript backend join changed from `\n\n` to `" "` — no more blank lines between every segment, reads as flowing prose
- Transcript box now uses sans-serif (Plus Jakarta Sans) at 14.5px/1.65 for long-form readability — was cramped JetBrains Mono at 13px/1.85
- Page max-width 760px → 1240px, transcript and chat now sit side-by-side in a 2-column grid on desktop (stacks on mobile <960px)
- Chat assistant messages render markdown via marked.js (headings, lists, bold, code, blockquotes, hr). User messages stay plain text. CSS styling for all markdown elements added.
- `max_tokens` 700 → 8000 in `_chat_with_transcript` — was causing analysis to cut off mid-outline
- Model default `claude-sonnet-4-5` → `claude-sonnet-4-6`
- System prompt rewritten to instruct markdown formatting + completeness + reasonable interpretation (not robotic word-matching)
- Transcript minimize/expand toggle added to workspace top-right button row (next to Copy/.txt/.md). Cycles "Hide transcript" → "Focus transcript" → "Show both". Always visible so the state is reversible.

**Key files modified:**
- `fidelio/transcript-chat-assistant/templates/index.html` — CSS overhaul, marked.js integration, toggle button logic, workspace-body grid wrapper
- `fidelio/transcript-chat-assistant/app.py` — `_build_transcript_text` join, `_chat_with_transcript` model/tokens/prompt, PORT env var
- `fidelio/transcript-chat-assistant/transcript_fetcher.py` — captions API fast-path via youtube-transcript-api (works locally, fails on Railway)
- `fidelio/transcript-chat-assistant/.env` — created with OPENAI + ANTHROPIC keys

**Changes are uncommitted.** Loric hasn't decided yet whether to push them back to Railway (some changes like transcript spacing + markdown rendering + layout are universal wins, but the `youtube-transcript-api` fast-path doesn't help on Railway).

## Known pending

- User suggested a dedicated "output panel" separate from the chat thread — deferred until after testing the 2-column + markdown fix
- Streaming Claude responses (SSE) — nice to have, not in scope
- Python 3.9 is deprecated — shows SSL warnings but works. Could upgrade to Python 3.11+ if issues arise.
- yt-dlp still hits 403 Forbidden even locally on Python 3.9 — `youtube-transcript-api` fast-path saves the day, but if a video has no captions, yt-dlp fallback may fail

**Next session (if continuing):** Test the UI overhaul end-to-end with a fresh YouTube video. Confirm markdown renders cleanly, layout feels good, output runs to completion. Then decide whether to push these improvements to the Railway version too.
