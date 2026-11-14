import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeValues } from './cloudMerge.ts';
import { DIRTY_KEY, OWNER_KEY, isSynced, pullAccount, pushKeys, readDirty, sameData, type Backend, type LocalStore } from './cloudSync.ts';

function memory(init: Record<string, unknown> = {}): LocalStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === 'string' && k === OWNER_KEY ? v : JSON.stringify(v)]));
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k), keys: () => [...data.keys()] };
}
function account(init: Record<string, unknown> = {}): Backend & { rows: Map<string, unknown> } {
  const rows = new Map(Object.entries(init));
  return {
    rows,
    list: async () => [...rows].map(([key, value]) => ({ key, value: structuredClone(value) })),
    put: async (r) => r.forEach((x) => rows.set(x.key, structuredClone(x.value))),
    remove: async (keys) => keys.forEach((k) => rows.delete(k)),
  };
}
const read = (s: LocalStore, k: string) => JSON.parse(s.get(k)!);

test('merging: lists by id or name, plain lists without repeats, objects key by key; the account wins single values', () => {
  assert.deepEqual(mergeValues(['NABIL', 'NICA'], ['NICA', 'UPPER']), ['NABIL', 'NICA', 'UPPER']);
  assert.deepEqual(
    mergeValues({ v: 1, trades: [{ id: 'a', qty: 10 }] }, { v: 1, trades: [{ id: 'a', qty: 99 }, { id: 'b', qty: 5 }] }),
    { v: 1, trades: [{ id: 'a', qty: 10 }, { id: 'b', qty: 5 }] },
  );
  assert.deepEqual(mergeValues([{ name: 'Mine', x: 1 }], [{ name: 'Mine', x: 2 }, { name: 'Other' }]), [{ name: 'Mine', x: 1 }, { name: 'Other' }]);
  // drawings: symbol -> list of drawings with ids
  assert.deepEqual(mergeValues({ NABIL: [{ id: 'd1' }] }, { NABIL: [{ id: 'd2' }], NICA: [{ id: 'd3' }] }), { NICA: [{ id: 'd3' }], NABIL: [{ id: 'd1' }, { id: 'd2' }] });
  assert.equal(mergeValues(5, 7), 5);
  assert.deepEqual(mergeValues({ capital: 100, fees: true }, { capital: 50, extra: 1 }), { capital: 100, fees: true, extra: 1 });
});

test('the theme, the old drawings format and the sync bookkeeping stay in the browser', () => {
  assert.ok(isSynced('nepse.watchlist.v1') && isSynced('nepse.journal.v1') && isSynced('nepse.drawings.v2'));
  assert.ok(!isSynced('nepse.theme') && !isSynced('nepse.drawings.v1') && !isSynced(OWNER_KEY) && !isSynced('other.key'));
  assert.ok(sameData({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }));
});

test('first sign-in on a browser: what was saved signed out joins the account, nothing lost', async () => {
  const s = memory({ 'nepse.watchlist.v1': ['UPPER'], 'nepse.backtest.v1': { capital: 5 }, 'nepse.theme': 'dark' });
  const a = account({ 'nepse.watchlist.v1': ['NABIL'], 'nepse.journal.v1': { v: 1, trades: [{ id: 't1' }] } });
  const { send, changed } = await pullAccount(a, s, 'user-1');
  assert.ok(changed);
  assert.deepEqual(read(s, 'nepse.watchlist.v1'), ['NABIL', 'UPPER']);
  assert.deepEqual(read(s, 'nepse.journal.v1'), { v: 1, trades: [{ id: 't1' }] });
  // the joined watchlist and the backtest settings the account didn't have go up; the theme never does
  assert.deepEqual(send.sort(), ['nepse.backtest.v1', 'nepse.watchlist.v1']);
  await pushKeys(a, s, send);
  assert.deepEqual(a.rows.get('nepse.watchlist.v1'), ['NABIL', 'UPPER']);
  assert.deepEqual(a.rows.get('nepse.backtest.v1'), { capital: 5 });
  assert.ok(!a.rows.has('nepse.theme'));
  assert.equal(s.get(OWNER_KEY), 'user-1');
  assert.equal(s.get(DIRTY_KEY), null);
});

test('later loads: the account wins, except for changes made here that never reached it', async () => {
  const s = memory({ [OWNER_KEY]: 'user-1', 'nepse.watchlist.v1': ['OLD'], 'nepse.journal.v1': { v: 1, trades: [{ id: 'mine' }] }, [DIRTY_KEY]: ['nepse.journal.v1'] });
  const a = account({ 'nepse.watchlist.v1': ['FROM', 'PHONE'], 'nepse.journal.v1': { v: 1, trades: [] } });
  const { send } = await pullAccount(a, s, 'user-1');
  assert.deepEqual(read(s, 'nepse.watchlist.v1'), ['FROM', 'PHONE']);
  assert.deepEqual(read(s, 'nepse.journal.v1'), { v: 1, trades: [{ id: 'mine' }] });
  assert.deepEqual(send, ['nepse.journal.v1']);
});

test("another account's data on this browser is cleared before this one's comes down", async () => {
  const s = memory({ [OWNER_KEY]: 'someone-else', 'nepse.watchlist.v1': ['THEIRS'], 'nepse.theme': 'dark' });
  const a = account({ 'nepse.journal.v1': { v: 1, trades: [] } });
  const { send } = await pullAccount(a, s, 'user-1');
  assert.equal(s.get('nepse.watchlist.v1'), null);
  assert.deepEqual(read(s, 'nepse.journal.v1'), { v: 1, trades: [] });
  assert.equal(s.get('nepse.theme'), '"dark"');
  assert.deepEqual(send, []);
});

test('sending: removed keys are deleted from the account, and a key changed mid-send stays marked', async () => {
  const s = memory({ [OWNER_KEY]: 'user-1', 'nepse.watchlist.v1': ['A'], [DIRTY_KEY]: ['nepse.watchlist.v1', 'nepse.backtest.v1'] });
  const a = account({ 'nepse.backtest.v1': { capital: 1 } });
  await pushKeys(a, s, ['nepse.watchlist.v1', 'nepse.backtest.v1']);
  assert.deepEqual(a.rows.get('nepse.watchlist.v1'), ['A']);
  assert.ok(!a.rows.has('nepse.backtest.v1'));
  assert.deepEqual([...readDirty(s)], []);

  // the watchlist changes while its send is on the way
  s.set(DIRTY_KEY, JSON.stringify(['nepse.watchlist.v1']));
  const slow: Backend = { ...a, put: async (rows) => (s.set('nepse.watchlist.v1', JSON.stringify(['A', 'B'])), a.put(rows)) };
  await pushKeys(slow, s, ['nepse.watchlist.v1']);
  assert.deepEqual([...readDirty(s)], ['nepse.watchlist.v1']);
});
