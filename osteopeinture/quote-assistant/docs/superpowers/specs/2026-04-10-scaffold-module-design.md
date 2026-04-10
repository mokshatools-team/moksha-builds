# Scaffold Access Quoting Module — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Build:** OP Hub Quote Assistant (osteopeinture/quote-assistant)

---

## Overview

A scaffold calculation engine integrated into the OP Hub quote assistant. Combines conversational input (Claude) with deterministic backend math (scaffold engine) to produce accurate component lists, rental costs, and labor estimates for exterior painting jobs.

### What it does
- Takes job dimensions (towers, bays, levels, overhangs) via natural conversation
- Calculates exact component quantities using deterministic formulas
- Prices everything from the EMCO 2025 rental catalog
- Outputs three layers: per-tower breakdown, combined EMCO rental order, labor summary
- Integrates scaffold costs into exterior quote line items

### What it replaces
- Manual Google Sheets scaffold calculator
- Unreliable ChatGPT custom GPT

### Rental suppliers
- **EMCO** — primary, scaffold components (Montreal, 514-270-7101)
- **GAMMA** — secondary, lifts only (prices TBD, not in V1)

---

## Conversation Flow

1. User describes the job in natural language (within an exterior quote session or standalone scaffold session)
2. Claude proposes a tower layout using visual notation:
   ```
   FRONT Facade
   Tower A  →  | 7 | 7 | 7 | 7 |   4 bays, 5 levels (25ft)

   BACK Facade
   Tower B  →  | 10 | 10 |          2 bays, 5 levels (25ft)
   ```
3. Claude asks for missing inputs: overhang levels, triangle size, duration, labor hours
4. User confirms or adjusts
5. Claude calls `calculate_scaffold` tool (native function calling) with structured spec
6. Backend engine computes components + costs deterministically
7. Claude presents results conversationally with full breakdown
8. User can iterate ("add an overhang to Tower B") — Claude re-calls engine
9. For exterior quotes: scaffold total becomes a line item in the quote JSON

### Tool scoping
`calculate_scaffold` is only registered for `exterior` and `scaffold` session types. Interior sessions never see this tool.

---

## Terminology (agreed)

