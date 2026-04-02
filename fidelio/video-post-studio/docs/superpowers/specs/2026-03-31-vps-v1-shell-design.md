# Video Post Studio V1 Shell Design

## Goal

Build the first functional slice of `Video Post Studio` as a modular monolith: one app shell, one shared workspace model, and three visible v1 modules (`Import`, `TOA`, `Transcript Chat`).

## Scope

This first slice is not a full TOA migration. It establishes the shell, core contracts, and navigation boundaries that future tool integrations will plug into.

In scope:

- app shell with module navigation
- shared core models for `Workspace`, `SourceAsset`, `TranscriptSession`, `Job`, and `Artifact`
- simple routes/pages for `Import`, `TOA`, and `Transcript Chat`
- basic in-memory workspace bootstrap so the shell is usable immediately
- automated tests covering core models and shell routes

Out of scope:

- real database integration
- background job queue
- actual TOA logic migration
- actual transcript chat model integration
- copy/clips/editing features

## Architecture

`Video Post Studio` starts as a Python Flask app with a small package layout:

- `app/models` for shared contracts
- `app/services` for workspace bootstrapping and future orchestration seams
- `app/routes` for module pages and JSON endpoints

The app will expose one workspace-centered shell. `Import`, `TOA`, and `Transcript Chat` are separate route modules that all consume the same workspace object.

## Core Contracts

### Workspace

Top-level project container for all source, transcript, job, and artifact state.

### SourceAsset

Normalized source reference with support for `upload`, `owned_account`, and `public_url`.

### TranscriptSession

Normalized transcript substrate with timestamped segments and full-text convenience field.

### Job

Async work record for import, transcription, TOA generation, and chat tasks.

### Artifact

Saved output from modules, such as TOA overlay JSON or future chat/copy artifacts.

## UI Shape

The first shell page should include:

- app title: `Video Post Studio`
- sidebar or top-level navigation for:
  - `Import`
  - `TOA`
  - `Transcript Chat`
- main panel showing:
  - current workspace name
  - active module
  - lightweight module description
  - a summary of current shared workspace state

This is a structural shell, not a final polished product UI.

## Testing Strategy

- unit tests for each core model contract
- route tests for shell and module pages
- service tests for default workspace bootstrapping

## Future Fit

This design is intentionally conservative so the shell can absorb:

- TOA from `text-overlay-assistant`
- later `Copy` integration as an adapter
- later `Clips`, `Editing`, and `Pipeline`

The rule is that future modules must consume shared contracts rather than inventing their own state model.
