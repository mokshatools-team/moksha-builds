# CONTEXT — FDL2 Retroactive Archive Import

## Status as of April 6, 2026

**Architecture session complete. Build session not yet started.**
**Waiting on:** Facebook JSON, TikTok JSON before starting Claude Code build session.

---

## What FDL2 Is

One-time import module that back-populates the Asset Library with all content Dre Alexandra published before FDL1 existed. After FDL2 runs, a lightweight YouTube sync layer stays alive to catch anything posted outside the main pipeline (handhelds, reply videos — roughly 2/week).

FDL2 is not a blocker for FDL1. FDL1 runs for new content immediately. FDL2 closes the historical gap.

---

## The Actual Data Model

This is critical to understand before building anything.

```
Master Inventory (Asset Library)
= everything ever filmed, including never-published content
         ↓ (most content)
       TikTok ← primary publishing platform
         ↓ (subset A)              ↓ (subset B — different selection)
   Instagram + Facebook          YouTube Shorts
   (same content cross-posted,   (different videos, different order
    captions may differ)          than TikTok)
```

Key facts:
- The Asset Library is the source of truth — it includes content never published anywhere
- TikTok is the primary platform — most published content lives there
- Instagram and Facebook receive a subset of TikTok content, cross-posted together
- YouTube Shorts receives a DIFFERENT subset — not the same selection as IG/FB
- No platform follows the same publishing order as any other
- Multiple videos exist on the same topic (e.g. arthrose covered several times across months) — title matching alone will create false positives

---

## Current Master Tracker (To Be Replaced)

The existing tracker Dre's team has been using lives here:
https://docs.google.com/spreadsheets/d/1aOSpYwzExdKRr-85PVISpLPGqWxOnP8qioxSsib9Tlw/edit?gid=0#gid=0

⚠️ Read the first tab before building. The old tracker shows what data already exists and how it was previously organized — use it to understand the asset inventory and avoid re-creating what's already tracked.

⚠️ FDL1 is deprecated. Do NOT use `Content-Pipeline-Architecture-FDL1.md` for the schema. Get the current Asset Library schema directly from Rob before building anything.

---

## Input Files — Collection Status

| File | Format | Source | Status |
|------|--------|--------|--------|
| YouTube video metadata | CSV (zipped) | Google Takeout — video metadata only | ✅ In hand |
| YouTube analytics — Videos | CSV | YouTube Studio Advanced Mode, Lifetime | ✅ In hand |
| YouTube analytics — Shorts | CSV | YouTube Studio Advanced Mode, Lifetime | ✅ In hand |
| Instagram posts + reels | JSON | Meta Accounts Center export | ✅ In hand |
| Facebook posts + reels | JSON | Meta Accounts Center export | ⏳ Pending — notification to doctoralex.production@gmail.com |
| TikTok posts | JSON | TikTok data download | ⏳ Pending |

### What each file contains

**Google Takeout — video metadata**
- Title, publish date, video ID, visibility status (Public / Unlisted / Private)
- This is the authoritative source for YouTube visibility
- Covers ALL uploads including unlisted review copies and raw cuts
- Analytics does NOT reliably indicate visibility — unlisted videos with any views appear there too

**YouTube Analytics CSVs (Videos + Shorts)**
- Title, publish date, views, watch time, subscribers gained, duration
- Performance enrichment data — not the content inventory
- Use duration as a matching signal across platforms

**Instagram JSON**
- Scoped to: Posts and Reels only
- Contains: captions (full text), timestamps, media type, permalink URLs

**Facebook JSON**
- Scoped to: Posts and Reels only
- Contains: full caption text, timestamps, post type, links

**TikTok JSON**
- Scoped to: Posts only
- Contains: titles, post dates, captions
- Note: TikTok is the primary platform — this file is the most important for cross-platform matching

---

## YouTube Shorts — Historical Complexity

Three phases of how Shorts were handled. Understanding this is required before building the deduplication logic.

**Phase 1 — early ~20 sessions**
- Unlisted review copy uploaded to YouTube for client (Dre) to approve before captions added
- After approval → posted to TikTok with captions
- YouTube Short = downloaded from TikTok, re-uploaded (degraded quality)
- Result: two YouTube entries per piece of content — unlisted review copy + public Short (TikTok download)

**Phase 2 — middle period**
- Editors stopped uploading review copies to YouTube
- Still downloading from TikTok for Shorts
- Result: only the public TikTok-download Short, no review copy on YouTube

**Phase 3 — recent**
- Realized TikTok download quality was degraded
- Decided review upload and TikTok version were equivalent
- Stopped downloading from TikTok
- Flipped existing unlisted review videos to Public directly
- Result: the review video IS the YouTube Short — single entry, no duplicate

---

## Content Type Inference Rules

| Signal | Content type | Tab |
|--------|-------------|-----|
| `Épisode N —` or `[PODN` in title | POD | Long Form |
| Duration < 3 min + Shorts tab | YTS | Short Form |
| Duration > 20 min + Videos tab | YTF | Long Form |
| `VLOG` in title | VLOG | Long Form |
| `raw cut` in title | SKIP | internal |
| `[POD N DEMO]` in title | SKIP | unlisted staging copy |
| Session codes like `25.4 - TRT`, `9 4 AVC`, `11 8 INFARTUS` | SKIP | internal review files |
| `INTRO DE`, `HISTOIRE DE` | SKIP | internal |

