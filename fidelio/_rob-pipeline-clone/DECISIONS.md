# Fidelio Pipeline — Decisions & TBDs
Running log of design decisions, open questions, and things to revisit.

---

## Settled Decisions

**Blotato integration: REST (not MCP)**
Direct HTTP calls. MCP is for AI-driven tool use — posting is human-triggered via the Review UI, so REST is the right fit.

**Social posting: Blotato handles all platform auth**
No Meta Business Suite, Creator Studio, or platform-specific setup on our end. One-time OAuth per platform inside Blotato. Facebook must connect the Page (not personal profile).

**Platforms: YouTube, Instagram, TikTok, Facebook**
All four active for Dre Alexandra. Connected via Blotato workspace.

**Short-form detection: ffprobe aspect ratio**
portrait (height > width) = short-form reel. landscape = long-form. Detected automatically on file drop.

**Short-form pipeline: Pass 2 only**
Vertical clips skip Pass 1 entirely (no Whisper on raw, no Resolve setup). Go straight to export watch → simplified metadata (hook + 1 title, not 3 options).

**Metadata language: Quebec French (fr-CA)**
All Claude-generated titles, descriptions, hooks output in Quebec French. Tone: warm, non-alarmist, accessible.

**Shared state layer: Google Sheets**
Local daemon writes, Review UI reads. They never talk to each other directly. One sheet per client.

**Processing stays local**
Raw footage too large for cloud. Resolve MCP requires local Resolve instance. Only the Review UI deploys to Railway.

**Google Service Account**
Reusing `inventory-bot@dre-content-inventory.iam.gserviceaccount.com` from the content inventory tool.

**Blotato integration: rewritten to the live v2 API**
Uses `blotato-api-key`, fetches connected account IDs from `/v2/users/me/accounts`, uploads local media through `/v2/media/uploads` presigned URLs, then schedules posts with `/v2/posts` using nested `post.accountId`, `post.content.mediaUrls`, and `post.target`.

**Review UI browser behavior: fixed URLs, no forced tab opens**
Daemon now only logs the Monitor and Review URLs. Browser tabs stay fixed and are refreshed manually instead of being auto-opened on daemon start or Pass 2 completion.

**Review UI refresh model: manual**
The Review page no longer background-refreshes. Use normal browser refresh when you want the latest queue state. This avoids flicker, silent state resets, and excess Google Sheets read traffic.

**Review UI platform controls: real toggles + availability gating**
Platforms now render as sticky on/off toggles. Any platform not connected in Blotato shows as unavailable and is blocked both in the UI and server-side approve route.

**Google Sheets schema: Review URL column added**
`Review URL` is now written into Exports, Metadata, and Publish Queue so the sheet carries a direct clickable route back to the Review UI.

**Publish Queue writeback: per-platform status rows**
Approve writes now upsert one row per platform with truthful status (`Scheduled` / `Failed`) instead of only recording happy-path schedules.

**Pass 1 smoke test: confirmed working**
Ingest watcher, transcript generation, Sheets writes, Resolve project/bin creation, clip import, and transcript markers all worked in a live smoke test.

**Pass 2 smoke test: confirmed working**
Export watcher, metadata generation, thumbnail generation, Review UI flow, and Blotato scheduling all worked live for connected platforms after API fixes.

**Short-form covers: mixed auto mode**
Pass 2 now auto-generates vertical covers using either a real host frame or a stock-style concept image depending on the content. This gives variety without requiring manual regen every time.

**Manual thumbnail regen: exact host scrubber frame**
When `IG · Host` is selected in the Review UI, regenerate uses the exact chosen host frame from the scrubber instead of a generic frame.

**Manual thumbnail regen: IG stock is transcript-driven**
When `IG · Stock` is selected, the image prompt is built from title + summary + description + tags so the generated stock scene tracks the actual topic instead of copying the style ref image.

