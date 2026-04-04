# Video Post Studio

Unified shell for modular video post-production tools.

## Run Locally

Create a local virtualenv, install the dependency, and start the current shell:

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python run.py
```

Then open `http://127.0.0.1:5000/` in a browser.

## V1 Modules

- `Import`
- `TOA`
- `Transcript Chat`

## Current V1 Behavior

- `Import` accepts lightweight in-memory source records with `source_type`, `title`, and `source_value`.
- Each successful import replaces the current active source and generates a deterministic mock `TranscriptSession` through a stable transcript service seam.
- Imported source and transcript state persist only for the current Flask process and reset when the app restarts.
- Once a transcript is ready, `Import` shows transcript actions for copy, plain-text download, and opening `TOA`.
- `TOA` now reads the shared transcript layer and shows transcript-backed readiness, length, and preview state without running real overlay generation yet.
- `Transcript Chat` is still a shell module and does not yet consume transcript data.

## Planned Later Modules

- `Copy`
- `Clips`
- `Editing`
- `Pipeline`

## Architecture

`Video Post Studio` starts as a modular monolith:

- one backend app
- one frontend shell
- one shared workspace/session model
- multiple tool modules built on top of the same transcript substrate

The current standalone TOA repo remains separate as `text-overlay-assistant` and will later integrate into this shell through a dedicated adapter boundary instead of being copied wholesale.

## Suggested Structure

```text
video-post-studio/
├── app/
│   ├── models/
│   ├── routes/
│   └── services/
├── docs/
└── ui/
```

## Core Contracts

The platform is designed around five shared objects:

- `Workspace`
- `SourceAsset`
- `TranscriptSession`
- `Job`
- `Artifact`

These contracts should remain stable so future modules can plug in without rework.
