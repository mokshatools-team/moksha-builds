# Fidelio Content Pipeline — Build Spec v1

**Status:** Architecture and decisions consolidated. Some items explicitly marked TBD.
**Audience:** Rob (or an AI assistant building from this) — anyone executing the v1 build.
**Last updated:** April 2026

---

## 0. Context and Goals

This document is the destination spec for the Fidelio content pipeline. It supersedes the original FDL1, FDL2, FDL3 scopes with a single unified architecture, executed in phased modules.

The system runs a client's content pipeline end-to-end: ingest from editor exports → automated processing (transcription, copy generation, thumbnail) → human review (internal copy review + client video review) → scheduled publishing across multiple platforms with multi-cycle reposts.

The first client is Dre Alexandra Champagne. The architecture is built to onboard additional clients with config-only changes (no code rewrites). When this doc references "Dre" specifically, it's because we're describing the first real configuration; the architecture itself is client-agnostic.

The build is **modular and phased**. We do not build the whole spec in one shot. We ship Tool 1 (Ingestion) first, then Tool 2 (Copy & Thumbnail), then incrementally add the remaining modules as adoption proves out and friction shows where it actually is. Each module is independently useful and can be paused at any phase.

### Must-have, eventually (the destination)

1. Reliable ingest → review → schedule pipeline for short-form (TikTok capsules)
2. Reliable ingest → review → schedule pipeline for long-form (Fondations, Podcasts, Vlogs)
3. Files survive editor drive management — cloud master, local files disposable after upload
4. Filename parsing from editor's loose export naming into canonical form
5. Tool 1 (Ingestion): filename parser, confirmation prompt, canonical rename, Frame.io upload, sheet write
6. Tool 2 (Copy + Thumbnail): per-platform-group copy generation, thumbnail generation with curated references, manual override
7. Per-platform hashtag selection from curated pools per platform
8. Two TikTok channel routing (main vs MSK) based on content tagging
9. Client review experience — Frame.io for video playback, Sheet checkbox for approval
10. Internal copy + thumbnail review queue in deployed Review UI
11. Status field that drives filtered views per role/purpose
12. Reposts as first-class concept (>50% of release volume)
13. Schedule planning step (rules engine assigns tentative dates per platform per cycle)
14. Schedule execution step (commit fires Publer API calls)
15. Master sheet that reflects current truth across all assets, sessions, releases, reviews
16. Multi-client config separation in JSON/markdown files, not code
17. Editable scheduling rules per client

### v0 scope (what gets built first)

- **Tool 1 — Ingestion** (Modules A + B + C): filename parser, Frame.io upload, sheet writer
- **Tool 2 — Copy & Thumbnail** (Modules D + E + F): Whisper, per-platform-group copy, thumbnail with references and manual override
- **Master Asset Library Sheet** with the schema described in §6
- **Multi-client config layer** so first-client setup is transferrable

### Deferred (build after v0 proves out)

- Module G: Publer API integration (replaces manual Publer upload)
- Module H: Review UI deployed to Railway (replaces localhost-per-editor)
- Module I: Scheduling rules engine (Apps Script that proposes dates)
- Module J: Daemon orchestrator (auto-chains Tool 1 → Tool 2 on file detection)
- Long-form sheet support (long-form assets in v0 are tracked manually outside the system)
- Hashtag pool curation
- Notifications beyond Sheet @-tag mentions
- Backfill of historical assets from existing trackers
- Settings UI for editing rules and brand profiles
- Performance metrics tracking and feedback loop

---

## 1. Architecture Overview

Three-layer system. Each layer does what it's best at.

### Layer 1: Local daemons on editor Macs

What lives here: file watching, video processing, AI generation, upload to cloud master.

- File system watchers (where applicable)
- ffprobe analysis (format detection: short-form vs long-form)
- Whisper transcription with caching
- FAL thumbnail generation with curated reference pool
- Per-platform-group copy generation (Claude API calls)
- Upload to Frame.io (master video)
- Upload to Drive (transcripts, generated thumbnails, per-asset metadata)
- Write asset rows to the master Sheet via Sheets API
- Local web UI on localhost serving Tool 1 and Tool 2 pages

What does NOT live here: any deployed UI for non-editor users, scheduling logic, Publer API calls.

**Why local:** raw exports are too large to upload-then-process in cloud. DaVinci Resolve integration requires local Resolve instance. Whisper runs faster on M-series Macs than on small Railway instances. This is also Rob's existing architecture; we extend it, not replace it.

### Layer 2: Apps Script in the master Google Sheet

What lives here: rules engine (deferred), status automation, lightweight Sheet-side logic.

- Auto-status-transitions on approval checkbox edits (when checkbox toggles, status field updates automatically; editors never manually flip status)
- Custom menu in the Sheet for batch actions
- Sheet-side validation and conditional formatting (highlight failures, stale rows)
- Eventually: scheduling rules engine that proposes tentative dates (Module I, deferred)

**Why in Sheets:** Sheet IS the dashboard. Rules running where the data lives = no API round-trips. Native Sheet integration (menus, onEdit triggers) makes this the right fit. Free, no deployment.

### Layer 3: Python service deployed to Railway (deferred to Module H)

What lives here in v0: nothing yet. v0 ships without Railway.

What it will eventually host (Module H+):

- Review UI for internal copy + thumbnail review accessible from anywhere
- Publer API integration: media upload via `/media/from-url`, scheduling via `/posts/schedule`, polling for publish confirmation
- YouTube Data API integration: upload as Unlisted, flip to Public at launch time
- Endpoint that the Sheet's Apps Script calls to commit a schedule batch to Publer

