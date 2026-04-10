# Scaffold Access Quoting Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic scaffold calculation engine to the OP Hub quote assistant, invoked by Claude via tool use during exterior/scaffold conversations.

**Architecture:** New `lib/scaffold-engine.js` contains all formulas + EMCO 2025 catalog. Server exposes `POST /api/scaffold/calculate` and registers `calculate_scaffold` as a Claude tool (scoped to exterior sessions). `QUOTING_LOGIC.md` gets §30-34 so Claude understands scaffold domain. No new UI — purely conversational.

**Tech Stack:** Node.js, Express, Anthropic SDK tool use, node:test for testing.

**Spec:** `docs/superpowers/specs/2026-04-10-scaffold-module-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/scaffold-engine.js` | **Create** | EMCO catalog, component formulas, rental pricing, aggregation — pure functions, no side effects |
| `tests/scaffold-engine.test.js` | **Create** | Unit tests for all formulas and edge cases |
| `server.js` | **Modify** | New endpoint, tool registration in Claude API call, tool result handling loop |
| `QUOTING_LOGIC.md` | **Modify** | Add §30-34 (scaffold domain knowledge for Claude), bump version |

---

## Task 1: Scaffold Engine — EMCO Catalog + Price Lookup

**Files:**
- Create: `lib/scaffold-engine.js`
- Create: `tests/scaffold-engine.test.js`

- [ ] **Step 1: Write the failing test for price lookup**

```js
// tests/scaffold-engine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const { getRate } = require('../lib/scaffold-engine');

test('getRate returns weekly price for Frame', () => {
  assert.equal(getRate('frame', 'weekly'), 4);
});

test('getRate returns monthly price for Platform', () => {
  assert.equal(getRate('platform', 'monthly'), 24);
});

test('getRate returns weekly price for Banana', () => {
  assert.equal(getRate('banana', 'weekly'), 0.75);
});

test('getRate returns null for daily Frame (no daily rate)', () => {
  assert.equal(getRate('frame', 'daily'), null);
});

test('getRatePeriod returns weekly for 7 days', () => {
  const { getRatePeriod } = require('../lib/scaffold-engine');
  assert.equal(getRatePeriod(7), 'weekly');
});

test('getRatePeriod returns daily for 2 days', () => {
  const { getRatePeriod } = require('../lib/scaffold-engine');
  assert.equal(getRatePeriod(2), 'daily');
});

test('getRatePeriod returns monthly for 15 days', () => {
  const { getRatePeriod } = require('../lib/scaffold-engine');
  assert.equal(getRatePeriod(15), 'monthly');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd osteopeinture/quote-assistant && node --test tests/scaffold-engine.test.js`
Expected: FAIL — `Cannot find module '../lib/scaffold-engine'`

- [ ] **Step 3: Write the EMCO catalog and price lookup**

```js
// lib/scaffold-engine.js
'use strict';

// ============================================================
// EMCO 2025 RENTAL CATALOG
// Source: https://emcomachinery.com/wp-content/uploads/2025/01/Rental-Price-Book-min.pdf
// All prices CAD, exclude tax.
// Periods: daily=24h, weekly=7 days, monthly=28 days
// ============================================================

const EMCO_CATALOG = {
  frame:            { daily: null, weekly: 4,    monthly: 8    },
  half_height_frame:{ daily: null, weekly: 4,    monthly: 8    },
  cross_brace:      { daily: null, weekly: 3,    monthly: 6    },
  sidewalk_frame:   { daily: null, weekly: 5,    monthly: 10   },
  plank:            { daily: 4,    weekly: 6,    monthly: 12   },
  platform:         { daily: 6,    weekly: 12,   monthly: 24   },
  triangle:         { daily: null, weekly: 4,    monthly: 8    },
  caster_wheel:     { daily: null, weekly: 4,    monthly: 10   },
  adjustable_foot:  { daily: null, weekly: 4,    monthly: 8    },
  extension_angle:  { daily: null, weekly: 5,    monthly: 10   },
  stairway:         { daily: null, weekly: 25,   monthly: 50   },
  transport_cart:   { daily: 15,   weekly: 50,   monthly: 100  },
  pulley_set:       { daily: 18,   weekly: 40,   monthly: 75   },
  banana:           { daily: null, weekly: 0.75, monthly: 1.50 },
  tie_in:           { daily: null, weekly: 6,    monthly: 15   },
  rope_clamp:       { daily: 8,    weekly: 20,   monthly: 45   },
  safety_harness:   { daily: 15,   weekly: 35,   monthly: 60   },
};

const DELIVERY_PER_TRIP = 100;
const STANDARD_TRIPS = 2;
const BUFFER_PERCENT = 0.10;

/**
 * Get the rental rate for a component at a given period.
 * @param {string} component - catalog key (e.g. 'frame', 'platform')
 * @param {string} period - 'daily', 'weekly', or 'monthly'
 * @returns {number|null} price per unit per period, or null if not available
 */
function getRate(component, period) {
  const entry = EMCO_CATALOG[component];
  if (!entry) return null;
  return entry[period] ?? null;
}

/**
 * Determine rental period from duration in days.
 * @param {number} days
 * @returns {string} 'daily' | 'weekly' | 'monthly'
 */
function getRatePeriod(days) {
  if (days <= 2) return 'daily';
  if (days <= 14) return 'weekly';
  return 'monthly';
}

module.exports = {
  EMCO_CATALOG,
  DELIVERY_PER_TRIP,
  STANDARD_TRIPS,
  BUFFER_PERCENT,
  getRate,
  getRatePeriod,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd osteopeinture/quote-assistant && node --test tests/scaffold-engine.test.js`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/scaffold-engine.js tests/scaffold-engine.test.js
