// lib/scaffold-engine.js
'use strict';

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

function getRate(component, period) {
  const entry = EMCO_CATALOG[component];
  if (!entry) return null;
  return entry[period] ?? null;
}

function getRatePeriod(days) {
  if (days <= 2) return 'daily';
  if (days <= 14) return 'weekly';
  return 'monthly';
}

// ---------------------------------------------------------------------------
// Tower component calculation
// ---------------------------------------------------------------------------

// Map bay width (ft) → plank size label
const PLANK_SIZE = { 7: '8ft', 10: '12ft' };

// Map bay width (ft) → catalog key for cross brace
const BRACE_CATALOG_KEY = 'cross_brace';

// Resolve the frame size label given width and sidewalk_frames flag
function _frameLabel(widthFt) {
  return `Frame ${widthFt}ft×5ft`;
}

// Add or accumulate a component entry into the map keyed by item name
function _addComponent(map, item, qty, rate, period) {
  if (qty <= 0) return;
  if (map[item]) {
    map[item].qty += qty;
    map[item].cost += qty * rate;
  } else {
    map[item] = { item, qty, rate, period, cost: qty * rate };
  }
}

/**
 * Calculate all components for a single scaffold tower.
 *
 * @param {Object} tower
 * @param {string} tower.label          - tower identifier (e.g. 'A')
 * @param {string} tower.facade         - e.g. 'Front'
 * @param {string} tower.frame_width    - '4ft' or '5ft'
 * @param {number[]} tower.bays         - array of bay widths in ft, e.g. [7, 7]
 * @param {number} tower.levels         - number of levels (each level = 5ft)
 * @param {number} tower.overhang_levels - number of overhang levels
 * @param {string} tower.triangle_size  - 'small' | 'medium' | 'large'
 * @param {boolean} tower.sidewalk_frames - if true, ground level uses Sidewalk Frame 5ft
 * @param {string} period               - 'daily' | 'weekly' | 'monthly'
 * @returns {{ label, facade, layout, components, tower_rental }}
 */
function calculateTower(tower, period) {
  const {
    label,
    facade,
    frame_width,
    bays,
    levels,
    overhang_levels,
    triangle_size,
    sidewalk_frames,
  } = tower;

  const B = bays.length;
  const L = levels;
  const OVH = overhang_levels;
  const heightFt = L * 5;

  // Effective frame width: sidewalk_frames forces 5ft
  const effectiveWidth = sidewalk_frames ? '5ft' : frame_width;
  const numericWidth = parseInt(effectiveWidth, 10); // 4 or 5

  // Component accumulator map (keyed by item name)
  const map = {};

  // ── Frames ──────────────────────────────────────────────────────────────
  // Total frames: (B+1) × L
  const totalFrames = (B + 1) * L;

  if (sidewalk_frames) {
    // Ground level (level 0): (B+1) sidewalk frames
    const groundFrameCount = B + 1;
    const sidewalkRate = getRate('sidewalk_frame', period) ?? 0;
    _addComponent(map, 'Sidewalk Frame 5ft', groundFrameCount, sidewalkRate, period);

    // Upper levels: (B+1) × (L-1) standard 5ft frames
    const upperFrameCount = (B + 1) * (L - 1);
    const frameRate = getRate('frame', period) ?? 0;
    _addComponent(map, 'Frame 5ft×5ft', upperFrameCount, frameRate, period);
  } else {
    const frameRate = getRate('frame', period) ?? 0;
    _addComponent(map, _frameLabel(numericWidth), totalFrames, frameRate, period);
  }

  // ── Adjustable Feet ─────────────────────────────────────────────────────
  // Ground level frames only: 2 per frame column = 2 × (B+1)
  const feetCount = 2 * (B + 1);
  const feetRate = getRate('adjustable_foot', period) ?? 0;
  _addComponent(map, 'Adjustable Foot', feetCount, feetRate, period);

  // ── Cross Braces ────────────────────────────────────────────────────────
  // Total: (2B-1) × L
  // Distribution: bay[0] gets 1 brace per level, all other bays get 2 per level
  // This naturally sums to (1 + 2×(B-1)) × L = (2B-1) × L
  const braceRate = getRate(BRACE_CATALOG_KEY, period) ?? 0;
  bays.forEach((bayW, idx) => {
    const braceMultiplier = idx === 0 ? 1 : 2;
    const qty = braceMultiplier * L;
    const item = `Cross Brace ${bayW}ft`;
    _addComponent(map, item, qty, braceRate, period);
  });

  // ── Platforms ───────────────────────────────────────────────────────────
  // Only on overhang levels: OVH × B × 2, sized per bay
  if (OVH > 0) {
    const platformRate = getRate('platform', period) ?? 0;
    bays.forEach((bayW) => {
      const qty = OVH * 2; // 2 platforms per bay per overhang level
      const item = `Platform ${bayW}ft`;
      _addComponent(map, item, qty, platformRate, period);
    });
  }

  // ── Planks ──────────────────────────────────────────────────────────────
  // B × L, sized per bay (8ft for 7ft bay, 12ft for 10ft bay)
  const plankRate = getRate('plank', period) ?? 0;
  bays.forEach((bayW) => {
    const plankSize = PLANK_SIZE[bayW] ?? `${bayW + 1}ft`;
    const item = `Plank ${plankSize}`;
    _addComponent(map, item, L, plankRate, period);
  });

  // ── Triangles ───────────────────────────────────────────────────────────
  // OVH × (B+1) — per frame column per overhang level
  if (OVH > 0) {
    const triangleRate = getRate('triangle', period) ?? 0;
    const capSize = triangle_size.charAt(0).toUpperCase() + triangle_size.slice(1);
    const item = `Triangle ${capSize}`;
    const qty = OVH * (B + 1);
    _addComponent(map, item, qty, triangleRate, period);
  }

  // ── Tie-ins ─────────────────────────────────────────────────────────────
  // Required when height >= 15ft
  // tie_in_levels = FLOOR((height - 15) / 10) + 1
  // Total tie-ins = tie_in_levels × B
  if (heightFt >= 15) {
    const tieInLevels = Math.floor((heightFt - 15) / 10) + 1;
    const qty = tieInLevels * B;
    const tieInRate = getRate('tie_in', period) ?? 0;
    _addComponent(map, 'Tie-In', qty, tieInRate, period);
  }

  // ── Bananas ─────────────────────────────────────────────────────────────
  // 2 × (B+1) × min(2, L) — top 2 levels, 2 per frame column
  const bananaLevels = Math.min(2, L);
  const bananaQty = 2 * (B + 1) * bananaLevels;
  const bananaRate = getRate('banana', period) ?? 0;
  _addComponent(map, 'Banana', bananaQty, bananaRate, period);

  // ── Assemble result ─────────────────────────────────────────────────────
  const components = Object.values(map);
  const tower_rental = components.reduce((sum, c) => sum + c.cost, 0);

  return {
    label,
    facade,
    layout: bays,
    components,
    tower_rental,
  };
}

