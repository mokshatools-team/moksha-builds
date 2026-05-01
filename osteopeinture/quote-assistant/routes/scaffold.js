'use strict';
const express = require('express');
const router = express.Router();

// Dependencies injected via init
let calculateScaffold;

function init(deps) {
  calculateScaffold = deps.calculateScaffold;
}

router.post('/api/scaffold/calculate', express.json(), async (req, res) => {
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

module.exports = { router, init };