**Why Railway later:** it adds value once the Review UI needs to be accessible by non-editors (Loric, eventually the client) and once Publer integration replaces manual scheduling. Until then, localhost UIs on each editor's Mac are sufficient.

### Layer relationships (v0)

```
[Editor's Mac]                    [Google Sheets]
  Daemon (Tool 1, Tool 2)           Apps Script
    │                                 │
    ├─ File picker UI ─►              │
    ├─ Whisper, FAL, Claude            │
    ├─ Upload to Frame.io ◄────────────┤  (URLs stored in Sheet)
    ├─ Upload to Drive                 │
    ├─ Write asset rows ──────────────►│
    │                                  │
    │                            Status auto-transitions
    │                            on checkbox edits
```

### Layer relationships (full destination)

```
[Editor's Mac]               [Google Sheet]              [Railway]
  Daemon                       Apps Script                  Python service
    │                            │                            │
    ├─ Watch / picker UI ────►   │                            │
    ├─ Whisper, FAL, Claude       │                            │
    ├─ Upload Frame.io ◄──────────┼───────────────────────────►│
    ├─ Upload Drive                │                            │
    ├─ Write asset rows ──────────►│                            │
    │                              │                            │
    │                       Rules engine                         │
    │                       Status auto-transitions              │
    │                       Sheet menus                          │
    │                              │                            │
    │                              └─── HTTP call ──────────────►│
    │                                   "commit these releases"   │
    │                                                              │
    │                                                          Publer API
    │                                                          YouTube API
    │                                                          Polling jobs
    │                                                              │
    │                          Review UI ◄─── browser ─────────────│
```

---

## 2. Reliability and Preventive Measures

This pipeline talks to many external services (Whisper, Claude, FAL, Frame.io, Drive, Sheets, eventually Publer, YouTube). Each is a possible failure point. The risk is not that any individual integration fails catastrophically — it's that small failures accumulate, editors lose trust, and the system becomes "always slightly broken."

This section describes the engineering practices that should be baked into the build from day one to prevent the brittleness problem. They aren't "v2 enhancements" — they're how the build should be structured.

### 2.1 Idempotency

Every operation that could be retried must produce the same result whether run once or N times.

- Re-running Tool 1 on the same files must not duplicate Frame.io uploads or Sheet rows. Idempotency key: canonical asset_id. Before upload, check if asset_id already exists in Sheet; if yes, surface "already ingested" warning rather than create duplicate.
- Re-running Tool 2 on an asset must not duplicate transcripts, copy entries, or thumbnails. Generated artifacts overwrite previous versions in the per-asset Drive folder; sheet cells get updated, not appended.
- Sheet writes must use a "find row by asset_id, update" pattern — never "append next empty row" without a lookup.

### 2.2 Explicit failure states

Every asset has a `pipeline_status` that reflects its true state, including failure. There is no "unknown" or silent stuck state.

- On any module failure (Whisper timeout, Claude rate-limit, Frame.io upload failure, etc.), set `pipeline_status = failed_<step>` and populate `last_error` with a human-readable error message.
- The asset row is still written to the Sheet on failure (so the failure is visible). If the failure is too early to write a row (filename parse rejection), the failure surfaces in the Tool 1 UI itself.
- Conditional formatting in the Sheet highlights failed rows visually (red background or icon).
- A `last_error_at` timestamp is set so editors know how recent the failure is.

### 2.3 Retry with backoff on external API calls

Every call to an external service uses retry-with-exponential-backoff:

