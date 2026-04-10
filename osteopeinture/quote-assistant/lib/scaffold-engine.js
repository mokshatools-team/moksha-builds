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

module.exports = {
  EMCO_CATALOG,
  DELIVERY_PER_TRIP,
  STANDARD_TRIPS,
  BUFFER_PERCENT,
  getRate,
  getRatePeriod,
};