// ---------------------------------------------------------------------------
// Job-level aggregation
// ---------------------------------------------------------------------------

/**
 * Calculate a full scaffold job across all towers, aggregate rental order,
 * and produce a job-level summary.
 *
 * @param {Object} spec
 * @param {number} spec.duration_days      - Job duration used to determine pricing period
 * @param {Object[]} spec.towers           - Array of tower definitions (see calculateTower)
 * @param {Object} spec.extras
 * @param {boolean} spec.extras.harness    - Include safety harness?
 * @param {Object[]} spec.extras.ladders   - Array of { size, quantity, rental }
 * @param {Object[]} spec.extras.custom_items - Custom line items (ignored here)
 * @returns {{ towers, rental_order, summary }}
 */
function calculateScaffold(spec) {
  const { duration_days, towers, extras } = spec;

  // 1. Determine job-level pricing period
  const period = getRatePeriod(duration_days);

  // 2. Find max levels across all towers (determines rope length)
  const maxLevels = Math.max(...towers.map(t => t.levels));
  const ropeLength = maxLevels > 5 ? '100ft' : '50ft';

  // 3. Calculate each tower (use per-tower duration_days override if provided)
  const towerResults = {};
  for (const tower of towers) {
    const towerPeriod = tower.duration_days != null
      ? getRatePeriod(tower.duration_days)
      : period;
    towerResults[tower.label] = calculateTower(tower, towerPeriod);
  }

  // 4. Aggregate all tower components into a single map (sum same item names)
  const aggregateMap = {};
  for (const tResult of Object.values(towerResults)) {
    for (const comp of tResult.components) {
      if (aggregateMap[comp.item]) {
        aggregateMap[comp.item].qty += comp.qty;
        aggregateMap[comp.item].cost += comp.cost;
      } else {
        aggregateMap[comp.item] = { ...comp };
      }
    }
  }

  const rental_order = Object.values(aggregateMap);

  // 5. Add job-level items

  // Pulley Set — always 1
  const pulleyRate = getRate('pulley_set', period) ?? 0;
  rental_order.push({
    item: 'Pulley Set',
    qty: 1,
    rate: pulleyRate,
    period,
    cost: pulleyRate,
  });

  // Rope — always 1, cost = 0, note depends on length
  const ropeNote = ropeLength === '100ft'
    ? 'pricing TBD, confirm with EMCO'
    : null;
  rental_order.push({
    item: `Rope ${ropeLength}`,
    qty: 1,
    rate: null,
    period,
    cost: 0,
    ...(ropeNote ? { note: ropeNote } : {}),
  });

  // Safety Harness — only if requested
  if (extras.harness === true) {
    const harnessRate = getRate('safety_harness', period) ?? 0;
    rental_order.push({
      item: 'Safety Harness',
      qty: 1,
      rate: harnessRate,
      period,
      cost: harnessRate,
    });
  }

  // Ladders — only rental ones
  for (const ladder of (extras.ladders ?? [])) {
    if (ladder.rental) {
      rental_order.push({
        item: `Ladder ${ladder.size}`,
        qty: ladder.quantity,
        rate: null,
        period,
        cost: 0,
        note: 'Confirm rental rate with EMCO',
      });
    }
  }

  // 6. Summary
  const rental_subtotal = rental_order.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const delivery = DELIVERY_PER_TRIP * STANDARD_TRIPS; // $200
  const buffer_10pct = Math.round(rental_subtotal * BUFFER_PERCENT * 100) / 100;
  const rental_total = rental_subtotal + delivery + buffer_10pct;

  return {
    towers: towerResults,
    rental_order,
    summary: {
      rental_subtotal,
      delivery,
      buffer_10pct,
      rental_total,
      period,
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
};
