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
