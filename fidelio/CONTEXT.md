# CONTEXT — FIDELIO Productions

FIDELIO Productions is a video post-production company. Active client: Dre Alexandra Champagne (MSK & Regenerative Medicine content). Language: French. Platforms: YouTube, YouTube Shorts, Instagram, Facebook, TikTok.

## Current strategic direction (as of April 2026)

FDL1/FDL2/FDL3 have been **superseded** by a unified pipeline spec: `FIDELIO-PIPELINE-SPEC-LATEST.md` (in Downloads and `fdl1-publishing-pipeline/docs/FIDELIO-PIPELINE-SPEC.md`). The old per-build scoping is dead. The new spec is a modular, phased build extending Rob's existing local pipeline.

**Build order (locked):**
1. Tool 1 — Ingestion (Modules A+B+C): filename parser, Frame.io upload, Sheet writer
2. Tool 2 — Copy & Thumbnail (Modules D+E+F): Whisper, per-platform-group copy, thumbnail with references
3. Module G — Publer integration (replaces manual scheduling)
4. Module H — Review UI on Railway
5. Modules I/J — scheduling rules engine, daemon orchestrator

**Key decisions made:**
- Local daemon + web UI on editor Macs (Rob's pattern). Railway only for Review UI later.
- Frame.io for master video storage. Drive for non-video assets + client config.
- Publer replaces Blotato. Editors use Publer manually until Module G ships.
- New unified Google Sheet per client (replaces both Rob's pipeline sheet and the old TT CONTENT tracker).
- Short-form only for v0. Long-form deferred.
- Multi-client config from day one (Drive folder per client, no hardcoded values).

## Active builds

| Build | Folder | Status |
|-------|--------|--------|
| **Unified Pipeline** | `fdl1-publishing-pipeline/` + `_rob-pipeline-clone/` | Spec complete, build not started. Next: scope and build Tool 1. |
| **TOA** | `text-overlay-assistant/` | Live at https://toa.up.railway.app — file upload works |
| **Transcript Chat** | `transcript-chat-assistant/` | Live at https://transcript-chat.up.railway.app |
| **Rob's Pipeline** | `_rob-pipeline-clone/` | Running locally for editors. Thumbnails broken (no references). Copy is one-size-fits-all. Blotato scheduling works. |

**Archived / superseded:** FDL1 (mock-only, never deployed), FDL2 (backfill deferred to post-v1), FDL3 (absorbed into Module H), Video Post Studio (shell only, dormant).

## Rob's pipeline analysis (April 2026)

Rob's code was cloned from `mokshatools-team/fidelio-pipeline` and analyzed in detail. Key findings:

**What works:** Two-pass architecture, ffprobe format detection, Whisper with caching/chunking, 2-pass Claude metadata gen, Blotato scheduling, DaVinci Resolve integration, Monitor UI with SSE progress cards, Google Sheets connector.

**What's broken/missing:**
- Thumbnails: reference images never committed to repo. `thumbnail-generator/` sibling directory expected but doesn't exist. AI generates without brand references.
- Copy: one copy for all platforms. No per-platform-group generation.
- Scheduling: one date for all platforms. No per-platform date selection.
- File storage: approve flow reads video from local disk. If editor moves/deletes file, approve breaks. No cloud master copy.
- Reposts: no concept of repost cycles (77% of marked assets get reposted).
- Post-publish: no confirmation that scheduled posts actually went live.
- Sheet schema: Rob's 4-tab process sheet (Clip Index, Exports, Metadata, Publish Queue) is disconnected from Loric's master tracker (TT CONTENT, 449 assets, 25 columns).

## Master tracker reference

Old tracker: `1aOSpYwzExdKRr-85PVISpLPGqWxOnP8qioxSsib9Tlw`
- TT CONTENT tab: 449 content rows, 25 columns (A-Y), TikTok-primary with per-platform titles and repost tracking
- IMAGES FOR VIDEOS tab: ~65 video topics with medical reference image URLs organized by filming session (editorial overlays, NOT thumbnail references)
- Sheet12: Rob's earlier asset library attempt (~275 rows), abandoned
- Sheet13: filming session log (S0-S18), semi-active

Rob's pipeline sheet: `1RbGcPeLYwZc9uTYfqC8FUry8kaUGuIBoNf8ueydyUi4` — 2 test rows, not used operationally.

## Shared blocker — YouTube 429

YouTube is actively blocking Railway's server IPs from downloading audio via yt-dlp. Affects TOA, Transcript Chat. Workaround: file upload. Fix: YouTube caption API.

## Memory

Project memory: `fidelio/memory/MEMORY.md`
