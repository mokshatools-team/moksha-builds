---
name: Scaffold quoting module — scope and logic
description: New module for OP Hub quote assistant — calculates scaffold component quantities and rental costs from job dimensions, complete build logic and formulas
type: project
---

## What it is
An access quoting assistant that covers scaffold, lifts, and ladders — integrated into the OP Hub quote assistant. Combines:
- **Exterior quoting logic** (existing QUOTING_LOGIC.md for painting)
- **Scaffold calculation** (component quantities + rental costs from job dimensions)
- **Lift usage** (GAMMA prices TBD)
- **Ladder usage** (owned 21ft + EMCO rentals)

The assistant helps write complete exterior quotes by linking what needs to be painted/stained → what access is needed → what components to rent → what it costs.

**Why:** Loric currently does this manually in Google Sheets. The logic is rule-based and deterministic — perfect for automation. Replaces a ChatGPT custom GPT that wasn't reliable enough.

**How to apply:** Build as a module within the existing quote-assistant app. Use EMCO 2025 prices as default catalog (see reference_emco_scaffold_catalog.md). GAMMA lift prices to be added later.

## Source data
- Google Sheet: `1oJsmwy8XtfNKvXpQFb9SHWizLcXrIEMf5yYd5fUOwKs` (tabs: scaffolding, EXT 1, EXT 2)
- EMCO 2025 rental booklet: stored in reference_emco_scaffold_catalog.md
- Prior ChatGPT scaffold GPT rules: superseded by this document

## Rental suppliers
- **EMCO** — primary, scaffolding components + some lifts (Montreal)
- **GAMMA** — secondary, mainly lifts (Montreal, prices TBD)

---

## TERMINOLOGY (agreed with Loric)