- Default policy: 3 retries, base delay 2 seconds, exponential (2s, 4s, 8s)
- After final failure, asset moves to `failed_<step>` status
- Some calls have specific policies (e.g., Whisper transcription on a 90-minute file shouldn't auto-retry the whole thing — it should resume from cache)

This applies to: Whisper API, Claude API, FAL API, Frame.io API, Google Drive API, Google Sheets API, eventually Publer API and YouTube API.

### 2.4 Confirmation-before-completion

A step is not marked "complete" until its result is verified.

- Frame.io upload: do NOT set `frameio_master_url` on the asset row until the file's existence at the URL is confirmed (HEAD request or API verification post-upload). Otherwise an asset can be marked "uploaded" with a URL that points nowhere.
- Sheet write: confirm the row was actually written (Sheets API returns success) before considering ingestion done locally.
- Drive upload: same — verify file exists at expected location before marking artifact created.

This prevents the "looks done but isn't" silent-failure category.

### 2.5 Concurrency-safe writes

Two assets processing simultaneously must not corrupt the Sheet.

- Use the Sheets API's batchUpdate for writes when possible (atomic at the cell range level)
- For multi-row writes, use the explicit row-by-asset_id lookup pattern; never "find next empty row" without a lock
- Apps Script onEdit triggers must guard against re-entry (check if a flag is set indicating a script is currently running before firing logic)

### 2.6 Local file lifecycle correctness

The "upload to Frame.io after Tool 1, local file disposable" pattern looks clean on paper but has subtle failure modes.

- Local file is NEVER deleted by the system. Editors decide when to delete; the tool only marks `local_status = deletable` once Frame.io upload is confirmed.
- If Frame.io upload fails partway, the asset remains in `failed_upload` state. Editor's local file is the only copy until upload retries succeed.
- A local copy may persist indefinitely if the editor chooses not to clean up. That's fine; cleanup is the editor's prerogative, not the tool's.

### 2.7 Observability — failures are visible, not buried

When something goes wrong, the editor or operator must be able to find out without grepping log files.

- Tool 1 UI surfaces per-file status during a batch (uploading / uploaded / failed-with-message)
- Tool 2 UI surfaces processing status per step (transcribing / generating copy / generating thumbnail / done / failed)
- Sheet conditional formatting highlights failed assets
- A persistent log file exists for deeper debugging (per-daemon log at `~/.fidelio/logs/`), but the Sheet + UI are the primary surfaces

### 2.8 Recovery affordances

Every failure mode has a documented recovery path.

- Whisper failure → editor can retrigger Tool 2 on the same asset (idempotency ensures no duplication)
- Frame.io upload failure → editor can retrigger upload from Tool 1; asset row already exists, just URL gets populated
- Claude generation failure → editor can re-request copy generation in Tool 2; previous copy is overwritten
- Sheet write failure → manual intervention required (rare, but the daemon logs the row data so editor can paste it)

The principle: failures should be fixable without database surgery. Editors should always have a "try again" button somewhere.

### 2.9 What this means for the build

Claude Code (or whoever implements) should treat these as ground rules, not optional polish:

- Every external API call gets retry-with-backoff
- Every state transition has an explicit success and failure path
- Every "complete" status is verified before being set
- Every operation is safe to retry
- Every failure is visible in the UI or Sheet

This adds a meaningful amount of implementation effort per module — but it saves the time you'd otherwise spend hunting "why did this asset get stuck" months from now. It is the difference between a system editors trust and one they don't.

---

## 3. Module Map and Build Sequence

The pipeline is composed of independent modules. Each module is a single responsibility. Modules combine into tools that editors interact with directly.

### Modules

| ID | Module | Tool | Phase |
|---|---|---|---|
| A | Filename parser / canonicalizer | Tool 1 | Now |
| B | Frame.io upload | Tool 1 | Now |
| C | Sheet writer | Tool 1 | Now |
| D | Whisper transcription | Tool 2 | Next |
| E | Copy generation per platform group | Tool 2 | Next |
| F | Thumbnail generation | Tool 2 | Next |
| G | Publer scheduling integration | Standalone | Later |
| H | Review UI deployed to Railway | Standalone | Later |
| I | Scheduling rules engine | Apps Script in Sheet | Later |
| J | Daemon orchestrator (auto-chain) | Standalone | Later |

### Tools

**Tool 1 — Ingestion** bundles Modules A + B + C.
- Editor drops files (or selects them via the UI), inputs session number and filming date once for the batch
- Tool parses filenames, shows pre-flight confirmation
- Canonical rename → Frame.io upload (with auto-create session folder) → Sheet row write per asset
- Editor's batch is fully ingested; client can now review videos in Frame.io

**Tool 2 — Copy & Thumbnail** bundles Modules D + E + F.
- Editor uploads a video (or sends from Tool 1's queue once the link is built)
- Tool transcribes via Whisper, caches transcript in per-asset Drive folder
- Editor clicks "Generate Copy" or "Generate Thumbnail" or both
- Copy generated per platform group (FB+IG; TT+Shorts; YT-long for long-form path)
- Thumbnail generated as 2 options (host + stock) using curated reference pool, with manual upload override always available
- Editor reviews, regenerates, picks, downloads outputs (image + text, or video with thumbnail baked into first frames)
- Editor uses outputs in Publer (manual upload until Module G ships)

Both tools run on the same local daemon (refining Rob's existing daemon scaffolding). Same install, same web UI on localhost, different pages.

### Build sequence

1. **Tool 1** (Modules A + B + C) ships first. Editor workflow becomes: edit → ingest → manual everything else.
2. **Tool 2** (Modules D + E + F) ships next. Editor workflow becomes: edit → ingest → process for copy/thumbnail → manual Publer scheduling.
3. **Module G** (Publer integration) replaces manual scheduling. Editor workflow becomes: edit → ingest → process → scheduled automatically.
4. **Module H** (Review UI on Railway) deploys the review UI. Becomes accessible by Loric and eventually client.
5. **Module I** (Scheduling rules engine) proposes dates. Editor workflow becomes: edit → ingest → process → review proposed dates → commit.
6. **Module J** (Daemon orchestrator) auto-chains tools. Editor workflow becomes: edit → drop in watch folder → walk away.

Each step delivers value standalone. Editor workflow improves at each step. We can pause at any phase.

---

## 4. File Storage Architecture

### Master video: Frame.io

- Tool 1 uploads finished exports to Frame.io as the master copy after upload step completes
- Storage capacity: 0.9TB free on current Pro plan = 18-30 months of headroom at projected volume
- Frame.io URL stored as `frameio_master_url` on each asset row
- Frame.io review URL (the Share Link) stored as `frameio_review_url`
- Local file on editor's Mac becomes disposable once `frameio_master_url` is confirmed populated

**Frame.io structure** (locked):

```
Fidelio's Account /                  ← single shared account
  DRE ALEX /                         ← one Project per client
    00 - LOGOS /                     ← editor working space, untouched
    01 - PODCASTS /                  ← editor working space
    02 - VLOGS /                     ← editor working space
    03 - YTF /                       ← long-form pipeline destination (deferred)
    04 - TT CAPSULES /               ← short-form pipeline destination
      TT27 — June 4, 2026 /          ← session folder, auto-created by Tool 1
        TT-27.1-capsulite-hook-v3.mp4
        TT-27.2-final-tt-hook.mp4
      TT28 — June 18, 2026 /
        ...
```

Session folder format: `{prefix}{session} — {Month Day, Year}` (e.g., `TT27 — June 4, 2026`). Tool 1 auto-creates these when a batch is ingested for a new session.

### Non-video assets: Google Drive

Drive holds everything that isn't a master video file:

- The master Google Sheet itself
- Client config files: `Clients/<client-id>/config.json`, `brand-profile.md`, `client-readme.md`
- Copy templates: `Clients/<client-id>/copy-templates/{fb-ig,tt-shorts,yt-longform}.md`
- Hashtag pools: stored in Sheet (Hashtag Pools tab) for v0; could move to Drive JSON files later
- Thumbnail reference pools: `Clients/<client-id>/thumbnails/{short-form,long-form}/{host,stock}/`
- Per-asset folders for non-video artifacts: transcript, generated thumbnail history, metadata JSON
- Drive folder URL stored as `drive_folder_url` on each asset row

### Why this split

Frame.io is built for video review (frame-accurate comments, version stacks, mobile playback). Drive is generic file storage. Each tool used for what it's good at.

### Daemon-side caching

- On daemon startup: smart sync of client config from Drive to local cache (`~/.fidelio/cache/clients/<client-id>/`). Smart = check Drive metadata via API, only download files whose modifiedTime changed.
- No periodic polling. Rules don't change often.
- Manual refresh button in UI forces immediate re-sync.
- On config-related error (missing thumbnail reference, missing template), daemon does refresh-and-retry before failing.

### Raw footage

Stays on editor Macs / external drives. Never uploaded by this pipeline. Pass 1 (Rob's raw ingest pattern, separate from this scope) processes raw locally for Resolve markers/timeline.

### File lifecycle for finished exports

1. Editor exports with rough filename (e.g., `Capsulite Hook v3.mp4`)
2. Editor opens Tool 1, selects files (folder or multi-select)
3. Tool 1 parses filenames, asks for session/date once for batch
4. Pre-flight confirmation shows canonical renames
5. Editor confirms; Tool 1 renames, finds-or-creates Frame.io session folder, uploads with progress feedback
6. Tool 1 confirms upload (HEAD check), writes asset rows to Sheet, marks `local_status = deletable`
7. **Local file is now disposable.** Editor can delete or move.
8. Tool 2 (when run later) processes the asset, reading from Frame.io URL not local disk
9. All downstream operations (review, scheduling, reposts) read from Frame.io URL

---

## 5. Pipeline Phases

### Phase 1: Ingest (Tool 1, automated after editor confirmation)

Trigger: editor opens Tool 1, selects files, confirms pre-flight.

Steps:
1. For each file, parse filename → extract content_prefix, session, order, slug (if possible)
2. Pre-flight UI shows what each file will be renamed to; editor confirms or edits inline
3. ffprobe → detect format (vertical = short-form, horizontal = long-form)
4. For v0, only short-form proceeds; long-form gets a "not supported in v0" warning and is skipped
5. Idempotency check: does this asset_id already exist in Sheet? If yes, surface "already ingested" warning; require explicit re-confirmation if editor wants to overwrite
6. Canonicalize filename
7. Find or create Frame.io session folder (auto-create with retry-on-failure)
8. Upload file to Frame.io with progress feedback (retry-with-backoff on failure)
9. Confirm `frameio_master_url` is valid (HEAD check) before marking complete
10. Write asset row to Sheet with `pipeline_status = pending_client_review` (find-by-asset_id-or-create pattern)
11. Mark `local_status = deletable`

Failure modes: any step that fails sets `pipeline_status = failed_<step>` and populates `last_error`. Asset row still gets written so failure is visible, except for filename-parse rejection which surfaces in Tool 1 UI before any sheet write.

### Phase 2: Process for Copy + Thumbnail (Tool 2)

Trigger: editor opens Tool 2, picks an asset (uploaded directly OR from a queue once Tool 1 → Tool 2 link exists).

Steps:
1. Whisper transcribes the video. Transcript stored in per-asset Drive folder.
2. If transcript already cached, skip Whisper (idempotency).
3. Editor sees three actions: Generate Copy, Generate Thumbnail, or download transcript only.
4. **Copy generation:** Claude produces per-platform-group copy from transcript + brand profile + copy templates from client config. Output: TT+Shorts hook, FB+IG caption, (long-form: 3 title options + description + timestamps + thumbnail copy + tags).
5. **Thumbnail generation:** FAL produces 2 options (1 host, 1 stock) using curated references from client config.
6. Editor reviews in Tool 2 UI. Can regenerate either, edit copy inline, request thumbnail revision via prompt.
7. Editor picks final outputs.
8. Download options: thumbnail as PNG/JPG, copy as text, or video file with thumbnail baked into first frames (cover stitch).
9. Optionally: "Send to Tool 1" link if Tool 1 hasn't been run yet (build later).

### Phase 3: Review (gated by humans)

#### Phase 3a: Internal copy + thumbnail review (deferred to Module H)

Where: the future Review UI on Railway.

For v0, internal copy review happens in Tool 2 by the same person generating it (Loric or the editor). Once the deployed Review UI ships, this becomes a queue accessible from anywhere.

#### Phase 3b: Client review

Where: Frame.io for video playback, Sheet checkbox for approval action.

For long-form there are TWO client review gates:

**Client review #1 — Rough cut video only.** Editor uploads rough cut to Frame.io. Asset reaches `pipeline_status = pending_client_rough_cut`. Sheet shows asset in client's view. Client clicks `frameio_review_url`, watches in Frame.io, ticks `client_rough_cut_approved` checkbox. Apps Script auto-transitions to `pending_finalization`. Editor finalizes (intro, outro, AE, color, polish).

**Client review #2 — Final package.** Editor uploads final to Frame.io. Tool 2 generates copy/thumbnail. Asset reaches `pipeline_status = pending_client_final`. Sheet shows asset with all final elements visible. Client reviews everything together, ticks `client_final_approved` checkbox. Apps Script auto-transitions to `approved_unscheduled`.

For short-form there is ONE client review gate, on the final video. A per-asset toggle `client_review_required: true/false` defaults to `true`; can flip to `false` once trust builds.

### Phase 4: Schedule (Modules G + I, deferred)

Two sub-phases.

#### Phase 4a: Build Schedule (planning, Module I)

Trigger: Loric clicks Sheet menu "Tools → Build Schedule for Next 30 Days" or runs a CLI command.

Apps Script reads approved unscheduled assets, scheduling rules from the Scheduling Rules tab, existing Releases rows, and asset's `publish_to_*` checkboxes. Writes new Releases rows with `tentative_date` populated and `status = tentative`. Loric reviews tentative schedule visually, adjusts dates manually if needed.

#### Phase 4b: Commit (execution, Module G)

Trigger: Loric clicks "Commit Schedule for Asset X" button or batch commit menu item.

Apps Script identifies tentative Releases rows for the asset, calls Railway service endpoint with release_ids. Railway service:
1. For first release of an asset: Publer `POST /media/from-url` with the Frame.io URL → returns `publer_media_id`. Cached for reuse on reposts.
2. For each release: Publer `POST /posts/schedule` with media_id, scheduled_at, platform-specific copy
3. Writes back: `publer_post_id`, `publer_media_id`, `status = scheduled`

For long-form going to YouTube: service uploads to YouTube as Unlisted at commit time. Stores `youtube_video_id`. At scheduled launch time, service flips privacy from Unlisted to Public via `videos.update`. Same video, same URL, no re-upload.

#### Phase 4c: Polling for publish confirmation

Railway service runs hourly cron: for each Releases row where `status = scheduled`, calls Publer to check post status. When Publer reports `published`, updates `status = published`, `published_at`, `published_url`. For YouTube long-form: polls YouTube for privacy status confirmation.

---

## 6. Data Model — The Master Sheet

One Google Sheet, multiple tabs. The Sheet is the dashboard everyone uses.

### Tab list

**Data tabs:**
1. Sessions
2. Assets (master Asset Library — all data lives here)
3. Releases (one row per scheduled publish event; populated when Module G ships)
4. Reviews (audit log; populated when review tracking matures)

**Config tabs:**
5. Scheduling Rules (rule definitions, editable; populated when Module I ships)
6. Hashtag Pools (per-platform curated hashtag lists)
7. Client Settings (read-only mirror of pipeline config)

**Long-form sheet:** separate Sheet for long-form (deferred). v0 only handles short-form.

### Filter Views

Most slicing of the Asset Library happens via saved Filter Views, which are per-user (don't disturb others) and editable.

Filter Views to ship at v0:

- **Editor Default** — current sessions only (last 90 days), exclude Cancelled and Published older than 14 days
- **Pending Client Review** — `status = pending_client_review`
- **TT MSK** — filter by platform = TikTok MSK
- **TT OG** — filter by platform = TikTok Main
- **FB/IG** — filter by platform = FB or IG
- **YT Shorts** — filter by platform = YouTube Shorts
- **Release Order Group A** — ready to schedule + published last 14 days, sorted by Group A publish date
- **Release Order Group B** — same logic for Group B (Old TT)
- **Client View** — pending their approval + recently approved by them

A "Quick Views" hyperlink section at the top of the Asset Library tab provides one-click access to each saved Filter View.

### Tab 2: Assets (the schema)

One row per produced video.

**Hidden columns** (tools use them, editors don't see in default view):

- `asset_id` (e.g., `TT-27.1`, `YTF-3.1`, `POD-16.2` — no client prefix; one client, one Sheet)
- `filming_date` (date type, used for auto-rolling filter views)
- `pipeline_status` (state machine — see status values below)
- `last_error` (text, populated when status = `failed_*`)
- `last_error_at` (timestamp)
- `frameio_master_url` (clickable from Frame.io URL column, but stored hidden as canonical)
- `drive_folder_url` (per-asset Drive folder)
- `local_status` (`present` / `deletable` / `deleted` — workflow signal for editors)
- `ingested_at`, `processed_at` (timestamps)

**Visible columns** (editor's daily view):

- Title — text, editor-friendly
- Frame.io URL — clickable link (mirrors `frameio_review_url` for click-throughs)
- Status — `pending_client_review` / `approved` / `scheduled` / `published` / `cancelled` / `needs_revision` / `failed`
- Alex Checked — client's approval checkbox (named for first client, generalizes per-client)
- Client Review Notes — client's comments if they request changes
- TT Comment — TikTok caption
- Group A Publish Date — TT new, FB, IG, YT Shorts publish date
- Group B Publish Date — TikTok Old/Main publish date
- Notes — freeform editorial notes

For v0, that's roughly 9 visible + several hidden columns. Schema can grow as Module G, H, I ship.

#### Pipeline_status state machine

```
ingested
  ↓
transcribing → generating_metadata → generating_thumbnail
  ↓
pending_internal_copy_review (Module H ships this gate; v0 skips it)
  ↓
[short-form: pending_client_final OR direct to approved_unscheduled if review_required = false]
[long-form: pending_client_rough_cut → pending_finalization → pending_client_final]
  ↓
approved_unscheduled
  ↓ (Build Schedule writes tentative releases — Module I)
approved_with_tentative_schedule
  ↓ (Commit fires — Module G)
fully_scheduled
  ↓ (all releases reach published)
fully_published
```

Failure paths: any step can transition to `failed_<step>` (e.g., `failed_upload`, `failed_transcription`, `failed_copy_gen`, `failed_thumbnail`). Recovery: editor retriggers the failed step from the appropriate tool's UI.

### Tab 1: Sessions

One row per filming session.

| Column | Type | Notes |
|---|---|---|
| session_id | text | e.g., `S27`, `TT38`, `POD14`, `F2` |
| session_type | enum | fondation / capsule / podcast / vlog |
| filming_date | date | |
| expected_assets | int | e.g., 3 for Fondations, ~10 for capsules |
| status | enum | upcoming / filmed / in_post / complete |
| notes | text | Freeform |

### Tab 3: Releases (populated when Module G ships)

One row per scheduled publication event. Many rows per asset.

| Column | Type | Notes |
|---|---|---|
| release_id | UUID | |
| asset_id | text | FK to Assets |
| platform | enum | tiktok_main / tiktok_msk / instagram / facebook / youtube_shorts / youtube_long |
| cycle | int | 1 (first publish), 2 (first repost), 3 (second repost) |
| tentative_date | datetime | Set during Build Schedule (Module I) |
| scheduled_date | datetime | Set during Commit (Module G) |
| status | enum | tentative / scheduled / queued_at_publer / published / failed / cancelled |
| publer_post_id | text | Returned by Publer at schedule time |
| publer_media_id | text | Cached for reuse on reposts |
| youtube_video_id | text | Only for `youtube_long` platform |
| published_url | text | Final URL once live |
| published_at | datetime | Timestamp confirmed live |
| last_polled_at | datetime | For polling job |
| failure_reason | text | If status = failed |

### Tab 4: Reviews

One row per review event. Audit log for compliance / debugging.

| Column | Type | Notes |
|---|---|---|
| review_id | UUID | |
| asset_id | text | FK |
| review_target | enum | asset / copy / thumbnail / full_package |
| review_type | enum | internal_copy / client_rough_cut / client_final |
| reviewer | text | who did the review |
| status | enum | pending / approved / changes_requested |
| comments | text | Freeform |
| created_at | datetime | |
| resolved_at | datetime | |

### Tab 5: Scheduling Rules (Module I)

Editable. Apps Script reads from here when proposing tentative schedules.

Suggested structure (rows = rule definitions): rule_type, content_type, platform, day_of_week, time_of_day, repost_offset_days, notes.

Format details to be finalized when Module I is built.

### Tab 6: Hashtag Pools

One section per platform. Curated by humans.

| platform | hashtag | added_at | added_by | notes |
|---|---|---|---|---|

Pipeline reads relevant pool when generating copy, picks 8-12 hashtags from pool based on video topic.

### Tab 7: Client Settings

Read-only mirror of `Clients/<client-id>/config.json` for human inspection. Source of truth stays in Drive JSON.

---

## 7. Filename Convention and Parsing

### Editor export naming (loose, human-friendly)

Examples:
- `Capsulite Hook v3.mp4`
- `Final TT Hook.mp4`
- `PRP_Intro.mp4`
- `27.3 PRP intro.mp4`

Editors don't need to follow strict naming. Tool 1 handles it.

### Canonical form (after Tool 1 rename)

`{PREFIX}-{session}.{order}-{slug}.{ext}`

Examples:
- `TT-27.1-capsulite-hook-v3.mp4`
- `TT-27.2-final-tt-hook.mp4`
- `YTF-3.1-arthrose-101.mp4` (long-form, future)
- `POD-16.2-endometriose.mp4` (future)

### Parser behavior

Regex pattern in client config (so different clients can use different conventions):

```
^(?P<prefix>YTF|TT|POD|YTS|VLOG)?\s*(?P<session>\d+)\.?(?P<order>\d+)?\s*[-_]\s*(?P<slug>.+)\.(mp4|mov)$
```

Logic:
- If filename matches → tool extracts what it can, shows pre-flight with extracted fields editable
- If filename doesn't match → tool prompts for missing fields inline in pre-flight
- Editor inputs session number + filming date once for the whole batch
- Slug gets sanitized: lowercase, dashes, no spaces

The slug is just a filesystem identifier. The actual asset title comes from full Whisper transcript + Claude generation when Tool 2 runs.

---

## 8. Multi-Client Configuration

The architecture is built to onboard additional clients with config-only changes. The first client (Dre) populates the system at v0 launch. Future clients = new config folder, no code changes.

### What's truly client-specific (lives in config)

- Frame.io project ID (each client has their own Project)
- Frame.io content-type folder names (Dre uses `04 - TT CAPSULES`; another client might use different folders)
- Asset library Sheet ID (one Sheet per client)
- Brand profile (voice, tone, copy templates as markdown)
- Thumbnail reference pool (curated images per client)
- Hashtag pools (per platform per client)
- Content prefix mappings (Dre uses TT, YTF, POD, VLOG; another client uses different prefixes)
- Platform routing defaults (which platforms each content type goes to)
- Filename pattern regex (how the parser interprets each client's naming)

### What's client-agnostic (same code for every client)

- Filename parsing logic (driven by per-client regex from config)
- Frame.io API integration (same code, different project IDs)
- Sheets API integration (same code, different sheet IDs)
- Whisper transcription
- Claude prompt scaffolding (templates parameterized, brand profile injected per call)
- FAL thumbnail generation
- Pre-flight UI flow
- Tool 1 / Tool 2 daemon and web UI shell

### Directory structure (in Drive)

```
Google Drive / Fidelio /
├── Clients /
│   ├── dre-alexandra /
│   │   ├── config.json
│   │   ├── brand-profile.md
│   │   ├── client-readme.md
│   │   ├── copy-templates /
│   │   │   ├── fb-ig.md
│   │   │   ├── tt-shorts.md
│   │   │   └── yt-longform.md
│   │   └── thumbnails /
│   │       ├── short-form /
│   │       │   ├── host /         (5-10 reference images)
│   │       │   └── stock /
│   │       └── long-form /
│   │           ├── host /
│   │           └── stock /
│   └── (future-client) /
└── (other Fidelio shared resources)
```

### config.json schema (sketch)

```json
{
  "client_id": "dre-alexandra",
  "display_name": "Dre Alexandra Champagne",
  "filename_pattern": "...",
  "content_prefixes": {
    "YTF": "long_form",
    "TT": "short_form",
    "POD": "long_form",
    "YTS": "short_form",
    "VLOG": "long_form"
  },
  "platforms": {
    "tiktok_main": { "publer_account_id": "...", "default_for_short": true },
    "tiktok_msk": { "publer_account_id": "...", "default_for_short": false, "tag_required": "msk" },
    "instagram": { "publer_account_id": "...", "default_for_short": true },
    "facebook": { "publer_account_id": "...", "default_for_short": true },
    "youtube_shorts": { "publer_account_id": "...", "default_for_short": true },
    "youtube_long": { "youtube_channel_id": "...", "default_for_long": true }
  },
  "frameio": {
    "workspace_id": "...",
    "project_id": "...",
    "content_folders": {
      "TT": "04 - TT CAPSULES",
      "YTF": "03 - YTF",
      "POD": "01 - PODCASTS",
      "VLOG": "02 - VLOGS"
    },
    "session_folder_pattern": "{prefix}{session} — {Month Day, Year}"
  },
  "drive": {
    "client_root_folder_id": "...",
    "asset_folder_pattern": "..."
  },
  "sheet": {
    "spreadsheet_id": "..."
  },
  "thumbnails": {
    "references_per_generation": 3
  }
}
```

### Onboarding a new client

1. Create their Frame.io Project (manually in Frame.io UI)
2. Duplicate the master Sheet template for their content
3. Create `Clients/<new-client>/` folder in Drive
4. Fill in `config.json`, `brand-profile.md`, copy templates, thumbnail references
5. Tools detect client from filename (or accept a `--client` argument), load config, proceed

No code changes. The first build runs with Dre's config; the second client gets their own config; same code, different inputs.

The principle: any time we're about to hardcode "DRE", "Dre Alexandra", "TT CAPSULES", "tt-shorts", or any value tied to the first client, that value goes into `config.json` instead.

---

## 9. Component-by-Component Build Plan

What to keep from Rob's existing pipeline, what to rewrite, what's new.

### Keep as-is

- File watching daemon architecture (watcher.py with FSEvents)
- ffprobe format detection
- Whisper transcription with caching and chunking
- FAL thumbnail API call mechanics
- Resolve integration (for raw footage Pass 1, separate from this scope)
- Two-pass concept (raw ingest vs export processing)
- Monitor UI pattern (SSE progress cards)
- Local Flask + web UI on localhost pattern

### Rewrite

- **Sheets connector** — change destination from Rob's separate pipeline sheet to the new unified Asset Library schema. Same code structure, new cell mappings. Add idempotency checks (find-by-asset_id-or-create) and concurrency safety.
- **Copy generation** — fork the single-output prompt into per-platform-group prompts (FB+IG, TT+Shorts, YT-long). Read brand profile from client config, not from HTML scrape.
- **Thumbnail prompt construction** — replace inline conditionals with config-driven reference selection. Manual upload endpoint as fallback.
- **Approve flow** — sever the disk-read dependency. Read master from Frame.io URL (not local watch folder) for cover stitching.
- **Scheduler integration** — when Module G ships, replace Blotato code with Publer (`/media/from-url` upload, `/posts/schedule` per platform per cycle, media_id caching for reposts).

### New components

- **Tool 1 (Modules A + B + C)** — file picker UI, filename parser, pre-flight confirmation, Frame.io upload with auto-create folders + retry-with-backoff, Sheet writer with idempotency.
- **Frame.io integration** — OAuth via Adobe Developer Console, upload masters via V4 API, fetch share link URLs.
- **Per-asset Drive folder management** — create folder on first asset operation, write transcripts and thumbnails there.
- **Client config layer** — Drive folder per client, daemon caches locally on startup, manual refresh button in UI.
- **Tool 2 (Modules D + E + F) refinements** — same daemon, new pages in localhost UI for the copy/thumbnail flow with editor review.
- **Reliability scaffolding** — retry-with-backoff helper, idempotency helper, status-with-error helper, observability surfaces. Build these once as shared utilities, reuse across modules.

### Future components (deferred phases)

- **Module G (Publer integration)** — replaces Blotato in approve flow.
- **Module H (Review UI on Railway)** — deploys current localhost Review UI publicly.
- **YouTube Data API integration** — for long-form: upload as Unlisted, flip Public via `videos.update`.
- **Apps Script: rules engine** — Module I.
- **Apps Script: status auto-transitions** — onEdit triggers on approval checkboxes.
- **Module J (Daemon orchestrator)** — auto-chains Tool 1 → Tool 2 on new file detection.

### Discard

- Blotato code and connector (replaced by Publer eventually)
- HTML scrape of brand.mokshatools.com (replaced by `brand-profile.md` in client config)
- Hardcoded `_client_enrichments` and `_HOOK_REPLACEMENTS` Python dicts (moved to client config)
- Rob's separate pipeline Sheet (replaced by unified Sheet)

---

## 10. Open Decisions (TBD)

These are explicitly not yet resolved. None block starting the build — they get decided as we go.

### TBD-1: Scheduling Rules format

When Module I ships:
- **Sheet tab** with structured columns — pros: editable in Sheet, consistent with everything else; cons: limited expressiveness for nested rules
- **YAML in Drive client folder** — pros: more expressive, version-controllable; cons: extra Drive API call, not editable in Sheet

Default: Sheet tab. Migrate to YAML if rules grow complex.

### TBD-2: Hashtag pool storage

Same trade-off:
- Sheet tab (Hashtag Pools)
- JSON files in Drive

Default: Sheet tab. Easier for non-technical curators.

### TBD-3: Repost trigger model

Locked: Option A (schedule all cycles upfront when committing).

Sub-question for Module G: are Releases rows for cycle 2 and 3 created at commit time (all 3 cycles together) or at first-publish-confirmed time?

Default: at commit time. Simplest, most predictable.

### TBD-4: Editor onboarding doc / setup script

Lubo and Graeme need to set up daemons on their machines. Need a runbook covering: install Python, ffmpeg, Frame.io creds, Drive API creds, Sheets API creds, point at the right client config, start the daemon, troubleshooting.

This is operational documentation, not pipeline code.

### TBD-5: Pilot scope

Recommended: hard cutover for one new session with Loric as safety net. Editors run Tool 1 only on the next TT capsule session. Loric provides oversight to catch issues. After it works cleanly, extend to all sessions.

Confirm pilot strategy before launching to editors.

### TBD-6: Notifications

V0/V1: Sheet @-tag mentions for client review.
V2: real email/Slack notifications.

### TBD-7: Backfill of historical assets

Out of scope for v1 build. Old TT CONTENT becomes read-only archive. Future migration can populate the new schema with historical data.

### TBD-8: Performance metrics tracking

Out of scope for v1. Releases tab schema includes view-count fields but they're not populated.

### TBD-9: Long-form support

Deferred from v0. Long-form copy goes directly into YouTube Studio manually for now. When automation justifies it, add long-form sheet + Tool 2 long-form code paths.

### TBD-10: Hashtag pool curation

Deferred. For v0, copy generation produces copy without specific hashtags; editors add hashtags manually from a list they maintain. Curation methodology TBD.

---

## 11. Validation and Acceptance Criteria

Before declaring v1 (Tool 1 + Tool 2) complete, the system should:

1. **End-to-end short-form ingest test (Tool 1):** Editor selects a session of files in Tool 1 → fills session number + date → confirms pre-flight → files upload to Frame.io with canonical names in the right session folder → asset rows appear in Sheet → client can review videos in Frame.io and tick approval checkbox.

2. **End-to-end short-form processing test (Tool 2):** Editor opens Tool 2 on an ingested asset → Whisper transcribes → editor generates copy and thumbnail → editor downloads outputs → uses outputs in Publer manually.

3. **Failure handling:** Force a Whisper failure or Frame.io upload failure → asset goes to `failed_<step>` state visibly → editor sees the failure in UI/Sheet → editor can retrigger and retry.

4. **Idempotency check:** Re-run Tool 1 on the same files → no duplicate Sheet rows, no duplicate Frame.io uploads (warning surfaced instead). Re-run Tool 2 on the same asset → previous outputs overwritten in place, not duplicated.

5. **Concurrency check:** Run Tool 2 on two assets simultaneously → both complete cleanly, no Sheet corruption or row collisions.

6. **Multi-client smoke test:** Add a stub second client config (`Clients/test-client/`) with its own JSON. Tools route to correct config based on `--client` flag or filename. Verify no Dre-specific data leaks across clients.

7. **Editor setup:** Lubo and Graeme can both ingest and process assets through the new flow without Rob's hand-holding after initial setup.

---

## 12. Glossary

- **Asset:** One produced video. Identified by canonical asset_id.
- **Session:** A filming session that produces multiple assets.
- **Cycle:** Which time the asset is being published. Cycle 1 = first publish, Cycle 2 = first repost, Cycle 3 = second repost.
- **Release:** One scheduled publication event. One asset has multiple releases across platforms × cycles.
- **Platform group:** A bundling of platforms that share copy. FB+IG, TT+Shorts, YT-long.
- **Master:** The canonical video file used for distribution. Lives in Frame.io after Tool 1 runs.
- **Local file:** Editor's copy on their Mac. Disposable after Tool 1 confirms upload.
- **Tool 1:** Ingestion (Modules A + B + C). Editor-facing, runs on local daemon.
- **Tool 2:** Copy + Thumbnail (Modules D + E + F). Editor-facing, runs on local daemon.

---

## 13. Document History

This spec consolidates decisions made across an extended planning conversation. Items marked TBD are explicitly open for decision during build. Items not marked TBD are locked.

The reliability section (§2) is the most important addition relative to the original spec. It describes engineering practices that should be baked into every module from day one, not retrofitted later. Implementing modules without these practices in place means they will work most of the time and fail silently the rest, which is the worst possible failure mode for editor adoption.

End of spec.
