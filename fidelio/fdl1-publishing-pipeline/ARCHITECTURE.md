# FDL1 — FIDELIO Content Publishing Pipeline — Architecture

## Core Design Principles

- One upload. Editor drops one file. Everything downstream is automatic.
- YouTube as the universal holding layer. All video uploads to YouTube as Unlisted first. Publer pulls from the YouTube URL to distribute to other platforms.
- Drafts created immediately. Within 15-20 minutes of file drop, drafts exist in Publer.
- Sheet is the system record. Google Sheets holds the permanent asset record. Humans never manage it directly.
- No auto-publish. Nothing goes live without a human assigning a date in Publer.
- Modular by config. Every client-specific variable lives in the client JSON. Nothing hardcoded.

## Stack

- **Trigger:** Python watcher script (watchdog library) — monitors local folder
- **Transport:** YouTube Data API v3 — uploads as Unlisted, polls processing status
- **Transcription:** OpenAI Whisper API
- **Orchestration:** n8n — receives webhook from watcher script, manages all API calls
- **AI:** Claude API (claude-sonnet-4-20250514) — generates captions
- **Asset Library:** Google Sheets API — service account auth
- **Scheduler:** Publer API — URL import, draft creation, webhook receiver
- **Hosting:** Watcher script runs locally on editor machine. n8n runs on existing n8n instance. Publer webhook receiver deployed to Railway.

## Folder Structure

```
/[client-id]/
  /short-form/     -> triggers short-form branch
  /long-form/      -> triggers long-form branch (stub only in Phase 1)
  /rejected/       -> malformed files moved here automatically
```

## Naming Convention

Format: `[ASSET_ID] [topic in plain language].mp4`

- One space between ID and topic
- Asset ID: `[PREFIX][SESSION].[EPISODE]` e.g. `PS14.1` or `POD14`
- Topic: plain language, accents OK, no special characters
- Extension: `.mp4`

Parsing:
- Split on first space -> left = asset_id, right (strip .mp4) = topic_slug
- Extract prefix from asset_id -> look up in config content_types
- Extract session number from asset_id -> used for sequencing

Validation rules (reject if any fail):
- Contains at least one space
- Left portion matches a known prefix from config
- Ends in `.mp4`
- No special characters in the ID portion (letters, numbers, dots only)

## Asset Library — Google Sheets Schema

One workbook per client. One tab per format. Tab names from config.

Columns (dynamic based on active platforms):
```
asset_id | filename | content_type | session_id | youtube_url | created_date |
caption_[platform] (per active platform) |
date_[platform] (per active platform) |
publer_id_[platform] (per active platform) |
status_[platform] (per active platform) |
flagged | flag_note | copy_ready | pipeline_status
```

## Workflow — Short Form

1. Watcher detects new `.mp4` in `/short-form/`
2. Validates filename -> rejects if invalid
3. Parses filename -> asset_id, topic_slug, content_type, session_id
4. POSTs to n8n webhook
5. n8n uploads to YouTube as Unlisted
6. Polls YouTube until processing complete
7. Sends audio to Whisper -> transcript
8. Calls Claude API -> generates platform captions
9. Writes row to Google Sheets (pipeline_status: captions_ready)
10. Creates Publer drafts per platform
11. Updates Sheet with Publer IDs (pipeline_status: drafted)

## Workflow — Long Form (stub)

1-4. Same as short form but from `/long-form/`
5. Uploads to YouTube as Unlisted
6. Polls until processing complete
7. Sends to Whisper -> transcript
8. Writes row to Sheet (pipeline_status: pending_copy, copy_ready: FALSE)
9. STOPS. FDL3 handles the rest.

## Publer Webhook Receiver

Flask endpoint on Railway. Receives publish status from Publer, updates Sheet row.
When all platforms = published -> pipeline_status = complete.

## Error Handling

| Error | Behaviour |
|-------|-----------|
| Malformed filename | Move to /rejected/, log, stop |
| YouTube upload fails | Retry 3x with backoff, then halt |
| YouTube processing timeout | Log and halt, pipeline_status: upload_failed |
| Whisper fails | Continue without transcript, caption_source: filename_only |
| Claude API fails | Retry 3x, then halt, pipeline_status: caption_failed |
| Publer upload fails | Retry 3x, then halt, pipeline_status: publer_failed |
| Sheet write fails | Retry 3x, then halt and log |
