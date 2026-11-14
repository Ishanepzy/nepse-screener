import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Anchors, addSessions, cleanDrawings, fibExtPrice, fibPrice, migrateV1, positionOutcome, positionStats, roundPrice, sessionsBetween } from './drawings.ts';

test('sessions run Monday to Friday since April 2026, Sunday to Thursday before', () => {
  // 2026-11-12 is a Thursday, the 13th a Friday, the 16th a Monday
  assert.equal(addSessions('2026-11-12', 1), '2026-11-13');
  assert.equal(addSessions('2026-11-13', 1), '2026-11-16');
  assert.equal(addSessions('2026-11-16', -1), '2026-11-13');
  assert.equal(addSessions('2026-11-10', 5), '2026-11-17');
  assert.equal(sessionsBetween('2026-11-13', '2026-11-16'), 1);
  assert.equal(sessionsBetween('2026-11-10', '2026-11-17'), 5);
  assert.equal(sessionsBetween('2026-11-17', '2026-11-10'), 0);
  // the old week: Thursday 12 March 2026 was followed by Sunday the 15th
  assert.equal(addSessions('2026-03-12', 1), '2026-03-15');
});

test('anchors round-trip inside the data, past its end and on a day the stock skipped', () => {
  const dates = ['2026-11-08', '2026-11-09', '2026-11-11', '2026-11-12']; // no trade on the 10th
  const a = new Anchors(dates);
  assert.equal(a.toLogical(a.fromLogical(2, 100)), 2);
  // future: three sessions after the last bar
  const future = a.fromLogical(6, 100);
  assert.deepEqual(future, { d: '2026-11-12', o: 3, p: 100 });
  assert.equal(a.toLogical(future), 6);
  assert.equal(a.dateAt(6), '2026-11-17');
  // a date the stock didn't trade lands on the next bar
  assert.equal(a.toLogical({ d: '2026-11-10', o: 0, p: 1 }), 2);
  // a date past the data that no bar carries
  assert.equal(a.toLogical({ d: '2026-11-17', o: 0, p: 1 }), 6);
  // a date older than the data window
  assert.equal(a.toLogical({ d: '2026-11-05', o: 0, p: 1 }), -1);
});

test('a future point stays on its date when a new bar arrives', () => {
  const before = new Anchors(['2026-11-11', '2026-11-12']);
  const anchor = before.fromLogical(3, 50); // two sessions past the 12th: the 16th
  assert.equal(before.dateAt(3), '2026-11-16');
  const after = new Anchors(['2026-11-11', '2026-11-12', '2026-11-13']);
  assert.equal(after.dateAt(after.toLogical(anchor)!), '2026-11-16');
});

test('prices keep six significant digits, so a ratio panel keeps its decimals', () => {
  assert.equal(roundPrice(0.123456789), 0.123457);
  assert.equal(roundPrice(1234.5678), 1234.57);
});

test('first-version drawings move over, rays become extended lines', () => {
  const a = { d: '2026-11-08', o: 0, p: 10 };
  const b = { d: '2026-11-09', o: 0, p: 12 };
  const out = migrateV1({
    NABIL: [
      { id: 'x1', type: 'trend', a, b },
      { id: 'x2', type: 'ray', a, b },
      { id: 'x3', type: 'hline', a },
      { id: 'x4', type: 'nonsense', a },
      { id: 'x5', type: 'rect', a: { d: 1 }, b },
    ],
    EMPTY: [],
  });
  assert.deepEqual(Object.keys(out), ['NABIL']);
  assert.deepEqual(
    out.NABIL.map((d) => [d.id, d.type, d.pane, d.pts.length, d.style]),
    [
      ['x1', 'line', 'price', 2, {}],
      ['x2', 'line', 'price', 2, { ext: [false, true] }],
      ['x3', 'hline', 'price', 1, {}],
    ],
  );
});

test('cleanDrawings drops malformed entries', () => {
  const pt = { d: '2026-11-08', o: 0, p: 1 };
  const good = { id: 'a', type: 'line', pane: 'price', pts: [pt, pt], style: {} };
  const list = cleanDrawings([good, { ...good, pts: [pt] }, { ...good, type: 'blob' }, { ...good, pane: 3 }, null, 'x']);
  assert.deepEqual(
    list.map((d) => d.id),
    ['a'],
  );
  assert.deepEqual(cleanDrawings({}), []);
});

test('fib levels: retracement from the second point, extension from the third', () => {
  // low 100 then high 200: level 0 is the high, 0.5 halfway, 1 the low
  assert.equal(fibPrice(100, 200, 0), 200);
  assert.equal(fibPrice(100, 200, 0.5), 150);
  assert.equal(fibPrice(100, 200, 1), 100);
  // a 100-point move from 100 to 200, pullback to 150: 1.0 projects to 250
  assert.equal(fibExtPrice(100, 200, 150, 1), 250);
  assert.ok(Math.abs(fibExtPrice(100, 200, 150, 1.618) - 311.8) < 1e-9);
});

test('position: reward / risk and which level was reached first', () => {
  const s = positionStats(100, 110, 95);
  assert.equal(s.ratio, 2);
  assert.equal(Math.round(s.targetPct), 10);
  assert.equal(Math.round(s.stopPct), -5);
  assert.equal(positionStats(100, 110, 100).ratio, null);

  const bars = { h: [101, 104, 111, 120], l: [99, 98, 103, 100] };
  assert.deepEqual(positionOutcome(bars, 0, 3, 'long', 110, 95), { hit: 'target', at: 2 });
  // a stop at 98 is touched first, on bar 1
  assert.deepEqual(positionOutcome(bars, 0, 3, 'long', 110, 98), { hit: 'stop', at: 1 });
  // the box ends before the target bar
  assert.equal(positionOutcome(bars, 0, 1, 'long', 110, 95), null);
  // short: target below, stop above
  assert.deepEqual(positionOutcome({ h: [101, 102, 99], l: [99, 96, 90] }, 0, 2, 'short', 95, 105), { hit: 'target', at: 2 });
  // a bar that reaches both counts as stopped out
  assert.deepEqual(positionOutcome({ h: [100, 112], l: [100, 94] }, 0, 1, 'long', 110, 95), { hit: 'stop', at: 1 });
});