git commit -m "feat(scaffold): EMCO 2025 catalog + price lookup functions"
```

---

## Task 2: Scaffold Engine — Per-Tower Component Calculation

**Files:**
- Modify: `lib/scaffold-engine.js`
- Modify: `tests/scaffold-engine.test.js`

- [ ] **Step 1: Write failing tests for calculateTower**

Append to `tests/scaffold-engine.test.js`:

```js
const { calculateTower } = require('../lib/scaffold-engine');

// Tower A: 2 bays of 7ft, 5 levels, 3 overhang levels, medium triangles, 4ft frames
test('calculateTower — 2x7ft, 5 levels, 3 overhangs', () => {
  const tower = {
    label: 'A',
    facade: 'Front',
    frame_width: '4ft',
    bays: [7, 7],
    levels: 5,
    overhang_levels: 3,
    triangle_size: 'medium',
    sidewalk_frames: false,
  };
  const result = calculateTower(tower, 'weekly');

  // Frames: (2+1) × 5 = 15
  assert.equal(result.components.find(c => c.item === 'Frame 4ft×5ft').qty, 15);

  // Adjustable feet: 2 × 3 = 6
  assert.equal(result.components.find(c => c.item === 'Adjustable Foot').qty, 6);

  // Cross braces: (2×2 - 1) × 5 = 15
  assert.equal(result.components.find(c => c.item === 'Cross Brace 7ft').qty, 15);

  // Platforms: 3 × 2 × 2 = 12
  assert.equal(result.components.find(c => c.item === 'Platform 7ft').qty, 12);

  // Planks: 2 × 5 = 10
  assert.equal(result.components.find(c => c.item === 'Plank 8ft').qty, 10);

  // Triangles: 3 × 3 = 9
  assert.equal(result.components.find(c => c.item === 'Triangle Medium').qty, 9);

  // Tie-ins: height=25ft, tie_in_levels = FLOOR((25-15)/10)+1 = 2, × 2 bays = 4
  assert.equal(result.components.find(c => c.item === 'Tie-In').qty, 4);

  // Bananas: 2 × 3 × 2 = 12
  assert.equal(result.components.find(c => c.item === 'Banana').qty, 12);
});

test('calculateTower — no overhangs, below 15ft (no tie-ins)', () => {
  const tower = {
    label: 'B',
    facade: 'Back',
    frame_width: '4ft',
    bays: [10],
    levels: 2,
    overhang_levels: 0,
    triangle_size: 'medium',
    sidewalk_frames: false,
  };
  const result = calculateTower(tower, 'weekly');

  // Frames: (1+1) × 2 = 4
  assert.equal(result.components.find(c => c.item === 'Frame 4ft×5ft').qty, 4);

  // Cross braces: (2×1 - 1) × 2 = 2
  assert.equal(result.components.find(c => c.item === 'Cross Brace 10ft').qty, 2);

  // No platforms (0 overhangs)
  assert.equal(result.components.find(c => c.item.startsWith('Platform')), undefined);

  // Planks: 1 × 2 = 2
  assert.equal(result.components.find(c => c.item === 'Plank 12ft').qty, 2);

  // No triangles
  assert.equal(result.components.find(c => c.item.startsWith('Triangle')), undefined);

  // No tie-ins (height = 10ft < 15ft)
  assert.equal(result.components.find(c => c.item === 'Tie-In'), undefined);

  // Bananas: 2 × 2 × 2 = 8
  assert.equal(result.components.find(c => c.item === 'Banana').qty, 8);
});

test('calculateTower — sidewalk frames force 5ft width', () => {
  const tower = {
    label: 'C',
    facade: 'Side',
    frame_width: '4ft',
    bays: [7],
    levels: 3,
    overhang_levels: 1,
    triangle_size: 'small',
    sidewalk_frames: true,
  };
  const result = calculateTower(tower, 'weekly');

  // Sidewalk frames replace ground level: 2
  assert.equal(result.components.find(c => c.item === 'Sidewalk Frame 5ft').qty, 2);

  // Regular frames: remaining levels = 2, frames_per_level = 2 → 4
  // BUT frame_width forced to 5ft
  assert.equal(result.components.find(c => c.item === 'Frame 5ft×5ft').qty, 4);
});

