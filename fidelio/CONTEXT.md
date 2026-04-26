# CONTEXT — FIDELIO Productions

FIDELIO Productions is a video post-production company. Active client: Dre Alexandra Champagne (MSK & Regenerative Medicine content). Language: French. Platforms: YouTube, YouTube Shorts, Instagram, Facebook, TikTok.

## Active builds

| Build | Folder | Status (from CONTEXT.md) |
|-------|--------|--------------------------|
| **FDL1 — Publishing Pipeline** | `fdl1-publishing-pipeline/` | Phase 1 code complete, deploy blocked — Railway root directory setting causes "no associated build" error |
| **FDL2 — Archive Import** | `fdl2-archive-import/` | Architecture scoped, build not started — waiting on Facebook JSON + TikTok JSON from Dre's team |
| **TOA — Text Overlay Assistant** | `text-overlay-assistant/` | Deployed at https://toa.up.railway.app — file upload works, YouTube URL blocked (Railway IP 429), density scale rebuild not yet deployed |
| **Transcript Chat Assistant** | `transcript-chat-assistant/` | Deployed at https://transcript-chat.up.railway.app — file upload works, YouTube URL blocked (Railway IP 429), YouTube OAuth not verified on Railway |
| **Video Post Studio** | `video-post-studio/` | Architectural shell only — mock modules, not deployed, no Railway service |
| **Rob's Pipeline Clone** | `_rob-pipeline-clone/` | Rob's parallel implementation — local Python workflow for ingest, transcription, metadata, sheet updates, client review UI |
| **FDL3 — Copy Review UI** | *(no folder yet)* | Planned, to be scoped — standby |
| **FDL5 — Pre-Production Research** | *(no folder yet)* | Planned, to be scoped — standby |

## How the builds relate

The pipeline architecture flows: raw video → **TOA** (generates text overlays for DaVinci Resolve) → **FDL1** (automates YouTube upload, transcription, caption generation, Sheets tracking, Publer draft creation). **FDL2** is a one-time backfill that populates the Asset Library with historical content from before FDL1 existed. **Transcript Chat** is a standalone Q&A tool for studying video transcripts. **Video Post Studio** is the planned umbrella shell that will eventually absorb TOA and Transcript Chat into a unified workspace.

Rob's pipeline clone is a parallel implementation by Rob (team member) covering the same ingest-to-publish flow with a different architecture (local Python + Blotato API). Both approaches are active.

## Shared blocker — YouTube 429

YouTube is actively blocking Railway's server IPs from downloading audio via yt-dlp. This affects TOA, Transcript Chat, and Video Post Studio. **Do not attempt per-build fixes.** Must be solved at the shared infrastructure level. Current workaround: file upload instead of YouTube URL.

Recommended fix: Switch to YouTube caption API (no yt-dlp, no ffmpeg, no IP blocking). See any build's CONTEXT.md "Known Blockers" section for details.

## Shared resources

- Railway project: `fidelio`
- Asset Library Google Sheet: managed by Rob (get current sheet ID from Rob before writing)
- Google service account: used for Sheets access across FDL1 and FDL2

## Memory

Project memory: `fidelio/memory/MEMORY.md`

Each build has its own CONTEXT.md — read it before working on that build.
