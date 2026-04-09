# CONTEXT.md — OstéoPeinture OP Hub (fka Quote Assistant)
# Last updated: April 8, 2026
# Session: Ecosystem doc + Supabase migration spec (documentation only)

---

## SEE ALSO — canonical planning docs

The full ecosystem overview and build plan is NO LONGER in this file. It lives at:
- **`osteopeinture/docs/OSTEOP-BUILD-ECOSYSTEM-OVERVIEW.md`** — macro module map, sequencing, editable-outputs principle
- **`osteopeinture/docs/SUPABASE-MIGRATION-SPEC.md`** — Phase 0 prerequisite migration spec

Read those first for context on how this build fits into the broader OP ecosystem.

---

## STATE AS OF 2026-04-08

**Live URL:** https://op-quote-assistant.up.railway.app (in-app brand: "OP Hub")
**Supabase decision:** confirmed (free tier). Migration not yet started. See `SUPABASE-MIGRATION-SPEC.md`.
**Next action:** **Phase 1 smoke test on the upcoming real job** — quote → convert to job → payment → verify Contract Revenue row in finance sheet → generate invoice → verify invoice flows. Do NOT use LACHANCE for this.

## WHAT'S BUILT (D-1 to D-7 + today)
- OP Quote chat + PDF + email (quote_send, quote_revision only)
- Job management: convert quote → job, Jobs list + detail, delete job
- Jibble CSV import + activity mapping (never smoke-tested on real data)
- Change orders
- Client update generator (bilingual HTML + PDF)
- Editable invoice draft (combines quote + change orders + time entries)
- Payment recording → Contract Revenue sync to finance sheet (fire-and-forget gap)
- DB backup download endpoint (workaround for service-account Drive writes)
- Desktop collapsible sidebar + mobile send-button relocation (today)
- Recompute-on-convert fix for the $0 quote total bug (today)

---

## ORIGINAL CONTEXT (pre-D-series, kept for reference)

# OstéoPeinture Quote Assistant
# Session: OP exterior quoting logic

---

## PROJECT LOCATION
- Repo: osteopeinture/quote-assistant/
- Live: https://op-quote-assistant.up.railway.app
- Deploy: manual — railway up (not connected to GitHub auto-deploy)

---

## WHAT'S BUILT AND WORKING
- Chat-based quote generation (interior + exterior)
- PDF download via Playwright/Chromium in Docker
- Image upload (JPEG/PNG/WebP/HEIC, max 15, drag-and-drop)
- Email draft panel (scenario, signer, language, detail)
- Email send via SMTP (Gmail)
- Session list/history (SQLite)
- Quoting logic editor (admin — edits volume only, not back to repo)
- Bilingual EN/FR auto-detection

Key server.js functions:
buildSystemPrompt(), handleSessionMessage(), renderQuoteHTML(),
buildEmailDraft(), buildScenarioBody(), normalizeImages(), extractJsonString()

---

## IN PROGRESS / PARTIALLY BUILT
- Email scenarios: 8 defined in EMAIL_LOGIC.md but only quote_send and
  quote_revision exposed in UI. Rest coded in buildScenarioBody() but
  not selectable.
- Email refinement: POST /api/sessions/:id/email/refine exists in server.js
  but not wired to frontend.
- Test coverage: partial — no full end-to-end server flow tests.

---

## QUEUED UI CHANGES (from April 3 session)
1. Resizable panel divider between chat and quote panels (drag left/right)
2. Mobile floating quote icon (top right) — tap to expand full screen,
   tap again to collapse. Keyboard-safe.
3. Final totals rounding: floor subtotals and grand total round to nearest
   $50. Line items do not round.

---

## QUEUED LOGIC CHANGES (from April 3 session)
- Load updated QUOTING_LOGIC.md (v2) into server — wall benchmark corrected
  to 0.25 min/sqft, new sections 3A/3B/3C added (baseboards, crown moulding,
  production standards), door/window tiers updated, Section 20 rewritten.

---

## WHAT WAS DONE (2026-04-04) — Exterior Quoting Logic

### QUOTING_LOGIC.md
- Added §23A (Exterior Assistant Guidance) between §23 and §24
- Contents: conversation flow, standard task sequences (paint, stain, deck,
  metal), gap checklist, pre-generation review format, output rules,
  §27 sanity check instructions

### server.js — buildSystemPrompt()
- Added Phase 2C (exterior quote conversation flow) — zone-based gathering,
  estimator-provided hours, no calculated benchmarks
- Added exterior pre-generation review format (scope → hours → materials →
  access → totals with sanity check and disclaimer)
- Added full exterior JSON format with example (title-based sections,
  excluded repairs, optional add-ons, estimateDisclaimer field)
- Added exterior-specific rules to IMPORTANT section (no benchmark
  calculation, always include disclaimer and repairs, $50 rounding)

### server.js — renderQuoteHTML()
- Subtotal calculation now skips sections with excluded: true or optional: true
- Category-based path now renders:
  - "OPTIONAL ADD-ONS (not included in total)" divider before optional sections
  - "(excluded from total)" label on excluded sections (repairs)
  - Repairs show range but no price in the price column
  - Spacer logic adapted for excluded/optional boundaries
- Added estimateDisclaimer block (styled, appears before legal block)

### Tests
- All 14 existing tests pass
- Source-level verification: subtotal exclusion, disclaimer, optional
  divider, excluded label, exterior JSON format all confirmed present

---

## KNOWN ISSUES
1. Silent PDF failure — Playwright/Chromium fails with no clear frontend error
2. Silent SMTP failure — bad credentials fail silently in UI
3. Session persistence — SQLite on Railway volume; history lost if volume wiped
4. Admin logic editor — edits don't write back to repo QUOTING_LOGIC.md
5. Model hardcoded to claude-sonnet-4-6 in server.js
6. No auto-deploy — Railway not connected to GitHub

---

## TBCs / NOT YET BUILT
- ~~Exterior primer prices~~ — resolved April 4: Seal Grip $69, Kem Bond $95.45, ProCryl $95.45, Ext Oil-Based Wood $77.05 (all incl. 15% margin)
- Staircase benchmarks (spindles, risers, stringers) — TBC
- Standalone email drafting (currently requires a quote to exist)
- Lead intake automation (described in EMAIL_LOGIC.md, nothing built)
- Finance system (create-sheet.gs) — fully written, never run or tested

---

## NEXT STEPS
- [x] Deploy to Railway — live, 200 OK, QUOTING_LOGIC.md pushed to volume (April 4)
- [x] Fill TBC exterior primer prices (Seal Grip, Kem Bond, ProCryl, Ext Oil-Based Wood)
- [ ] Test PDF generation with an exterior quote (disclaimer, excluded repairs, optional add-ons render correctly)
- [ ] Load QUOTING_LOGIC.md v2 interior changes (still queued from April 3)

---

## FILE SIZES FOR REFERENCE
- server.js: ~1700 lines (updated April 4)
- index.html: 70 KB
- quote_template.html: 374 KB
- QUOTING_LOGIC.md: ~28 KB (§23A added April 4)
- EMAIL_LOGIC.md: 9.6 KB
- CONTEXT.md: this file
