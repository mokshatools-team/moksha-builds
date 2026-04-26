---
name: Video Post Studio — status & architecture
description: VPS shell app with Import + TOA + Transcript Chat modules, transcript actions spec, current state and next steps
type: project
---

Video Post Studio (VPS) is a separate app from the standalone TOA. It is a modular shell where Import, TOA, and Transcript Chat are tabs sharing a workspace layer.

Local path: `/Users/loric/MOKSHA/FIDELIO Automations/video-post-studio/`
Not deployed — runs locally only (`python run.py` → localhost:5000).

**Why:** Unified shell for all video post-production tools. Transcript is ingested once in Import, then consumed by any tool (TOA, Chat, etc.) without re-processing.

**How to apply:** This is distinct from `text-overlay-assistant`. Any work on the shared transcript layer, multi-tool workflow, or workspace model happens here.

## Current state (as of this session)
The "Transcript Actions and TOA Integration" spec is FULLY IMPLEMENTED — 25/25 tests pass.

What exists:
- `app/models/contracts.py` — `SourceAsset`, `TranscriptSession` (frozen dataclasses), `Workspace`
- `app/services/workspaces.py` — `build_demo_workspace`, `add_source_asset`, `import_source_with_mock_transcript`
- `app/services/transcripts.py` — `build_mock_transcript` (mock only, not real Whisper yet)
- `app/services/toa_adapter.py` — `build_toa_workspace_summary` (transcript state exposure)
- `app/routes/shell.py` — GET /, GET+POST /import, GET /transcripts/active.txt, GET /<module_key>
- `app/templates/base.html` + `module.html` — functional but **unstyled bare HTML**
- `tests/` — 25 passing tests (models, services, routes)
- `requirements.txt` — Flask only (+ pytest in venv)

## What's missing
1. **Styled UI** — templates are bare HTML, no CSS, no Moksha design system applied
2. **Deployment** — not on Railway, local only
3. **Real transcription** — uses mock transcripts; real Whisper/yt-dlp integration not wired yet

## Next session: style + deploy
1. Apply Moksha light theme to `base.html` and `module.html` (same CSS vars as TOA: `--bg: #F7F3EE`, `--accent: #C8622A`, Cormorant Garamond + Outfit)
2. Style Import module: card form, transcript-ready state with Copy / Download / Open TOA actions
3. Style TOA module: transcript status card
4. Add `Procfile` + `gunicorn` to requirements, deploy to Railway