Flag any row where content type cannot be confidently inferred. Do not guess.

---

## The Matching Problem

This is the hardest part of FDL2. Same asset appears across platforms with:
- Similar but not identical titles (captions rewritten per platform)
- Different publish dates per platform (no consistent cross-platform order)
- Multiple distinct videos on the same topic (e.g. arthrose covered several times)

**Title matching alone will create false positives.** Need multi-signal fingerprinting.

### Matching Signals (in order of reliability)

1. **Duration + date proximity** — same duration ± 5 seconds + published within 7 days across platforms = high confidence same asset
2. **Caption/title fuzzy match** — use as secondary signal, not primary
3. **Session ID** — if inferrable from title numbering, use as anchor
4. **Topic cluster** — group by topic first, then match within cluster

### Matching Pass Strategy

Run multiple passes, not one sweep:

**Pass 1 — High confidence**
Duration match + date proximity + title similarity > 80% → auto-match, write to Asset Library

**Pass 2 — Medium confidence**
Title similarity > 80% but date or duration mismatch → flag for manual review, do not auto-match

**Pass 3 — Low confidence / unmatched**
No clear match found → write as platform-only record, flag as `needs_cross_platform_match`

**Pass 4 — Manual review**
Human reviews flagged rows from Pass 2 and 3 and confirms or corrects matches

Do not attempt to resolve ambiguous matches in code. Output the ambiguity clearly for human review.

---

## Filtering Rules — What Goes Into Asset Library

**Include:**
- Public videos and Shorts
- Scheduled videos (treat as published with scheduled date)

**Exclude:**
- Raw cuts (unlisted, title patterns above)
- Unlisted staging/demo copies (`[POD N DEMO]`)
- Private videos
- Internal session review files (numeric title codes)

**Flag for manual review:**
- Unlisted entries that do NOT match a known internal pattern — could be unpublished content
- Phase 1 duplicate pairs (unlisted review + public Short with same title)
- Any row where content type could not be inferred
- Any cross-platform match below high confidence threshold

---

## Output

1. **Asset Library rows** — written to correct Sheet tab (Short Form / Long Form), one row per asset, `pipeline_status: archive`, `backlog: true`
2. **Manual review CSV** — all flagged rows with flag reason and confidence score
3. **Completion report** — total assets imported per platform, total matched cross-platform, total flagged, total skipped

---

## Sync Layer (Post-Backfill)

After the one-time backfill, a lightweight YouTube sync stays alive:
- Runs weekly via cron
- Uses YouTube Data API — `playlistItems.list` on uploads playlist
- Catches anything posted outside FDL1 (handhelds ~2/week, rare reply videos)
- Writes new rows with `pipeline_status: organic`
- Meta and TikTok: manual spot-check only — not worth API maintenance cost per client

---

## What Is Fully Scoped

- Data model and platform relationships
- All four export file formats and what they contain
- YouTube Shorts three-phase history and deduplication approach
- Content type inference rules
- Multi-pass matching strategy
- Filtering rules
- Output format
- Post-backfill sync architecture

## What Still Needs To Be Scoped Before Building

- **Asset Library column schema** — pull from `Content-Pipeline-Architecture-FDL1.md` and add here
- **Old tracker column mapping** — read first tab of old tracker (link above) to understand existing inventory and carry it forward correctly into new schema
- **TikTok JSON structure** — once file arrives, inspect actual field names before writing parser
- **Facebook JSON structure** — same, inspect before writing parser
- **Google Sheets write method** — confirm service account credentials and sheet ID for Dre Alexandra's Asset Library workbook

---

## Build Priority Order (Claude Code Session)

1. Inspect all input files — log actual field names per file before writing any parser
2. Read old tracker first tab — understand existing asset inventory
3. Build Google Takeout parser — YouTube metadata with visibility flags
4. Build Shorts deduplication logic — Phase 1/2/3 detection + flagging
5. Build Instagram JSON parser
6. Build Facebook JSON parser
7. Build TikTok JSON parser
8. Build multi-pass cross-platform matcher
9. Build Sheet writer — normalized rows to correct tabs
10. Build manual review CSV exporter
11. Build completion report
12. YouTube sync cron — separate script, post-backfill

---

## ⚠️ Critical — FDL1 Is Deprecated

The original FDL1 architecture doc (`Content-Pipeline-Architecture-FDL1.md`) is **no longer accurate**. Rob rebuilt the entire pipeline from scratch. FDL1 docs are archive only — do not use them as reference for schema, column names, or pipeline logic.

**Before building anything:**
1. Get the current Asset Library Google Sheet header row from Rob
2. Confirm tab names (Short Form / Long Form may have changed)
3. Confirm what a live FDL1-generated row looks like so FDL2 rows are compatible

FDL2 rows must be consumable by Rob's pipeline. Schema mismatch = broken sequencer.

---

## Related Files

- `Content-Pipeline-Architecture-FDL1.md` — ⚠️ DEPRECATED, do not rely on for schema
- FDL2 Session Starter doc — high-level scope overview (written before Rob's rebuild, treat with caution)
- Old master tracker — https://docs.google.com/spreadsheets/d/1aOSpYwzExdKRr-85PVISpLPGqWxOnP8qioxSsib9Tlw/edit?gid=0#gid=0
