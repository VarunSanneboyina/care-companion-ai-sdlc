const test = require('node:test');
const assert = require('node:assert');
const L = require('../docs/logic.js');

// Acceptance criteria from intent.md v1.0
test('HbA1c inside 3.0 to 20.0 is accepted', () => {
  assert.strictEqual(L.validateHbA1c('7.4').ok, true);
  assert.strictEqual(L.validateHbA1c(3.0).ok, true);
  assert.strictEqual(L.validateHbA1c(20.0).ok, true);
});
test('HbA1c outside 3.0 to 20.0 is rejected', () => {
  assert.strictEqual(L.validateHbA1c(2.9).ok, false);
  assert.strictEqual(L.validateHbA1c(20.1).ok, false);
  assert.strictEqual(L.validateHbA1c('abc').ok, false);
  assert.strictEqual(L.validateHbA1c('').ok, false);
});
test('a submitted reading appears immediately as the latest', () => {
  const p = { name: 'T', readings: [{ a1c: 7, date: '2026-01-01' }] };
  assert.strictEqual(L.addReading(p, '8.5', '2026-02-01').ok, true);
  assert.strictEqual(L.latest(p).a1c, 8.5);
});
test('an invalid reading is not stored', () => {
  const p = { name: 'T', readings: [{ a1c: 7, date: '2026-01-01' }] };
  assert.strictEqual(L.addReading(p, '25', '2026-02-01').ok, false);
  assert.strictEqual(p.readings.length, 1);
});
test('status is judged against the configured target', () => {
  assert.strictEqual(L.a1cStatus(L.CONFIG.a1cTarget), 'At or below target');
  assert.strictEqual(L.a1cStatus(L.CONFIG.a1cTarget + 0.1), 'Above target');
});
test('search filters by name, case-insensitive', () => {
  const l = [{ name: 'Asha', readings: [{ a1c: 7, date: 'x' }] }, { name: 'Ravi', readings: [{ a1c: 6, date: 'x' }] }];
  assert.deepStrictEqual(L.filterPatients(l, 'ASH').map(p => p.name), ['Asha']);
  assert.strictEqual(L.filterPatients(l, '').length, 2);
});
test('sort orders by latest HbA1c', () => {
  const l = [{ name: 'A', readings: [{ a1c: 7, date: 'x' }] }, { name: 'B', readings: [{ a1c: 9, date: 'x' }] }];
  assert.strictEqual(L.sortByLatest(l, 'desc')[0].name, 'B');
  assert.strictEqual(L.sortByLatest(l, 'asc')[0].name, 'A');
});
