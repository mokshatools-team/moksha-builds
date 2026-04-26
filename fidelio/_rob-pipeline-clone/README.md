# Fidelio Pipeline

Fidelio Pipeline is a local Python workflow for post-production teams handling ingest, transcription, metadata logging, sheet updates, thumbnails, and downstream review steps. It is built for editors running locally on macOS and centers around per-client JSON configs that map drives, Google Sheets, and platform-specific output behavior.

## Quick Start

1. Clone the repo: `git clone <repo-url> && cd fidelio-pipeline`
2. Run setup: `bash setup.sh`
3. Start the pipeline for a client: `python local/start.py --client <id>`

## Team Access

The review UI is intended to be available to the wider team via Railway:

`https://review-ui-placeholder.up.railway.app`

## Adding a New Client

Add a new JSON file in `config/clients/` named after the client ID, for example `my-client.json`. The pipeline currently expects these fields:

- `client_id`: stable slug used on the CLI, for example `dre-alexandra`
- `display_name`: readable client name shown in logs and UI
- `brand_profile_url`: URL for the brand/profile reference used by the workflow
- `ingest_folder`: local folder to watch for incoming raw footage
- `watch_folder`: local folder to watch for finished exports
- `platforms`: array of destination platforms such as `youtube` or `instagram`
- `sheets_id`: Google Sheet ID used for pipeline write-backs
- `language`: transcription language code, for example `fr-CA`
- `notes`: freeform client context for operators

Once the file is in place, start the daemon with `python local/start.py --client <client_id>`.

## Multi-agent Build

This project is being built in a multi-agent workflow with Claude + Codex.

## Current Status

Core local workflow is now live for Dre Alexandra:

- Pass 1 ingest writes to Sheets and Resolve
- Pass 2 export processing generates metadata and thumbnails
- Review UI supports per-platform approval and thumbnail regeneration
- Blotato scheduling is working for connected platforms
- Publish Queue now records `Cover Stitch` when the thumbnail frame is prepended before upload

## Rollout Next

Next phase is editor rollout:

1. Add a Git remote and push the current build to GitHub
2. Freeze the install flow for other editors around `setup.sh`, `.env`, Google credentials, and local folder config
3. Write a short onboarding checklist for first launch, smoke test, and Blotato/Sheets verification
