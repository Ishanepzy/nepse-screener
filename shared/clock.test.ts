import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketMayBeOpen, nepalNow, parseFeedStamp, sessionState } from './clock.ts';

// Nepal wall-clock time to a UTC timestamp
const npt = (date: string, time: string) => Date.parse(`${date}T${time}:00+05:45`);

test('nepalNow', () => {
  assert.deepEqual(nepalNow(Date.parse('2026-11-05T18:30:00Z')), { day: 5, minutes: 15, date: '2026-11-06' });
  assert.equal(nepalNow(npt('2026-11-06', '15:00')).minutes, 15 * 60);
});

test('market hours: 10:30 to 15:15, not on Saturday', () => {
  assert.equal(marketMayBeOpen(npt('2026-11-06', '10:29')), false);
  assert.equal(marketMayBeOpen(npt('2026-11-06', '10:30')), true);
  assert.equal(marketMayBeOpen(npt('2026-11-06', '15:15')), true);
  assert.equal(marketMayBeOpen(npt('2026-11-06', '15:16')), false);
  assert.equal(marketMayBeOpen(npt('2026-11-07', '12:00')), false); // Saturday
  assert.equal(marketMayBeOpen(npt('2026-11-08', '12:00')), true); // Sunday stays in
});

test('feed stamps have no AM/PM', () => {
  assert.deepEqual(parseFeedStamp('2026/11/06 11:01:00'), { date: '2026-11-06', time: '11:01' });
  assert.deepEqual(parseFeedStamp('2026/11/06 12:30:00'), { date: '2026-11-06', time: '12:30' });
  assert.deepEqual(parseFeedStamp('2026/11/06 01:05:00'), { date: '2026-11-06', time: '13:05' });
  assert.deepEqual(parseFeedStamp('2026/11/05 03:00:00'), { date: '2026-11-05', time: '15:00' });
  assert.equal(parseFeedStamp('soon'), null);
  assert.equal(parseFeedStamp(undefined), null);
});

test('yesterday\'s close during market hours is not live', () => {
  const morning = npt('2026-11-06', '10:45');
  assert.equal(sessionState('2026-11-05', morning), 'waiting');
  assert.equal(sessionState('2026-11-06', npt('2026-11-06', '11:05')), 'live');
  assert.equal(sessionState('2026-11-06', npt('2026-11-06', '16:00')), 'closed');
  assert.equal(sessionState(null, morning), 'waiting');
});
