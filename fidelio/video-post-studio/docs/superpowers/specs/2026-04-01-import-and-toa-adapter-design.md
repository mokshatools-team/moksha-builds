# Import Flow and TOA Adapter Design

## Goal

Add the first real ingestion path to `Video Post Studio` and create a minimal `TOA` adapter seam so the shell can move from placeholder pages toward actual workflow integration without importing the full standalone TOA codebase yet.

## Scope

In scope:

- a real `Import` flow that accepts lightweight source records in the shell app
- in-memory persistence of imported source assets within the demo workspace layer
- a `TOA` adapter interface and a minimal adapter-backed summary view in the `TOA` module page
- tests covering import submission, workspace state updates, and adapter rendering

Out of scope:

- file uploads or binary storage
- real transcription
- direct code import from the standalone `text-overlay-assistant` repo
- background jobs
- full TOA overlay generation inside `video-post-studio`

## Architecture

`Import` should become the first route with state-changing behavior. For this slice, the state remains in-process and demo-oriented, but the code should be structured as if it will later swap to durable persistence.

The `TOA` module should stop being a pure placeholder. Instead of embedding real TOA logic immediately, it should call an internal adapter seam that reads the shared workspace and returns a lightweight TOA-facing summary. This proves the integration boundary without coupling the shell to the standalone repo’s internals.

## Shared Model Changes

### SourceAsset

Introduce a minimal `SourceAsset` dataclass with:

- `id`
- `source_type`
- `title`
- `source_value`

Allowed source types for this slice:

- `upload`
- `public_url`
- `owned_account`

### Workspace

Expand `Workspace` minimally to hold actual source objects in addition to `source_asset_ids`, so the shell can render meaningful state without inventing parallel structures later.

## Service Layer

Add a workspace state service responsible for:

- constructing the demo workspace
- listing source assets
- appending a new source asset
- selecting the active module when building the workspace view

Keep this purely in-memory for now.

## Import Flow

The `Import` page should include:

- a small form with:
  - source type
  - title
  - source value
- submission handling via POST
- rerendered workspace summary after submit

Validation:

- title required
- source value required
- source type must be one of the allowed values

## TOA Adapter

Add an internal adapter function that accepts `Workspace` and returns a small dictionary or dataclass for the TOA page:

- whether sources exist
- source count
- latest source title if present
- a short status message

This is intentionally not the real TOA engine. It is the seam that later real TOA integration will implement more deeply.

## Testing Strategy

- model tests for `SourceAsset`
- service tests for adding/importing sources into the workspace
- route tests for:
  - import form GET
  - successful POST
  - validation failure
  - TOA module showing adapter-backed workspace summary

## Future Fit

This slice creates the two most important reuse seams:

- `Import` owns source creation for the shell app
- `TOA` consumes shared workspace state through an adapter boundary rather than direct internal coupling

That is the right base for later real TOA integration and later transcript generation.