| Term | What it is |
|---|---|
| **Frame** | H-shaped vertical piece. Standard: 5'×5' (5ft wide, 5ft tall). Also 4'×5', 30"×5'. Never say "leg" — just "frame". |
| **Half-Height Frame** | 5'×3' frame. 5ft wide only. Same price as standard. |
| **Adjustable Foot** | Threaded screw with base plate, goes under each frame for leveling. AKA base jack. 2 per frame (default). |
| **Cross Brace** | Diagonal X-brace between frames. Sized to match bay width (7ft or 10ft). |
| **Plank** (Board) | Certified wooden walking surface. 8' or 12'. |
| **Platform** | Aluminum walking surface. 7' or 10'. Sturdier than planks. 2 planks ≈ 1 platform. |
| **Triangle** | Overhang bracket. Mounts on frame, extends outward. 3 sizes: Small (20"), Medium (24"), Large (36"). Measured post-to-tip. |
| **Sidewalk Frame** | Taller frame for passage underneath (doorways, railings). 5ft wide only from EMCO. |
| **Tie-In** (Anchoring Arm) | 4' post with swivel clamp. Secures scaffold to building wall. |
| **Banana** | Small clip that secures frames to the wall. Different from tie-ins. |
| **Pulley Set** | Pulley + pulley frame + rope (50ft standard, 100ft for >5 levels). For hoisting materials. |
| **Tower** | A standalone, non-contiguous scaffold structure. Minimum: 2 frames + cross braces. |
| **Bay** | One section within a contiguous run. First bay = 2 frames/level. Each additional bay = +1 frame/level. |
| **Level** | One story of height = 5ft (standard frame). |
| **Caster** | Wheel for mobile/rolling scaffolds. |
| **Safety Harness** | Fall protection. Flat rental. |

---

## COMPONENT FORMULAS

### Job Organization
- Most jobs require **multiple towers** (non-contiguous)
- A contiguous run of bays = 1 tower
- Towers are labeled **A, B, C, D, E...**
- Towers are organized by **facade**: Front, Side (Left/Right), Back
- Each tower is calculated independently, then totals are summed for the rental order

### Tower Layout Notation
Show bay widths left to right:
```
Tower A  →  | 10 | 7 | 7 |    3 bays (1×10 + 2×7), 5 levels, 2 overhang levels
Tower B  →  | 7 | 7 | 7 | 7 |  4 bays (4×7), 4 levels, 3 overhang levels
Tower C  →  | 10 | 10 |        2 bays (2×10), 5 levels, no overhangs
```

### Inputs (per tower)
- `width` — total work area width (ft)
- `height` — work height needed (ft)
- `bays` — number of contiguous bays (derived from width and bay widths: 7ft or 10ft)
- `levels` — number of levels (derived from height, each level = 5ft)
- `overhang` — yes/no, and if yes: size (small/medium/large) and how many overhang levels
- `duration` — rental duration in days (shared across all towers on same job)

### Frames
- **Contiguous run of N bays:** `(N + 1) × levels` frames per tower
- **Standalone tower (1 bay):** `2 × levels` frames

### Adjustable Feet
- `2 × frames_at_ground_level` (2 per frame, ground level only)
- Unless user specifies otherwise

### Cross Braces
- Per tower: `(2 × bays - 1) × levels`
- (2 per bay minus 1, times levels)

### Overhang Levels (critical concept)
Overhangs extend outward from the scaffold so workers aren't stuck behind cross braces.
- **User determines** where overhang levels are needed (based on what needs to be worked on)
- **Standard spacing:** start at top (highest work point − 5ft), then every 6ft down
- **Formula to estimate:**
  1. `top_platform_height = highest_work_point - 5ft` (unless user specifies)
  2. `overhang_levels = 1 + FLOOR((top_platform_height - lowest_work_point) / 6)`
  3. Always prompt user to confirm — the facade determines access needs
- **Examples:**
  - Cornice-only job → 1 overhang level (top only)
  - Full facade (siding, stucco, windows) → multiple overhang levels covering full height

### Platforms
- Per overhang level: 2 platforms per bay
- Total: `OVH × B × 2` where OVH = overhang_levels, B = num_bays

### Planks (Boards)
- **1 plank per bay per level** (all levels)
- Total: `bays × levels`

### Triangles
- Triangles attach to **frames** (not bays) — each frame gets a triangle on each overhang level
- `triangles = overhang_levels × frames_per_level`
- Where `frames_per_level = bays + 1` (for contiguous run)
- Example: 3 bays, 2 overhang levels → 2 × 4 = **8 triangles**

### Tie-Ins (Anchoring Arms)
- Required starting at 15ft, then every 10ft: 15ft, 25ft, 35ft, 45ft...
- `tie_in_levels = FLOOR((height - 15) / 10) + 1` (when height ≥ 15ft)
- `tie_ins_per_level = bays` (1 per bay)
- `total_tie_ins = tie_in_levels × bays`
- Example: 35ft scaffold, 3 bays → 3 tie-in levels × 3 bays = **9 tie-ins**

### Bananas
- Separate from tie-ins
- `2 per frame` on the **top 2 levels**
- Total: `2 × frames_per_level × 2`

### Pulley Set
- **Always included** (1 per job)
- Components: pulley + pulley frame (listed together) + rope (listed separately)
- **Rope:** always specify length — 50ft for ≤5 levels, 100ft for >5 levels

### Harness
- **Only include if user requests it** — never auto-include

### Delivery
- $100/trip × 2 trips (deliver + pickup) = $200 base
- No extra trips budgeted — instead add **10% buffer** on total rental order

---

## RENTAL DURATION TIERS
- Daily rate: 1–2 days
- Weekly rate: 3–14 days
- Monthly rate: >14 days

---

## LABOR (separate from rental costs)

Labor is quoted independently from component rental. Phases:
1. **Receiving delivery** — unload, sort
2. **Level 1 setup** — slowest phase. Level, plumb, square. Terrain-dependent (flat → fast, sloped/uneven/bushes → slow)
3. **Upper levels** — fast once base is solid
4. **Stabilization** — tie-ins, anchoring (above 15ft)
5. **Tear down** — roughly half of setup time
6. **Pack out** — load for pickup

---

## LADDERS (owned + rented)

| Ladder | Vertical Reach | Owned/Rented | Transport | Notes |
|---|---|---|---|---|
| 21ft | ~17ft | **Owned** | Roof rack | Default for low work |
| 24ft | ~20ft | Rent (EMCO) | Roof rack | |
| 28ft | ~24ft | Rent (EMCO) | Roof rack (max carry) | |
| 32ft | ~27ft | Rent (EMCO) | **Needs delivery** | Doesn't feel safe, rare |
| 36ft+ | ~30ft+ | Rent (EMCO) | **Needs delivery** | Add to scaffold delivery order |

- Ladders often complement scaffold on a job (e.g., scaffold on main facade, ladder for small returns)
- 32ft+ ladders require EMCO delivery — bundle with scaffold order if applicable
- See EMCO catalog for rental rates on extension ladders

---

## QUOTING APPROACH (two-pass)
1. **Per-contract quote** — each job quoted independently with exactly what it needs
2. **Rental optimization pass** (separate session) — look across upcoming jobs, batch rental periods to hit monthly rates instead of 2× weekly

---

## Status: V1 LIVE (2026-04-10)

Deployed to Railway. Engine, endpoint, Claude tool, and §30-34 all live.
- `lib/scaffold-engine.js` — all formulas + EMCO catalog
- `POST /api/scaffold/calculate` — tested live
- `calculate_scaffold` tool registered for exterior/scaffold sessions
- QUOTING_LOGIC.md bumped to v3 with §30-34
- 28/28 tests pass

**Next session:** Test a real exterior quote conversation with scaffold in OP Hub. GAMMA lift prices still TBD.