test('calculateTower — mixed bay widths', () => {
  const tower = {
    label: 'D',
    facade: 'Front',
    frame_width: '4ft',
    bays: [10, 7, 7],
    levels: 4,
    overhang_levels: 2,
    triangle_size: 'large',
    sidewalk_frames: false,
  };
  const result = calculateTower(tower, 'weekly');

  // Cross braces: (2×3 - 1) × 4 = 20 total
  // Split by size: 1 bay of 10ft = needs 10ft braces, 2 bays of 7ft = need 7ft braces
  // Per level: for the 10ft bay → 2 braces, for each 7ft bay → 2 braces, minus 1 total per level
  // Actually formula is (2×B - 1) × L = (2×3-1)×4 = 20 total braces
  // Sizing: each bay gets its own brace size. 10ft bay → 10ft braces, 7ft bay → 7ft braces
  // Per level: 2 per bay = 6, minus 1 = 5 per level. But which size loses the -1?
  // Simpler: count per bay width. 10ft bay: 2×1×4=8, 7ft bays: 2×2×4=16, total=24, minus L=4 → 20
  // The -1 per level is taken from the largest bay type for simplicity
  const brace7 = result.components.find(c => c.item === 'Cross Brace 7ft');
  const brace10 = result.components.find(c => c.item === 'Cross Brace 10ft');
  assert.equal((brace7?.qty || 0) + (brace10?.qty || 0), 20);

  // Platforms: 2 × 3 × 2 = 12
  // Split by bay width: 10ft bay gets 10ft platforms, 7ft bays get 7ft platforms
  const plat7 = result.components.find(c => c.item === 'Platform 7ft');
  const plat10 = result.components.find(c => c.item === 'Platform 10ft');
  assert.equal((plat7?.qty || 0) + (plat10?.qty || 0), 12);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd osteopeinture/quote-assistant && node --test tests/scaffold-engine.test.js`
Expected: FAIL — `calculateTower is not a function`

- [ ] **Step 3: Implement calculateTower**

Add to `lib/scaffold-engine.js` before `module.exports`:

```js
/**
 * Map bay width to plank size.
 * @param {number} bayWidth - 7 or 10
 * @returns {string} '8ft' or '12ft'
 */
function plankSizeForBay(bayWidth) {
  return bayWidth <= 7 ? '8ft' : '12ft';
}

/**
 * Map bay width to cross brace / platform label suffix.
 * @param {number} bayWidth
 * @returns {string} '7ft' or '10ft'
 */
function sizeLabelForBay(bayWidth) {
  return bayWidth <= 7 ? '7ft' : '10ft';
}

/**
 * Capitalize first letter of each word.
 */
function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Calculate all components for a single tower.
 * @param {Object} tower - tower spec from the scaffold spec JSON
 * @param {string} period - 'daily', 'weekly', or 'monthly'
 * @returns {Object} { label, facade, layout, components: [...], tower_rental }
 */
function calculateTower(tower, period) {
  const B = tower.bays.length;          // num bays
  const L = tower.levels;               // num levels
  const OVH = tower.overhang_levels;    // overhang levels
  const F = B + 1;                      // frames per level
  const height = L * 5;                 // total height in feet

  // Determine effective frame width (sidewalk frames force 5ft)
  const effectiveFrameWidth = tower.sidewalk_frames ? '5ft' : (tower.frame_width || '4ft');

  const components = [];

  function addComponent(item, qty, catalogKey) {
    if (qty <= 0) return;
    const rate = getRate(catalogKey, period);
    if (rate === null) return; // skip if no rate for this period
    components.push({
      item,
      qty,
      rate,
      period,
      cost: Math.round(qty * rate * 100) / 100,
    });
  }

  // --- Frames ---
  if (tower.sidewalk_frames) {
    // Ground level: sidewalk frames
    addComponent(`Sidewalk Frame 5ft`, F, 'sidewalk_frame');
    // Upper levels: standard frames (forced to 5ft)
    if (L > 1) {
      addComponent(`Frame 5ft×5ft`, F * (L - 1), 'frame');
    }
  } else {
    addComponent(`Frame ${effectiveFrameWidth}×5ft`, F * L, 'frame');
  }

  // --- Adjustable Feet ---
  addComponent('Adjustable Foot', 2 * F, 'adjustable_foot');

  // --- Cross Braces (sized per bay) ---
  // Total braces = (2 × B - 1) × L
  // Distribute proportionally across bay sizes
  const totalBraces = (2 * B - 1) * L;
  const bayWidthCounts = {};
  for (const w of tower.bays) {
    const sizeLabel = sizeLabelForBay(w);
    bayWidthCounts[sizeLabel] = (bayWidthCounts[sizeLabel] || 0) + 1;
  }
  // Allocate braces proportionally by bay count, rounding down, remainder to first size
  const sizeLabels = Object.keys(bayWidthCounts);
  let allocated = 0;
  const braceAlloc = {};
  for (const sl of sizeLabels) {
    const proportion = bayWidthCounts[sl] / B;
    braceAlloc[sl] = Math.floor(totalBraces * proportion);
    allocated += braceAlloc[sl];
  }
  // Give remainder to first size
  braceAlloc[sizeLabels[0]] += (totalBraces - allocated);

  for (const [sizeLabel, qty] of Object.entries(braceAlloc)) {
    addComponent(`Cross Brace ${sizeLabel}`, qty, 'cross_brace');
  }

  // --- Platforms (overhang levels only) ---
  // OVH × B × 2, split by bay width
  if (OVH > 0) {
    const totalPlatforms = OVH * B * 2;
    const platAlloc = {};
    for (const w of tower.bays) {
      const sl = sizeLabelForBay(w);
      platAlloc[sl] = (platAlloc[sl] || 0) + (OVH * 2);
    }
    for (const [sizeLabel, qty] of Object.entries(platAlloc)) {
      addComponent(`Platform ${sizeLabel}`, qty, 'platform');
    }
  }

  // --- Planks ---
  // B × L, split by bay width
  for (const w of tower.bays) {
    const plankSize = plankSizeForBay(w);
    const existing = components.find(c => c.item === `Plank ${plankSize}`);
    if (existing) {
      existing.qty += L;
      existing.cost = Math.round(existing.qty * existing.rate * 100) / 100;
    } else {
      addComponent(`Plank ${plankSize}`, L, 'plank');
    }
  }

  // --- Triangles ---
  if (OVH > 0) {
    const triSize = titleCase(tower.triangle_size || 'medium');
    addComponent(`Triangle ${triSize}`, OVH * F, 'triangle');
  }

  // --- Tie-Ins (anchoring arms) ---
  if (height >= 15) {
    const tieInLevels = Math.floor((height - 15) / 10) + 1;
    addComponent('Tie-In', tieInLevels * B, 'tie_in');
  }

  // --- Bananas ---
  // 2 per frame × top 2 levels
  const bananaLevels = Math.min(2, L);
  addComponent('Banana', 2 * F * bananaLevels, 'banana');

  // --- Tower rental subtotal ---
  const towerRental = components.reduce((sum, c) => sum + c.cost, 0);

  return {
    label: tower.label,
    facade: tower.facade,
    layout: tower.bays,
    components,
    tower_rental: Math.round(towerRental * 100) / 100,
  };
}

module.exports = {
  EMCO_CATALOG,
  DELIVERY_PER_TRIP,
  STANDARD_TRIPS,
  BUFFER_PERCENT,
  getRate,
  getRatePeriod,
  calculateTower,
  // internal helpers exported for testing
  plankSizeForBay,
  sizeLabelForBay,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd osteopeinture/quote-assistant && node --test tests/scaffold-engine.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/scaffold-engine.js tests/scaffold-engine.test.js
git commit -m "feat(scaffold): per-tower component calculation with all formulas"
```

---

## Task 3: Scaffold Engine — Job-Level Aggregation

**Files:**
- Modify: `lib/scaffold-engine.js`
- Modify: `tests/scaffold-engine.test.js`

- [ ] **Step 1: Write failing test for calculateScaffold (full job)**

Append to `tests/scaffold-engine.test.js`:

```js
const { calculateScaffold } = require('../lib/scaffold-engine');

test('calculateScaffold — multi-tower job with aggregation', () => {
  const spec = {
    duration_days: 14,
    towers: [
      {
        label: 'A',
        facade: 'Front',
        frame_width: '4ft',
        bays: [7, 7],
        levels: 5,
        overhang_levels: 3,
        triangle_size: 'medium',
        sidewalk_frames: false,
        adjacent_to: null,
        duration_days: null,
      },
      {
        label: 'B',
        facade: 'Back',
        frame_width: '4ft',
        bays: [10],
        levels: 3,
        overhang_levels: 1,
        triangle_size: 'medium',
        sidewalk_frames: false,
        adjacent_to: null,
        duration_days: null,
      },
    ],
    extras: {
      harness: false,
      ladders: [{ size: '28ft', quantity: 1, rental: true }],
      custom_items: [],
    },
  };

  const result = calculateScaffold(spec);

  // Has both towers
  assert.ok(result.towers.A);
  assert.ok(result.towers.B);

  // Rental order is aggregated (not per-tower)
  assert.ok(Array.isArray(result.rental_order));
  // Should contain frames from both towers summed
  const frames = result.rental_order.find(r => r.item.startsWith('Frame'));
  assert.ok(frames);
  assert.ok(frames.qty > 0);

  // Summary has delivery, buffer, total
  assert.equal(result.summary.delivery, 200);
  assert.ok(result.summary.buffer_10pct > 0);
  assert.ok(result.summary.rental_total > 0);
  assert.equal(result.summary.period, 'weekly');

  // Pulley set included (1 per job)
  const pulley = result.rental_order.find(r => r.item === 'Pulley Set');
  assert.ok(pulley);
  assert.equal(pulley.qty, 1);

  // Rope listed separately
  const rope = result.rental_order.find(r => r.item.startsWith('Rope'));
  assert.ok(rope);
  // 5 levels max → 50ft
  assert.ok(rope.item.includes('50ft'));
});

test('calculateScaffold — rope is 100ft when any tower > 5 levels', () => {
  const spec = {
    duration_days: 7,
    towers: [
      {
        label: 'A',
        facade: 'Front',
        frame_width: '4ft',
        bays: [7],
        levels: 6,
        overhang_levels: 1,
        triangle_size: 'medium',
        sidewalk_frames: false,
        adjacent_to: null,
        duration_days: null,
      },
    ],
    extras: { harness: false, ladders: [], custom_items: [] },
  };
  const result = calculateScaffold(spec);
  const rope = result.rental_order.find(r => r.item.startsWith('Rope'));
  assert.ok(rope.item.includes('100ft'));
});

test('calculateScaffold — harness only when requested', () => {
  const specNoHarness = {
    duration_days: 7,
    towers: [{
      label: 'A', facade: 'Front', frame_width: '4ft', bays: [7],
      levels: 3, overhang_levels: 1, triangle_size: 'medium',
      sidewalk_frames: false, adjacent_to: null, duration_days: null,
    }],
    extras: { harness: false, ladders: [], custom_items: [] },
  };
  const r1 = calculateScaffold(specNoHarness);
  assert.equal(r1.rental_order.find(r => r.item === 'Safety Harness'), undefined);

  const specWithHarness = { ...specNoHarness, extras: { ...specNoHarness.extras, harness: true } };
  const r2 = calculateScaffold(specWithHarness);
  assert.ok(r2.rental_order.find(r => r.item === 'Safety Harness'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd osteopeinture/quote-assistant && node --test tests/scaffold-engine.test.js`
Expected: FAIL — `calculateScaffold is not a function`

- [ ] **Step 3: Implement calculateScaffold**

Add to `lib/scaffold-engine.js` before `module.exports`:

```js
/**
 * Calculate full scaffold job — all towers + aggregated rental order + summary.
 * @param {Object} spec - full scaffold spec JSON (see design spec)
 * @returns {Object} { towers, rental_order, summary }
 */
function calculateScaffold(spec) {
  const jobPeriod = getRatePeriod(spec.duration_days);
  const maxLevels = Math.max(...spec.towers.map(t => t.levels));

  // --- Calculate each tower ---
  const towers = {};
  for (const towerSpec of spec.towers) {
    const towerPeriod = towerSpec.duration_days
      ? getRatePeriod(towerSpec.duration_days)
      : jobPeriod;
    towers[towerSpec.label] = calculateTower(towerSpec, towerPeriod);
  }

  // --- Aggregate rental order across all towers ---
  const aggregated = {};
  for (const tower of Object.values(towers)) {
    for (const comp of tower.components) {
      const key = comp.item;
      if (!aggregated[key]) {
        aggregated[key] = { item: key, qty: 0, rate: comp.rate, period: comp.period, cost: 0 };
      }
      aggregated[key].qty += comp.qty;
      aggregated[key].cost = Math.round(aggregated[key].qty * aggregated[key].rate * 100) / 100;
    }
  }

  const rentalOrder = Object.values(aggregated);

  // --- Add job-level items ---

  // Pulley set: always 1 per job
  const pulleyRate = getRate('pulley_set', jobPeriod);
  if (pulleyRate !== null) {
    rentalOrder.push({
      item: 'Pulley Set',
      qty: 1,
      rate: pulleyRate,
      period: jobPeriod,
      cost: pulleyRate,
    });
  }

  // Rope: listed separately, included with pulley set price
  const ropeLength = maxLevels > 5 ? '100ft' : '50ft';
  rentalOrder.push({
    item: `Rope ${ropeLength}`,
    qty: 1,
    rate: 0,
    period: jobPeriod,
    cost: 0,
    note: ropeLength === '100ft'
      ? '100ft rope — pricing TBD, confirm with EMCO'
      : 'Included with pulley set rental',
  });

  // Harness: only if requested
  if (spec.extras?.harness) {
    const harnessRate = getRate('safety_harness', jobPeriod);
    if (harnessRate !== null) {
      rentalOrder.push({
        item: 'Safety Harness',
        qty: 1,
        rate: harnessRate,
        period: jobPeriod,
        cost: harnessRate,
      });
    }
  }

  // Ladders: only rental ones
  if (spec.extras?.ladders) {
    for (const ladder of spec.extras.ladders) {
      if (ladder.rental) {
        // Ladder pricing not in EMCO catalog as standard items —
        // use a placeholder rate; actual rate looked up at order time
        rentalOrder.push({
          item: `Ladder ${ladder.size}`,
          qty: ladder.quantity,
          rate: null,
          period: jobPeriod,
          cost: 0,
          note: 'Confirm rental rate with EMCO',
        });
      }
    }
  }

  // --- Summary ---
  const rentalSubtotal = rentalOrder.reduce((sum, r) => sum + (r.cost || 0), 0);
  const delivery = DELIVERY_PER_TRIP * STANDARD_TRIPS;
  const buffer = Math.round(rentalSubtotal * BUFFER_PERCENT * 100) / 100;
  const rentalTotal = Math.round((rentalSubtotal + delivery + buffer) * 100) / 100;

  return {
    towers,
    rental_order: rentalOrder,
    summary: {
      rental_subtotal: rentalSubtotal,
      delivery,
      buffer_10pct: buffer,
      rental_total: rentalTotal,
      period: jobPeriod,
    },
  };
}

module.exports = {
  EMCO_CATALOG,
  DELIVERY_PER_TRIP,
  STANDARD_TRIPS,
  BUFFER_PERCENT,
  getRate,
  getRatePeriod,
  calculateTower,
  calculateScaffold,
  plankSizeForBay,
  sizeLabelForBay,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd osteopeinture/quote-assistant && node --test tests/scaffold-engine.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/scaffold-engine.js tests/scaffold-engine.test.js
git commit -m "feat(scaffold): job-level aggregation, pulley/rope/harness/ladder handling"
```

---

## Task 4: Wire the API Endpoint

**Files:**
- Modify: `server.js` (lines ~1-20 for require, add endpoint near other API routes)

- [ ] **Step 1: Write failing test for the endpoint**

Append to `tests/scaffold-engine.test.js`:

```js
// Integration test: POST /api/scaffold/calculate
const http = require('node:http');

test('POST /api/scaffold/calculate returns valid result', async () => {
  // Import the express app
  const { app } = require('../server');

  const server = app.listen(0); // random port
  const port = server.address().port;

  const spec = {
    duration_days: 7,
    towers: [{
      label: 'A', facade: 'Front', frame_width: '4ft', bays: [7, 7],
      levels: 3, overhang_levels: 2, triangle_size: 'medium',
      sidewalk_frames: false, adjacent_to: null, duration_days: null,
    }],
    extras: { harness: false, ladders: [], custom_items: [] },
  };

  const body = JSON.stringify(spec);

  const result = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port, path: '/api/scaffold/calculate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  server.close();

  assert.equal(result.status, 200);
  assert.ok(result.body.towers.A);
  assert.ok(result.body.rental_order.length > 0);
  assert.ok(result.body.summary.rental_total > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd osteopeinture/quote-assistant && node --test tests/scaffold-engine.test.js`
Expected: FAIL — 404 or route not found

- [ ] **Step 3: Add the endpoint to server.js**

At the top of `server.js`, add the require (after line 18):

```js
const { calculateScaffold } = require('./lib/scaffold-engine');
```

Find the API routes section and add (near the other POST endpoints):

```js
// ============================================================
// SCAFFOLD CALCULATION
// ============================================================

app.post('/api/scaffold/calculate', express.json(), (req, res) => {
  try {
    const spec = req.body;
    if (!spec || !Array.isArray(spec.towers) || spec.towers.length === 0) {
      return res.status(400).json({ error: 'Invalid scaffold spec: towers array required' });
    }
    if (!spec.duration_days || spec.duration_days < 1) {
      return res.status(400).json({ error: 'Invalid scaffold spec: duration_days required (>= 1)' });
    }
    const result = calculateScaffold(spec);
    res.json(result);
  } catch (error) {
    console.error('Scaffold calculation error:', error);
    res.status(500).json({ error: 'Scaffold calculation failed' });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd osteopeinture/quote-assistant && node --test tests/scaffold-engine.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server.js tests/scaffold-engine.test.js
git commit -m "feat(scaffold): POST /api/scaffold/calculate endpoint"
```

---

## Task 5: Register calculate_scaffold as a Claude Tool

**Files:**
- Modify: `server.js` (modify `handleSessionMessage` and `buildSystemPrompt`)

- [ ] **Step 1: Define the tool schema**

Add to `server.js` after the scaffold engine require:

```js
// ============================================================
// SCAFFOLD TOOL DEFINITION (for Claude tool use)
// ============================================================

const SCAFFOLD_TOOL = {
  name: 'calculate_scaffold',
  description: 'Calculate scaffold component quantities and rental costs from a tower specification. Call this when you have confirmed all tower dimensions, overhang levels, triangle sizes, and rental duration with the user.',
  input_schema: {
    type: 'object',
    required: ['duration_days', 'towers'],
    properties: {
      duration_days: {
        type: 'integer',
        description: 'Total rental duration in days. Determines rate tier: 1-2=daily, 3-14=weekly, >14=monthly.',
      },
      towers: {
        type: 'array',
        description: 'Array of tower specifications. Each tower is a non-contiguous scaffold structure.',
        items: {
          type: 'object',
          required: ['label', 'facade', 'bays', 'levels', 'overhang_levels', 'triangle_size'],
          properties: {
            label: { type: 'string', description: 'Tower label: A, B, C, ...' },
            facade: { type: 'string', description: 'Facade location: Front, Back, Left, Right, etc.' },
            frame_width: { type: 'string', enum: ['4ft', '5ft', '30in'], default: '4ft', description: 'Frame width. Default 4ft. Auto-set to 5ft if sidewalk_frames is true.' },
            bays: { type: 'array', items: { type: 'integer', enum: [7, 10] }, description: 'Array of bay widths in feet, left to right. E.g. [7, 7, 10] = 3 bays.' },
            levels: { type: 'integer', description: 'Number of levels (each level = 5ft height).' },
            overhang_levels: { type: 'integer', description: 'Number of overhang levels. 0 = no overhangs.' },
            triangle_size: { type: 'string', enum: ['small', 'medium', 'large'], description: 'Triangle (overhang bracket) size: small=20in, medium=24in, large=36in.' },
            sidewalk_frames: { type: 'boolean', default: false, description: 'If true, ground-level frames are sidewalk frames (forces 5ft wide).' },
            adjacent_to: { type: ['string', 'null'], default: null, description: 'Reserved for V2. Always null.' },
            duration_days: { type: ['integer', 'null'], default: null, description: 'Per-tower duration override. Null = use job-level duration.' },
            notes: { type: 'string', default: '', description: 'Free-text notes for this tower.' },
          },
        },
      },
      extras: {
        type: 'object',
        properties: {
          harness: { type: 'boolean', default: false, description: 'Include safety harness. Only if user explicitly requests.' },
          ladders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                size: { type: 'string', description: 'Ladder size, e.g. "28ft"' },
                quantity: { type: 'integer' },
                rental: { type: 'boolean', description: 'true=rental (included in order), false=owned (excluded)' },
              },
            },
            default: [],
          },
          custom_items: { type: 'array', items: { type: 'object' }, default: [] },
        },
      },
    },
  },
};
```

- [ ] **Step 2: Modify the Claude API call to include tools for exterior sessions**

In `handleSessionMessage` (around line 1755), modify the `anthropic.messages.create` call:

```js
    // Determine if scaffold tool should be available
    // Check conversation history for exterior indicators
    const conversationText = session.messages
      .map(m => typeof m.content === 'string' ? m.content : '')
      .join(' ')
      .toLowerCase();
    const isExteriorSession = conversationText.includes('exterior')
      || conversationText.includes('scaffold')
      || conversationText.includes('facade')
      || conversationText.includes('façade')
      || userText.toLowerCase().includes('exterior')
      || userText.toLowerCase().includes('scaffold');

    const apiParams = {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages,
    };

    if (isExteriorSession) {
      apiParams.tools = [SCAFFOLD_TOOL];
    }

    let response = await anthropic.messages.create(apiParams);
```

- [ ] **Step 3: Add tool use handling loop**

After the initial `anthropic.messages.create` call, add a loop to handle tool use:

```js
    // Handle tool use loop — Claude may call calculate_scaffold
    let assistantContent = response.content;
    while (response.stop_reason === 'tool_use') {
      const toolBlock = assistantContent.find(b => b.type === 'tool_use');
      if (!toolBlock || toolBlock.name !== 'calculate_scaffold') break;

      // Execute the scaffold calculation
      let toolResult;
      try {
        toolResult = calculateScaffold(toolBlock.input);
      } catch (err) {
        toolResult = { error: err.message };
      }

      // Add assistant message with tool use + tool result
      messages.push({ role: 'assistant', content: assistantContent });
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(toolResult),
        }],
      });

      // Continue the conversation so Claude can present the results
      response = await anthropic.messages.create({
        ...apiParams,
        messages,
      });
      assistantContent = response.content;
    }

    const assistantText = extractTextContent(assistantContent);
```

Remove the old `const assistantText = extractTextContent(response.content);` line that this replaces.

- [ ] **Step 4: Run existing tests to verify nothing broke**

Run: `cd osteopeinture/quote-assistant && node --test tests/*.test.js`
Expected: All existing tests still PASS

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(scaffold): register calculate_scaffold tool for Claude, add tool use loop"
```

---

## Task 6: Add §30-34 to QUOTING_LOGIC.md

**Files:**
- Modify: `QUOTING_LOGIC.md`

- [ ] **Step 1: Append scaffold sections after §29**

Add at the end of `QUOTING_LOGIC.md` (after line 727):

```markdown

---
---
# ██████████████████████████████████████████████████████
# ██                                                  ██
# ██         SCAFFOLD & ACCESS QUOTING LOGIC          ██
# ██                                                  ██
# ██████████████████████████████████████████████████████

## §30 — SCAFFOLD ACCESS OVERVIEW

Exterior jobs require access equipment. Three options, in order of preference:
1. **Ladders** — for low work (≤17ft with owned 21ft ladder) or isolated spots
2. **Scaffold** — for sustained work on facades, when multiple workers need simultaneous access
3. **Lifts** — for very high work or limited ground access (GAMMA pricing TBD)

Always itemize scaffold/access separately from painting work in the quote.

### When to suggest scaffold vs ladder
- **Ladder only:** Work height ≤17ft, small isolated areas, touch-ups
- **Scaffold:** Work height >17ft, wide facades needing sustained access, multiple workers
- **Ladder + scaffold combo:** Common — scaffold on main facades, ladder for returns/small sections

### Terminology
- **Tower** — standalone non-contiguous scaffold structure. Label: A, B, C...
- **Bay** — one section within a contiguous tower. First bay = 2 frames/level, each additional = +1 frame/level
- **Level** — 5ft of height (standard frame height)
- **Frame** — H-shaped vertical piece. Default 4ft wide (lighter). 5ft wide only when sidewalk or half-height frames needed.
- **Overhang level** — platform extending outside the scaffold structure for working access. Standard spacing: start at highest work point −5ft, then every 6ft down.
- **Triangle** — overhang bracket. Small (20"), Medium (24"), Large (36").

### Tower layout notation
Always present tower layouts visually:
```
FRONT Facade
Tower A  →  | 7 | 7 | 7 |    3 bays, 5 levels (25ft), 2 overhang levels

BACK Facade
Tower B  →  | 10 | 10 |       2 bays, 4 levels (20ft), 1 overhang level
```

## §31 — SCAFFOLD COMPONENT FORMULAS

You have a `calculate_scaffold` tool. Call it once all inputs are confirmed. The formulas below are for your understanding — use them to explain results and sanity-check, but always defer to the tool for actual numbers.

Given: B = num_bays, L = levels, OVH = overhang_levels, F = frames_per_level = B + 1

| Component | Formula | Notes |
|---|---|---|
| Frames | F × L | frame_width × 5ft |
| Sidewalk frames | F (ground level only) | If flagged — forces 5ft wide, replaces ground-level frames |
| Adjustable feet | 2 × F | Ground level only, 2 per frame |
| Cross braces | (2 × B − 1) × L | Sized per bay width (7ft or 10ft) |
| Platforms | OVH × B × 2 | Per bay width (7ft or 10ft), overhang levels only |
| Planks | B × L | 8ft for 7ft bays, 12ft for 10ft bays |
| Triangles | OVH × F | 1 per frame per overhang level |
| Tie-ins | tie_in_levels × B | tie_in_levels = FLOOR((height−15)/10)+1 when height ≥ 15ft |
| Bananas | 2 × F × 2 | Top 2 levels, 2 per frame |
| Pulley set | 1 per job | Always included |
| Rope | 1 per job | 50ft if ≤5 levels, 100ft if >5 — always specify length |

### Key rules
- Frame width is per tower (all frames must match within a tower)
- Default frame width: 4ft (lighter, preferred)
- 5ft wide only when: half-height frames or sidewalk frames needed
- Never auto-include harness — only if user asks
- Always confirm overhang levels, triangle size, and duration before calling the tool

## §32 — EMCO 2025 RENTAL CATALOG

Primary supplier: EMCO Machinery, Montreal (514-270-7101)
Prices CAD, exclude tax. Weekly = 7 days, Monthly = 28 days.

| Component | Weekly | Monthly |
|---|---|---|
| Frame (4ft/5ft/30in × 5ft) | $4 | $8 |
| Half-Height Frame (5ft × 3ft) | $4 | $8 |
| Cross Brace (5ft/7ft/10ft) | $3 | $6 |
| Sidewalk Frame (5ft only) | $5 | $10 |
| Plank (8ft/12ft) | $6 | $12 |
| Platform (7ft/10ft) | $12 | $24 |
| Triangle (S/M/L) | $4 | $8 |
| Adjustable Foot | $4 | $8 |
| Pulley Set (incl. 50ft rope) | $40 | $75 |
| Banana | $0.75 | $1.50 |
| Tie-In (anchoring arm) | $6 | $15 |
| Safety Harness | $35 | $60 |

**Delivery:** $100/trip, standard 2 trips (deliver + pickup) = $200
**Buffer:** Add 10% to rental subtotal for contingency
**Duration tiers:** 1-2 days = daily, 3-14 days = weekly, >14 days = monthly

## §33 — LADDERS

| Ladder | Vertical Reach | Owned/Rented | Transport |
|---|---|---|---|
| 21ft | ~17ft | Owned | Roof rack |
| 24ft | ~20ft | Rent (EMCO) | Roof rack |
| 28ft | ~24ft | Rent (EMCO) | Roof rack (max carry) |
| 32ft | ~27ft | Rent (EMCO) | Needs delivery — bundle with scaffold |
| 36ft+ | ~30ft+ | Rent (EMCO) | Needs delivery — bundle with scaffold |

The owned 21ft ladder is NOT included in rental orders.
32ft+ ladders need EMCO delivery — add to scaffold delivery if applicable.

## §34 — SCAFFOLD LABOR

No standard benchmarks yet — estimator provides hours per tower.

**Phases:**
1. Receiving delivery (unload, sort)
2. Level 1 setup (level, plumb, square — slowest phase, terrain-dependent)
3. Upper levels (relatively fast once base is solid)
4. Stabilization (tie-ins, anchoring — above 15ft)
5. Tear down (~half of setup time)
6. Pack out (load for pickup)

**Terrain factors:** flat = fast, sloped = moderate, uneven/bushes = slow, obstacles = slow.

Wage rate: confirm with estimator (typically $50/h or $60/h).
Labor total = hours × rate. Add as a separate line item in the exterior quote.
Do NOT calculate labor hours — only the estimator sets hours for scaffold.
```

- [ ] **Step 2: Bump the version header**

Change line 4 from:
```
# Version: v2 — corrected wall benchmark (0.25 min/sqft), added §3A/3B/3C, rewrote §4, restored §16 TAXES, rewrote §20
```
to:
```
# Version: v3 — added §30-34 scaffold access quoting (EMCO catalog, component formulas, ladder table, labor phases)
```

- [ ] **Step 3: Measure token count**

Run: `wc -c osteopeinture/quote-assistant/QUOTING_LOGIC.md`

If the file exceeds ~40KB, trim the EMCO catalog in §32 to scaffold-relevant items only (drop rolling towers, foldable interior scaffolds, transport carts, stairways, rope clamps, extension angles — keep only what the formulas reference).

- [ ] **Step 4: Commit**

```bash
git add QUOTING_LOGIC.md
git commit -m "feat(scaffold): add §30-34 scaffold/access quoting logic, bump to v3"
```

---

## Task 7: End-to-End Smoke Test

**Files:**
- No new files — manual testing

- [ ] **Step 1: Run all unit tests**

Run: `cd osteopeinture/quote-assistant && node --test tests/*.test.js`
Expected: All tests PASS

- [ ] **Step 2: Test the API endpoint directly**

Run:
```bash
cd osteopeinture/quote-assistant && node -e "
const { calculateScaffold } = require('./lib/scaffold-engine');
const result = calculateScaffold({
  duration_days: 14,
  towers: [
    { label: 'A', facade: 'Front', frame_width: '4ft', bays: [7,7,7], levels: 5, overhang_levels: 3, triangle_size: 'medium', sidewalk_frames: false, adjacent_to: null, duration_days: null },
    { label: 'B', facade: 'Back', frame_width: '4ft', bays: [10,10], levels: 4, overhang_levels: 1, triangle_size: 'large', sidewalk_frames: false, adjacent_to: null, duration_days: null },
  ],
  extras: { harness: false, ladders: [{size: '28ft', quantity: 1, rental: true}], custom_items: [] },
});
console.log('Tower A rental:', result.towers.A.tower_rental);
console.log('Tower B rental:', result.towers.B.tower_rental);
console.log('Total items in order:', result.rental_order.length);
console.log('Rental total:', result.summary.rental_total);
console.log('Period:', result.summary.period);
"
```

Expected: Numbers print without errors. Verify manually:
- Tower A (3×7ft, 5 levels, 3 OVH): frames=20, braces=25, platforms=18, planks=15, triangles=12
- Tower B (2×10ft, 4 levels, 1 OVH): frames=12, braces=12, platforms=4, planks=8, triangles=3

- [ ] **Step 3: Verify system prompt token budget**

Run:
```bash
wc -c osteopeinture/quote-assistant/QUOTING_LOGIC.md
```

If under 40KB (~10K tokens), proceed. If over, trim §32 catalog as noted in Task 6.

- [ ] **Step 4: Final commit with platform formula fix**

```bash
git add -A
git commit -m "chore(scaffold): platform formula fix (OVH × B × 2, no +1)"
```

---

## Summary

| Task | What it builds | Test coverage |
|---|---|---|
| 1 | EMCO catalog + price lookup | 7 unit tests |
| 2 | Per-tower component calculation | 4 unit tests (uniform, no-overhang, sidewalk, mixed-bay) |
| 3 | Job-level aggregation + extras | 3 unit tests (multi-tower, rope length, harness) |
| 4 | API endpoint | 1 integration test |
| 5 | Claude tool registration + tool use loop | Covered by existing message tests + manual |
| 6 | QUOTING_LOGIC.md §30-34 | Token count check |
| 7 | End-to-end smoke test | Manual verification |
