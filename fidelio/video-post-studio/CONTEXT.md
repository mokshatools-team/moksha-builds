# CONTEXT — Video Post Studio
**Company:** FIDELIO Productions
**Last updated:** 2026-04-03

---

## What This Tool Does

Video Post Studio is the planned umbrella shell for all FIDELIO video post-production tools. The vision is a single web app with a persistent workspace per project, containing three modules that share a common transcript layer:

- **Import** — bring in a source (upload, YouTube URL, or connected account)
- **TOA** — generate text overlays (the logic currently living in `text-overlay-assistant`)
- **Transcript Chat** — Q&A on the transcript (the logic currently in `transcript-chat-assistant`)

Right now this is an **early-stage architectural shell**. The modules exist as navigation stubs with mock data. No real transcription, no real AI calls, no real overlay generation. It is not yet a usable production tool.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.9+, Flask (application factory pattern) |
| Frontend | Server-rendered HTML with Jinja2 templates |
| Data layer | In-memory Python dataclasses (no database) |
| Dependencies | Flask only (`requirements.txt` has one line) |
| Deployment | Not deployed — no Railway service, no Procfile, no railway.toml |

---

## Live Railway URL

**Not deployed.** No Railway service exists for this build.

This build is in an early development state and has not been deployed to Railway. A Railway service will need to be created when the app is ready for deployment.

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

**What's built (shell only):**
- Flask app factory pattern (`app/app.py` → `create_app()`)
- Blueprint-based routing (`app/routes/shell.py`)
- Shared data contracts via frozen dataclasses: `Workspace`, `SourceAsset`, `TranscriptSession` (`app/models/contracts.py`)
- Import form with basic validation (title + source_value required)
- Mock transcript generation on import (not real — outputs placeholder text)
- TOA module page with a workspace summary adapter (`app/services/toa_adapter.py`) that shows transcript status but does nothing else
- Transcript Chat module page stub (no real chat)
- Transcript download endpoint (`/transcripts/active.txt`) — works with mock transcript
- HTML templates: `base.html` (shell nav) and `module.html` (module content area)
- Test suite covering models, routes, and workspace service

**What's NOT built:**
- Real transcription (Whisper/ffmpeg/yt-dlp)
- Real Claude chat
- Real overlay generation
- Any connection to the standalone `text-overlay-assistant` or `transcript-chat-assistant` services
- Persistent state (no database, no session storage)
- Deployment config (no Procfile, no railway.toml)

---

## Known Issues and Limitations

1. **No real functionality yet.** Every module uses mock data. This is by design at this stage — the architecture is being validated before real services are wired in.

2. **In-memory global state.** `_workspace_state` in `shell.py` is a module-level variable. It resets on every server restart. Not suitable for production.

3. **No persistence layer.** The architecture docs call for `Job` and `Artifact` models, but neither exists in the code yet.

4. **Single worker only.** Due to the global state model, running multiple gunicorn workers would cause session loss across requests. Must be single-worker until this is replaced.

5. **Missing deployment files.** No `Procfile`, no `railway.toml`, no `nixpacks.toml`, no `apt.txt`. The app cannot be deployed to Railway as-is.

---

## Architecture Plan

The architecture is documented in `docs/architecture.md`. The intended build order:

1. Shell navigation ✅ (done)
2. Core contracts ✅ (done)
3. Import flows ✅ (mock done, real pending)
4. Transcript session handling (mock done, real pending)
5. TOA module wired to real overlay logic (not started)
6. Transcript Chat module wired to real Claude chat (not started)

The standalone `text-overlay-assistant` remains live at https://toa.up.railway.app while this shell is being built. TOA logic will be ported into Video Post Studio behind a module boundary once the shell is stable.

Specs and plans for completed and upcoming work live in `docs/superpowers/`.

---

## Next Planned Work

Based on `docs/superpowers/plans/2026-04-01-transcript-actions-and-toa.md` — the next phase connects the Import module to real Whisper transcription and wires the TOA module to real overlay generation via Claude.

Before that work begins:
1. A spec must exist in `docs/` for the next task
2. Deployment config (Procfile, railway.toml) must be added
3. A Railway service must be created for this build

---

## Key Files

| File | What it does |
|---|---|
| `run.py` | Entry point — calls `create_app()` and runs Flask dev server |
| `app/app.py` | Application factory — creates Flask app and registers blueprints |
| `app/routes/shell.py` | All routes: home, import, module pages, transcript download. Holds global workspace state. |
| `app/models/contracts.py` | Frozen dataclass contracts: `Workspace`, `SourceAsset`, `TranscriptSession` |
| `app/services/workspaces.py` | Workspace builder helpers: demo workspace, import with mock transcript |
| `app/services/transcripts.py` | Mock transcript generator (returns placeholder text, not real Whisper output) |
| `app/services/toa_adapter.py` | TOA workspace summary adapter — reads transcript state, returns summary for TOA module UI |
| `app/templates/base.html` | Shell layout: workspace nav, module switcher |
| `app/templates/module.html` | Module content template |
| `docs/architecture.md` | Architecture overview and module boundary rules |
| `docs/modules.md` | Module descriptions |
| `docs/superpowers/` | Specs and implementation plans |
| `tests/` | Test suite: models, routes, workspace service |

---

## Required Environment Variables

None currently — the app has no real API calls. When real modules are wired in, the following will be needed:

| Variable | Required for |
|---|---|
| `ANTHROPIC_API_KEY` | TOA overlay generation + Transcript Chat |
| `OPENAI_API_KEY` | Whisper transcription |
| `FLASK_SECRET_KEY` | Session signing (production) |