| Term | Definition |
|---|---|
| **Frame** | H-shaped vertical piece. Default 4ft×5ft. Also 5ft×5ft, 30"×5ft. |
| **Half-Height Frame** | 5ft×3ft. Only comes in 5ft wide. Forces tower to 5ft wide. |
| **Sidewalk Frame** | Tall frame for passage underneath. Only comes in 5ft wide. Forces tower to 5ft wide. |
| **Adjustable Foot** | Threaded screw with base plate under each frame for leveling. AKA base jack. |
| **Cross Brace** | Diagonal X-brace between frames. Sized to bay width (7ft or 10ft). |
| **Plank** (Board) | Certified wooden walking surface. 8ft or 12ft. |
| **Platform** | Aluminum walking surface. 7ft or 10ft. Sturdier than planks. |
| **Triangle** | Overhang bracket. Mounts on frame, extends outward. Small (20"), Medium (24"), Large (36"). |
| **Tie-In** (Anchoring Arm) | 4ft post with swivel clamp. Secures scaffold to wall. |
| **Banana** | Small clip securing frames to wall. Separate from tie-ins. |
| **Pulley Set** | Pulley + pulley frame. Always included. |
| **Rope** | Listed separately from pulley. 50ft standard, 100ft for >5 levels. |
| **Tower** | Standalone non-contiguous scaffold structure. Labeled A, B, C... |
| **Bay** | One section within a contiguous run. |
| **Level** | One story of height = 5ft. |

### Key rules
- Frame width is **per tower** — all frames in a tower must match (contiguous sections must match)
- Default frame width: **4ft** (lighter, preferred). 5ft only when half-height or sidewalk frames needed.
- Overhang levels let workers access outside the structure (not stuck behind cross braces)
- Standard overhang spacing: start at highest work point − 5ft, then every 6ft down

---

## Scaffold Spec JSON (Claude → Backend)

```json
{
  "duration_days": 14,
  "towers": [
    {
      "label": "A",
      "facade": "Front",
      "frame_width": "4ft",
      "bays": [7, 7, 7, 7],
      "levels": 5,
      "overhang_levels": 3,
      "triangle_size": "medium",
      "sidewalk_frames": false,
      "adjacent_to": null,
      "duration_days": null,
      "notes": "over front porch railing"
    }
  ],
  "extras": {
    "harness": false,
    "ladders": [{"size": "28ft", "quantity": 2, "rental": true}],
    "custom_items": []
  }
}
```

### Schema notes
- `bays` is an array of widths — drives cross brace and platform sizing
- `frame_width` defaults to `"4ft"`. Auto-set to `"5ft"` if sidewalk_frames or half-height frames used. Claude should flag this.
- `duration_days` at job level is shared. Per-tower override is optional (rare).
- `adjacent_to` reserved for V2 frame-sharing optimization (always null in V1)
- `harness` only if user explicitly requests — never auto-include
- `ladders` include quantity. Owned ladders (21ft) are not included in rental order.

---

## Backend Calculation Engine

### Component Formulas

Given: `B` = num_bays, `L` = levels, `OVH` = overhang_levels, `F` = frames_per_level = B + 1

| Component | Formula | Sizing |
|---|---|---|
| Frames | `F × L` | frame_width × 5ft |
| Half-height frames | 0 (user-specified only) | 5ft wide only |
| Sidewalk frames | If flagged: replaces ground-level standard frames = `F` | 5ft wide only |
| Adjustable feet | `2 × F` | Ground level only |
| Cross braces | `(2 × B - 1) × L` | Per bay width from array (7ft or 10ft) |
| Platforms | `OVH × (B × 2 + 1)` | Per bay width (7ft or 10ft) |
| Planks | `B × L` | 8ft for 7ft bays, 12ft for 10ft bays |
| Triangles | `OVH × F` | Small/medium/large per tower |
| Tie-ins | `tie_in_levels × B` | tie_in_levels = FLOOR((height-15)/10)+1 when height ≥ 15ft |
| Bananas | `2 × F × 2` | Top 2 levels |
| Pulley set | 1 per job | Pulley + pulley frame |
| Rope | 1 per job | 50ft if ≤5 levels, 100ft if >5 (specify in order) |

### Rental Duration Tiers
- Daily rate: 1-2 days
- Weekly rate: 3-14 days
- Monthly rate: >14 days

### Job-Level Totals
1. Sum all tower components by type and size — **engine does this aggregation**, Claude never adds up per-tower numbers
2. Add extras (rental ladders, custom items)
3. Apply rental rate based on duration tier
4. Add delivery: $200 (2 × $100)
5. Add 10% buffer on rental subtotal
6. Grand total = rental + delivery + buffer

### EMCO 2025 Prices (stored in engine)

**Standard Components:**

| Component | Sizes | Daily | Weekly | Monthly |
|---|---|---|---|---|
| Frame | 5ft×5ft, 4ft×5ft, 30"×5ft | — | $4 | $8 |
| Half-Height Frame | 5ft×3ft | — | $4 | $8 |
| Cross Brace | 5ft, 7ft, 10ft | — | $3 | $6 |
| Sidewalk Frame | 5ft wide only | — | $5 | $10 |
| Plank | 8ft, 12ft | $4 | $6 | $12 |
| Platform | 7ft, 10ft | $6 | $12 | $24 |
| Triangle | Small/Medium/Large | — | $4 | $8 |
| Caster Wheel | — | — | $4 | $10 |
| Adjustable Foot | — | — | $4 | $8 |

**Accessories:**

| Component | Daily | Weekly | Monthly |
|---|---|---|---|
| Extension Angle | — | $5 | $10 |
| Stairway with Handrails | — | $25 | $50 |
| Transport Cart | $15 | $50 | $100 |
| Pulley Set | $18 | $40 | $75 |
| Banana | — | $0.75 | $1.50 |
| Tie-In (Anchoring Arm) | — | $6 | $15 |
| Rope Clamp | $8 | $20 | $45 |

**Safety:**

| Component | Daily | Weekly | Monthly |
|---|---|---|---|
| Safety Harness | $15 | $35 | $60 |

**Delivery:** $100/trip, standard 2 trips per job

---

## Engine Output JSON (Backend → Claude)

```json
{
  "towers": {
    "A": {
      "facade": "Front",
      "layout": [7, 7, 7, 7],
      "components": [
        {"item": "Frame 4ft×5ft", "qty": 20, "rate": 4, "period": "weekly", "cost": 80},
        {"item": "Cross Brace 7ft", "qty": 35, "rate": 3, "period": "weekly", "cost": 105},
        {"item": "Platform 7ft", "qty": 21, "rate": 12, "period": "weekly", "cost": 252},
        {"item": "Plank 8ft", "qty": 20, "rate": 6, "period": "weekly", "cost": 120},
        {"item": "Triangle Medium", "qty": 15, "rate": 4, "period": "weekly", "cost": 60},
        {"item": "Adjustable Foot", "qty": 10, "rate": 4, "period": "weekly", "cost": 40},
        {"item": "Tie-In", "qty": 8, "rate": 6, "period": "weekly", "cost": 48},
        {"item": "Banana", "qty": 20, "rate": 0.75, "period": "weekly", "cost": 15}
      ],
      "tower_rental": 720
    }
  },
  "rental_order": [
    {"item": "Frame 4ft×5ft", "qty": 35, "rate": 4, "period": "weekly", "cost": 140},
    {"item": "Cross Brace 7ft", "qty": 55, "rate": 3, "period": "weekly", "cost": 165},
    {"item": "Pulley Set", "qty": 1, "rate": 40, "period": "weekly", "cost": 40},
    {"item": "Rope 50ft", "qty": 1, "rate": 0, "period": "weekly", "cost": 0, "note": "included with pulley set rental (EMCO bundles bracket+pulley+50ft rope as one item). For 100ft rope (>5 levels), pricing TBD — confirm with EMCO before first order."}
  ],
  "summary": {
    "rental_subtotal": 980,
    "delivery": 200,
    "buffer_10pct": 98,
    "rental_total": 1278,
    "period": "weekly"
  }
}
```

---

## Ladders

| Ladder | Vertical Reach | Owned/Rented | Transport | Notes |
|---|---|---|---|---|
| 21ft | ~17ft | Owned | Roof rack | Default for low work, not in rental order |
| 24ft | ~20ft | Rent (EMCO) | Roof rack | |
| 28ft | ~24ft | Rent (EMCO) | Roof rack (max carry) | |
| 32ft | ~27ft | Rent (EMCO) | Needs delivery | Rare, doesn't feel safe |
| 36ft+ | ~30ft+ | Rent (EMCO) | Needs delivery | Bundle with scaffold delivery |

Ladders often complement scaffold on a job. 32ft+ ladders require EMCO delivery — bundle with scaffold order.

---

## Labor

**No benchmarks yet — judgment call per job.**

- User provides hours per tower for each phase
- Phases: receiving, level 1 setup, upper levels, stabilization, tear down, pack out
- Level 1 setup is the slowest (terrain-dependent: flat → fast, sloped/uneven → slow)
- Tear down ≈ half of setup time
- Wage rate confirmed with user (typically $50/h or $60/h)
- Claude computes: hours × rate (simple multiplication, no engine needed)
- Labor total feeds into the exterior quote as a separate line item

---

## System Prompt Changes (QUOTING_LOGIC.md)

Add sections §30-34:
- §30 — Scaffold Access (overview, when scaffold vs ladder vs lift)
- §31 — Scaffold Components & Formulas (all formulas, so Claude can explain results)
- §32 — EMCO 2025 Catalog (price tables)
- §33 — Ladders (owned + rental thresholds)
- §34 — Scaffold Labor (manual input, phases, wage rates)

**Token budget:** Measure token count after drafting §30-34. If EMCO catalog inflates prompt too much, trim to scaffold-relevant items only (drop rolling towers, foldable interior scaffolds, etc.).

**Version bump:** Increment version header to trigger force-reseed on deploy.

### Claude behavior rules for scaffold
- Always propose tower layout using `| 7 | 7 | 10 |` notation
- Always confirm overhang levels, triangle size, duration before calling engine
- Present per-tower breakdown first, then combined rental order
- Flag optimizations ("monthly might be cheaper", "A and B could be contiguous")
- Never auto-include harness
- Always list rope as separate item with length specified
- Pulley set always included

---

## App Integration

### New files
- `lib/scaffold-engine.js` — calculation engine + EMCO catalog

### Modified files
- `server.js` — new `POST /api/scaffold/calculate` endpoint + tool registration (scoped to exterior/scaffold sessions)
- `QUOTING_LOGIC.md` — add §30-34, bump version
- `public/index.html` — no changes (purely conversational, no new UI)

### No new database tables in V1
Scaffold specs live in session message history (Claude's tool call + response). Scaffold total enters the quote JSON as a line item when part of an exterior quote.

---

## Build Order

1. Write and test `scaffold-engine.js` standalone with fixture JSON
2. Wire `POST /api/scaffold/calculate` endpoint
3. Register `calculate_scaffold` tool (scoped to exterior/scaffold session types)
4. Add §30-34 to QUOTING_LOGIC.md (measure token count)
5. End-to-end test: conversation → tool call → engine → results → quote line item

---

## Future (not V1)

- **GAMMA lift prices** — add to catalog when provided
- **Frame-sharing optimization** — `adjacent_to` field for towers sharing corners
- **Labor benchmarks** — formalize hours/tower/level once enough data collected
- **Rental optimization pass** — cross-job batching to hit monthly rates
- **Scaffold session type** — standalone scaffold calculations not tied to a quote
