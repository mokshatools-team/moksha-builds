# Transcript Module and YouTube Input Design

## Goal

Refactor Text Overlay Assistant so transcription input flows through a shared transcript module that accepts either a local file path or a YouTube URL, while preserving the existing overlay analysis behavior and output format.

## Current State

- `app.py` handles upload-mode file persistence, optional `ffmpeg` audio extraction, OpenAI transcription, and Claude analysis.
- `templates/index.html` supports only local watch-folder files or uploaded files.
- The downstream analysis path expects timestamped transcript entries, not a plain transcript string.

## Constraints

- Keep the Claude analysis prompt and output shape unchanged.
- Keep the existing file-upload path working.
- Do not change Railway deployment config.
- Add YouTube URL input without creating an ambiguous mixed-input flow.
- Match the live codebase by keeping OpenAI transcription rather than switching to local Whisper.

## Chosen Approach

Create a focused `transcript_fetcher.py` module with `fetch_transcript(source: str) -> str` that:

- detects whether `source` is a YouTube URL or a local file path
- downloads YouTube audio with `yt-dlp` into a temp file when needed
- transcribes the resolved media via the existing OpenAI audio transcription API
- returns plain transcript text
- raises explicit exceptions on invalid source, missing file, download failure, or transcription failure

`app.py` will continue to own the request/response orchestration. It will call the shared module for the raw transcript, then build the existing `entries` list shape for the analysis step. For local files, timestamped segment transcription will remain in `app.py` because the current overlay pipeline depends on segment timestamps. The shared module is introduced as the reusable plain-text transcript entry point for future tools and the new YouTube path.

## Data Flow

### Local file path

1. User selects a file from watch folder or uploads a file.
2. `app.py` resolves the local file path.
3. `app.py` performs the existing segment-based OpenAI transcription flow for timestamped entries.
4. `/analyze` receives the same timestamped entries as before.

### YouTube URL

1. User pastes a YouTube URL.
2. `app.py` passes the URL to `fetch_transcript`.
3. `transcript_fetcher.py` downloads audio with `yt-dlp`, transcribes it with OpenAI, deletes the temp file, and returns plain text.
4. `app.py` converts that plain text into a minimal `entries` structure suitable for the existing `/analyze` contract.

## UI Design

- Add a new input section labeled `Paste a YouTube URL`.
- Insert a clear separator indicating the user should provide either a file or a URL.
- Keep one `Analyze` button.
- Validate:
  - both provided -> error
  - neither provided -> error
  - invalid YouTube URL -> error surfaced from backend

## Error Handling

- `fetch_transcript` raises:
  - `ValueError` for malformed or unreachable YouTube URLs
  - `FileNotFoundError` for missing local paths
  - `RuntimeError` for OpenAI transcription or `yt-dlp` execution failures
- `app.py` converts those into JSON API errors without changing the rest of the analysis flow.

## Testing Strategy

- Add unit tests for `transcript_fetcher.py` source classification and failure behavior.
- Add Flask route tests for input validation:
  - both file and URL set
  - neither set
  - URL-only path
- Preserve existing transcribe/analyze contract behavior for file inputs.

## Scope Boundaries

- No changes to the Claude prompt.
- No changes to DaVinci JSON output format.
- No changes to deployment config beyond dependency additions in `requirements.txt`.
