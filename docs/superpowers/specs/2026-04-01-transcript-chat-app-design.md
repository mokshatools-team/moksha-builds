# Transcript Chat App Design

## Goal
Build a standalone transcript-first web app, separate from `text-overlay-assistant`, that ingests a source, fetches a transcript, shows it directly, lets the user copy/download it, and supports in-app AI chat grounded on that transcript.

## Product Boundary
- Keep `text-overlay-assistant` unchanged in purpose and deployment.
- Build a second standalone app with its own Railway service.
- Support the same ingestion modes as TOA: local file upload, public YouTube URL, and owned-account YouTube.
- Reset the active transcript and chat whenever a new source is ingested.

## User Flow
1. User selects an ingestion mode and submits a source.
2. The app derives a default title from the uploaded filename or YouTube title.
3. The app fetches transcript entries and renders a transcript workspace page.
4. The workspace page shows transcript text, copy/download actions, and a transcript-grounded chat panel.
5. Importing another source replaces the current transcript and clears the prior chat.

## Technical Shape
- Create a new sibling app directory instead of modifying the live TOA app.
- Reuse the working transcript-fetching approach from TOA.
- Keep state in memory for one active source, one active transcript, and one active chat thread.
- Use a simple Flask backend and server-rendered HTML with lightweight browser-side fetch calls for ingestion and chat.

## Downloads
- Provide plain-text exports first.
- Ship `.txt` and `.md` in v1.
- Structured `.json` can be added later if needed.

## Testing
- Route tests for home page rendering, ingestion validation, transcript-ready rendering, chat responses, transcript download formats, and state reset on new ingest.
- Transcript fetcher tests can be copied and narrowed to the new app’s supported flows.
