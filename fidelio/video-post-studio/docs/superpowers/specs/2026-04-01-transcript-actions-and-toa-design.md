# Transcript Actions and TOA Integration Design

## Goal

Add the first real shared transcript layer to `Video Post Studio`, expose transcript-ready user actions after import, and make `TOA` consume the shared transcript object instead of source-only demo state.

## Scope

In scope:

- introducing a minimal `TranscriptSession` contract
- storing transcript state alongside imported source state in the in-memory workspace layer
- showing a transcript-ready UI state in `Import`
- transcript actions for:
  - copying transcript text
  - downloading transcript text
  - opening `TOA`
- updating `TOA` so it reads the shared transcript layer rather than only the source summary
- tests covering transcript storage, transcript-ready rendering, transcript download, and TOA transcript-backed state

Out of scope:

- real chat or research assistant features
- multi-tool automation after transcript creation
- persistent database storage
- full standalone TOA code import from `text-overlay-assistant`
- background job infrastructure

## Product Behavior

`Import` remains the only place where the user initiates source ingestion. Once a transcript exists, the app should not automatically trigger any downstream tool.

Instead, the transcript becomes shared workspace state and the user is shown explicit next actions:

- copy the transcript
- download the transcript
- open `TOA`

This keeps the app organized as one shell with multiple independent tools. The shared substrate is the source and transcript state, not a forced processing pipeline.

## Shared Model Changes

### TranscriptSession

Introduce a minimal `TranscriptSession` dataclass with:

- `id`
- `source_asset_id`
- `transcript_text`
- `status`

For this slice, `status` can remain simple, such as `ready`.

### Workspace

Expand `Workspace` minimally to hold transcript state in addition to source state. The workspace should be able to expose:

- the active transcript session, if present
- whether transcript-ready actions should be shown

The design should stay compatible with future support for multiple transcript versions, but this slice only needs a single active transcript session.

## Service Layer

Extend the in-memory workspace service so it can:

- append source assets
- create or attach a transcript session for a source asset
- return workspace state with the active module selected

For this slice, transcript creation can remain demo-oriented and in-memory. The important thing is the contract boundary, not real transcription integration yet.

The transcript generation path should still exist as a real service function with a stable interface. For now, that function should return a hardcoded or deterministic mock transcript string rather than skipping transcript generation entirely. Later slices can swap the internals to a real transcription backend without changing the call site contract.

## Import Module Behavior

The `Import` module should now have two states:

### Pre-transcript

- show the import form
- allow source submission as it does now

### Transcript-ready

When a transcript session exists, show:

- a transcript preview
- a `Copy Transcript` action
- a `Download Transcript` action
- an `Open TOA` action

The transcript preview does not need to show the entire transcript if truncation is cleaner, but the copy/download actions must use the full transcript text.

For this slice, importing a new source while a transcript already exists should replace the current active source and transcript state. `Video Post Studio` should behave as one active workspace with one active transcript session for now, rather than queuing or retaining multiple transcript sessions in the UI.

## Copy and Download Actions

### Copy Transcript

For this slice, copy can be implemented as a UI affordance that exposes the full transcript in a way the browser can copy directly from the page. If a lightweight browser-native copy interaction is easy to support, that is acceptable.

The key requirement is that the UI clearly offers transcript copying without introducing heavy frontend complexity.

### Download Transcript

Add a simple route that returns the transcript as a plain text file.

Recommended response shape:

- content type: `text/plain; charset=utf-8`
- filename pattern: derived from source title when available, with a safe fallback such as `transcript.txt`

## TOA Integration Boundary

`TOA` should remain a separate module in the shell. It should not run automatically after transcript creation.

For this slice, `TOA` should read the shared `TranscriptSession` and render transcript-backed readiness state such as:

- transcript available or not
- transcript length or preview
- a short status message indicating that TOA can now operate from the shared transcript layer

This is still not full TOA generation. It is the first real integration step proving that `TOA` depends on the shared transcript substrate rather than on import-specific source state.

## Routing

The following route additions or updates are expected:

- `Import` route continues to support GET and POST
- transcript download route for the active transcript
- `TOA` route renders transcript-backed state when transcript exists

Any copy behavior should avoid requiring complex JavaScript unless it materially improves the UX.

## Testing Strategy

- model tests for `TranscriptSession`
- service tests for attaching transcript state to a workspace
- route tests for:
  - transcript-ready import state after source submission
  - transcript download success
  - TOA module showing transcript-backed status

The tests should keep the current in-memory app model and avoid introducing persistence concerns that are outside the scope of this slice.

## Future Fit

This slice establishes the real shared contract that later tools will consume:

- `Import` produces source and transcript state
- transcript actions operate directly on the shared transcript
- `TOA` consumes the transcript without being coupled to the import form

That is the right base for later `Copy`, `Clips`, and research tooling while keeping each tool independently activated by the user.
