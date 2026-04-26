# FDL1 — FIDELIO Content Publishing Pipeline — CONTEXT

## What this is

Automated content publishing pipeline for FIDELIO Productions. An editor drops a video file into a watched folder, and the system handles everything: YouTube upload, transcription, AI caption generation, Google Sheets asset tracking, and Publer draft creation across all platforms.

## Current status

**Phase 1 code complete — deploy blocked.** All scripts built and tested in mock mode (6/6 tests pass). Railway deploy fails — root directory setting causes "no associated build" error on every deploy attempt.

## Architecture change from spec

n8n was dropped. The pipeline runs as a standalone Flask service on Railway with two endpoints:
- `POST /webhook/pipeline` — watcher sends file detections here, runs full pipeline
- `POST /webhook/publer` — Publer sends publish status updates here

## Live URL

Assigned but not yet live: `content-pipeline-fdl1-production.up.railway.app`
Railway project: **fidelio** (not moksha-tools). Service: "content pipeline [FDL1]"

## Client

- **Client ID:** dre-alexandra (Dre Alexandra Champagne)
- **Language:** French
- **Short-form platforms:** YouTube Shorts, Instagram, Facebook, TikTok
- **Long-form platforms:** YouTube

## What was built (2026-04-04)

- Full project structure per spec
- Config loader with validation
- File watcher with filename parsing and validation
- YouTube upload module (mock mode)
- Whisper transcription module (mock mode)
- Google Sheets read/write module (mock mode)
- Pipeline orchestrator as Flask service (replaced n8n)
- Publer webhook receiver
- End-to-end test suite (6 tests, all passing)
- CLAUDE.md updated with deploy verification rules

## Deploy blocker

After changing Railway Root Directory from `webhook-receiver/` to `fidelio/fdl1-publishing-pipeline`, all deploys fail with "no associated build." Neither GitHub auto-deploy nor `railway up` CLI work. The `railway.toml` was removed to rule it out — still fails.

## Next steps (next session)

1. **Fix deploy:** Clear Root Directory in Railway Settings (set blank), then `railway up` from project root
2. If that fails: set root dir back to `webhook-receiver/`, fix imports in webhook-receiver/app.py
3. Once deployed: verify health endpoint, test webhook endpoints
4. Write caption prompts (short-form-caption-prompt.md)
5. Set up real API credentials at go-live
