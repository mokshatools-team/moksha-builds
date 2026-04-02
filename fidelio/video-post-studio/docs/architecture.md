# Video Post Studio Architecture

## Purpose

`Video Post Studio` is the umbrella shell for modular video post-production tools.

The first version is intentionally narrow:

- `Import`
- `TOA`
- `Transcript Chat`

## Model

The app should be built around these shared entities:

### Workspace

Top-level project container tying together sources, transcripts, jobs, and artifacts.

### SourceAsset

Normalized representation of where media came from:

- upload
- owned account import
- public URL

### TranscriptSession

Normalized transcript object with timestamped segments and metadata. This is the shared substrate for all downstream tools.

### Job

Async unit of work for import, transcription, TOA generation, and future pipeline tasks.

### Artifact

Saved output from any module, such as:

- TOA overlay JSON
- chat notes
- later copy drafts
- later clip plans

## Modularity Rule

Each tool should consume shared contracts, not reach into another tool's internal implementation.

That means:

- `Import` owns source acquisition
- `TOA` owns overlay generation
- `Transcript Chat` owns transcript conversation
- future `Copy` will plug in as an adapter

## Migration Strategy

The current standalone TOA repo remains separate as `text-overlay-assistant`.

This repo should first establish:

1. shell navigation
2. core contracts
3. import flows
4. transcript session handling

Only after those are stable should TOA logic be selectively ported behind a module boundary.