**Review UI: short-form previews render in portrait**
Vertical thumbnails, brand-ref chips, and scrubber previews now render in portrait so editors can actually judge short-form covers correctly.

**Blotato upload: stitched cover frame**
Before scheduling, the pipeline prepends a tiny cover-image clip to the export so Blotato and downstream platforms use the intended cover image even without a dedicated thumbnail upload step.

**Publish Queue: Cover Stitch is now first-class**
`Cover Stitch` is written into Publish Queue, surfaced in the Review UI, and has a matching dropdown in the sheet (`Stitched` / `Original video`).

**Sheets schema evolution: auto-expand before new header writes**
If a new column is introduced after the sheet already exists, `ensure_column()` now expands the worksheet before writing the header. This fixed the live `Cover Stitch` write failure.

**TikTok via Blotato: privacy enum is uppercase**
Blotato rejects lowercase TikTok privacy values. Working value is `PUBLIC_TO_EVERYONE`.

**Google Sheets quota sensitivity**
Sheets reads can hit quota quickly if the UI polls too aggressively or if we re-read Publish Queue per platform. Spreadsheet/worksheet handles are now cached and the UI is manual-refresh to keep read pressure down.

---

## TBD / To Revisit

**Platform routing by content type**
Long-form → YouTube (primary) + Facebook. Short-form reels → TikTok + Instagram + Facebook.
Currently platform availability is based on connected Blotato accounts, but content-type-specific default routing is still not enforced.

**Watch folders per content type**
Config has `watch_folder_long` and `watch_folder_short` fields ready but both point to the same folder for now.
When editors have separate export destinations for reels vs long-form, update `dre-alexandra.json`.

**Thumbnail gen: needs prompt tuning (noted 2026-04-04)**
Current output ignores the reference frame and generates a flat infographic. Fix options:
1. Stronger FAL prompt — "photorealistic, use provided image as background, person visible, title text overlay"
2. Switch to inpainting model for frame-preserving generation
3. Pillow composite — keep raw frame, stamp title text on top (simpler, more YouTube-native)
Architecture is open for any of these — `thumbnail.py` has prompt builder and FAL call fully separated. Revisit after core pipeline is stable.

**Blotato: TikTok API field names**
Basic TikTok scheduling works now. Still worth verifying whether richer TikTok fields should diverge from YouTube/Instagram for production use.

**DaVinci animation overlay sidecar**
Editors are building a Resolve plugin for animation overlays (~30% of long-form sessions).
Plan: optional MCP tool call at end of Pass 1, gated by client config flag. Completely separate sidecar — don't weave into main pipeline until tool is ready.

**Publer vs Blotato for multi-client — SETTLED: stay with Blotato**
Publer Business = $10 base + $7/account. For 4 platforms per client = $38/mo. Blotato Starter = $29/mo per client. Blotato is cheaper at this volume. Publer only wins at Enterprise scale with flat-rate negotiation. Decision: Blotato per client, one API key per client config.


Dre Alexandra already has a content inventory sheet managed by Loric.
TBD: whether to merge pipeline sheet with Loric's sheet or keep them separate.

**Short-form metadata: hook field in Review UI**
Short-form metadata generates a `hook` field (1-2 sentence opener) that doesn't currently show in the Review UI.
Add hook display/edit field to review.html for short-form items.

**Railway deployment**
Review UI not yet deployed. Need to: create Railway project, push to mokshatools-team/fidelio-pipeline, set env vars.
URL TBD — `pipeline.fidelio.com` or similar.

**GitHub remote + editor rollout**
Repo currently has no git remote configured. Near-term ops priority is:
1. push to GitHub
2. lock the install flow
3. test onboarding on the other two editor machines

**Blotato post-publish webhook**
Once Blotato confirms a post went live, we want to update Publish Queue: Status → "Posted", add post link.
Blotato may support webhooks for this — check their docs after smoke test.

---
*Last updated: 2026-04-06*
