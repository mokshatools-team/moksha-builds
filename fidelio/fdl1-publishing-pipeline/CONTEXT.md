# FDL1 — FIDELIO Content Publishing Pipeline — CONTEXT

## What this is

Automated content publishing pipeline for FIDELIO Productions. An editor drops a video file into a watched folder, and the system handles everything: YouTube upload, transcription, AI caption generation, Google Sheets asset tracking, and Publer draft creation across all platforms.

## Current status

**Phase 1 built — mock mode.** All scripts created and tested with mock API responses. No real API calls yet. Ready for real credentials to go live.

- Short-form pipeline: fully built and tested (mock mode)
- Long-form pipeline: stub built — uploads to YouTube, transcribes, writes row with `pending_copy`, then stops
- Webhook receiver: built, ready for Railway deploy
- n8n workflow: JSON exported, needs import into n8n instance

## Live URL

Not yet deployed. Webhook receiver will be deployed to Railway.

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
- Pipeline orchestrator (mock mode — simulates n8n locally)
- Webhook trigger to n8n
- Publer webhook receiver (Flask)
- n8n workflow JSON
- End-to-end test suite (6 tests, all passing)

## Next steps

1. Write caption prompts (short-form-caption-prompt.md)
2. Set up real API credentials (YouTube OAuth, Publer, Sheets service account)
3. Import n8n workflow and wire up real HTTP nodes
4. Deploy webhook receiver to Railway
5. Test with real video file end-to-end
6. Build FDL2 (retroactive import) and FDL3 (copy review) when ready
