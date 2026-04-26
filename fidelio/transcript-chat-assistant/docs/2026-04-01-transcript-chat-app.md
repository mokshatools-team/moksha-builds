# Transcript Chat App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Flask app that ingests a source, fetches a transcript, shows transcript copy/download actions, and supports transcript-grounded chat in one active in-memory session.

**Architecture:** Create a new sibling app by reusing TOA’s transcript-fetching patterns while removing overlay analysis entirely. Keep one active transcript/chat session in memory and render a single transcript workspace page with lightweight JSON endpoints for ingest, chat, and downloads.

**Tech Stack:** Flask, unittest, Anthropic SDK, OpenAI SDK, yt-dlp, python-dotenv, Google OAuth client libraries

---

### File Map

**Create**
- `transcript-chat-assistant/app.py`
- `transcript-chat-assistant/transcript_fetcher.py`
- `transcript-chat-assistant/templates/index.html`
- `transcript-chat-assistant/tests/__init__.py`
- `transcript-chat-assistant/tests/test_app_routes.py`
- `transcript-chat-assistant/tests/test_transcript_fetcher.py`
- `transcript-chat-assistant/requirements.txt`
- `transcript-chat-assistant/Procfile`
- `transcript-chat-assistant/README.md`

**Reuse as reference only**
- `text-overlay-assistant/app.py`
- `text-overlay-assistant/transcript_fetcher.py`
- `text-overlay-assistant/templates/index.html`

### Task 1: Scaffold the new app with failing route tests

**Files:**
- Create: `transcript-chat-assistant/tests/test_app_routes.py`
- Create: `transcript-chat-assistant/tests/__init__.py`
- Create: `transcript-chat-assistant/app.py`

- [ ] Step 1: Write failing tests for home, ingest validation, transcript downloads, chat, and reset behavior.
- [ ] Step 2: Run `python -m unittest discover -s tests` in `transcript-chat-assistant/` and confirm failure from missing app/routes.
- [ ] Step 3: Implement the minimal Flask app and in-memory session state to satisfy the route contracts.
- [ ] Step 4: Re-run the route tests and make them pass.

### Task 2: Add transcript fetcher tests and reusable helpers

**Files:**
- Create: `transcript-chat-assistant/tests/test_transcript_fetcher.py`
- Create: `transcript-chat-assistant/transcript_fetcher.py`

- [ ] Step 1: Write failing tests for YouTube URL detection, plain transcript fetching, and YouTube download invocation.
- [ ] Step 2: Run the transcript fetcher tests and confirm failure for missing helpers.
- [ ] Step 3: Implement the minimal fetcher and title helper functions reused by the new app.
- [ ] Step 4: Re-run the transcript fetcher tests and make them pass.

### Task 3: Build the transcript-first UI and API flow

**Files:**
- Create: `transcript-chat-assistant/templates/index.html`
- Modify: `transcript-chat-assistant/app.py`

- [ ] Step 1: Render a transcript-first page with familiar ingestion modes and no overlay-specific controls.
- [ ] Step 2: Add JSON endpoints for ingestion and transcript-grounded chat.
- [ ] Step 3: Add transcript copy/download affordances for `.txt` and `.md`.
- [ ] Step 4: Re-run route tests and add any missing assertions for transcript-ready rendering.

### Task 4: Add packaging and deploy files

**Files:**
- Create: `transcript-chat-assistant/requirements.txt`
- Create: `transcript-chat-assistant/Procfile`
- Create: `transcript-chat-assistant/README.md`

- [ ] Step 1: Add the dependency set required for local runs and Railway.
- [ ] Step 2: Add a Gunicorn Procfile for Railway deployment.
- [ ] Step 3: Document local setup, env vars, and deploy expectations in the README.
- [ ] Step 4: Run the full test suite and verify the app can start locally.
