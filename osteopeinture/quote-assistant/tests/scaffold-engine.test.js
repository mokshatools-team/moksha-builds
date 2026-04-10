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
    label: 'B', facade: 'Back', frame_width: '4ft', bays: [10],
    levels: 2, overhang_levels: 0, triangle_size: 'medium', sidewalk_frames: false,
  };
  const result = calculateTower(tower, 'weekly');
  assert.equal(result.components.find(c => c.item === 'Frame 4ft×5ft').qty, 4);
  assert.equal(result.components.find(c => c.item === 'Cross Brace 10ft').qty, 2);
  assert.equal(result.components.find(c => c.item?.startsWith('Platform')), undefined);
  assert.equal(result.components.find(c => c.item === 'Plank 12ft').qty, 2);
  assert.equal(result.components.find(c => c.item?.startsWith('Triangle')), undefined);
  assert.equal(result.components.find(c => c.item === 'Tie-In'), undefined);
  assert.equal(result.components.find(c => c.item === 'Banana').qty, 8);
});

test('calculateTower — sidewalk frames force 5ft width', () => {
  const tower = {
    label: 'C', facade: 'Side', frame_width: '4ft', bays: [7],
    levels: 3, overhang_levels: 1, triangle_size: 'small', sidewalk_frames: true,
  };
  const result = calculateTower(tower, 'weekly');
  assert.equal(result.components.find(c => c.item === 'Sidewalk Frame 5ft').qty, 2);
  assert.equal(result.components.find(c => c.item === 'Frame 5ft×5ft').qty, 4);
});

test('calculateTower — mixed bay widths', () => {
  const tower = {
    label: 'D', facade: 'Front', frame_width: '4ft', bays: [10, 7, 7],
    levels: 4, overhang_levels: 2, triangle_size: 'large', sidewalk_frames: false,
  };
  const result = calculateTower(tower, 'weekly');
  const brace7 = result.components.find(c => c.item === 'Cross Brace 7ft');
  const brace10 = result.components.find(c => c.item === 'Cross Brace 10ft');
  assert.equal((brace7?.qty || 0) + (brace10?.qty || 0), 20);
  const plat7 = result.components.find(c => c.item === 'Platform 7ft');
  const plat10 = result.components.find(c => c.item === 'Platform 10ft');
  assert.equal((plat7?.qty || 0) + (plat10?.qty || 0), 12);
});
