// Keeping this browser's saved data and the signed-in account's in step. The browser copy is what the app reads; the
// account is where it lives. On every page load the account's copy comes down (except for anything changed here and
// not yet sent), and changes go up a moment after they're made.
import { mergeValues } from './cloudMerge.ts';

export interface Backend {
  list(): Promise<{ key: string; value: unknown }[]>;
  put(rows: { key: string; value: unknown }[]): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface LocalStore {
  get(key: string): string | null;
  set(key: string, raw: string): void;
  remove(key: string): void;
  keys(): string[];
}

// whose data this browser holds, and which keys changed here without reaching the account yet
export const OWNER_KEY = 'nepse.cloud.user';
export const DIRTY_KEY = 'nepse.cloud.dirty';

// Everything the app saves goes to the account, except the colour theme (a choice per device), the old drawings
// format (moved over on read) and this module's own bookkeeping.
export const isSynced = (key: string) => key.startsWith('nepse.') && !key.startsWith('nepse.cloud.') && key !== 'nepse.theme' && key !== 'nepse.drawings.v1';

const parse = (raw: string | null): unknown => {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

// the same data, whatever order its keys are in (Postgres jsonb doesn't keep the order they were sent in)
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
export const sameData = (a: unknown, b: unknown) => canonical(a) === canonical(b);

export function readDirty(store: LocalStore): Set<string> {
  const v = parse(store.get(DIRTY_KEY));
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
}
export function writeDirty(store: LocalStore, keys: Set<string>) {
  if (keys.size) store.set(DIRTY_KEY, JSON.stringify([...keys]));
  else store.remove(DIRTY_KEY);
}

// the synced keys gone from this browser: on sign-out, or before another account's data comes down
export function wipeLocal(store: LocalStore) {
  for (const k of store.keys()) if (isSynced(k)) store.remove(k);
  store.remove(OWNER_KEY);
  store.remove(DIRTY_KEY);
}

// Brings the account's data down. Returns the keys this browser should send up (ones the account doesn't have yet,
// ones changed here since the last send, and on the first sign-in here, ones the merge added to), and whether
// anything here changed.
export async function pullAccount(backend: Backend, store: LocalStore, userId: string): Promise<{ send: string[]; changed: boolean }> {
  const rows = await backend.list();
  const account = new Map(rows.filter((r) => isSynced(r.key)).map((r) => [r.key, r.value]));
  const owner = store.get(OWNER_KEY);
  if (owner && owner !== userId) wipeLocal(store);
  // signed out until now: what's here gets joined with the account rather than replaced by it
  const guest = owner !== userId;
  const dirty = guest ? new Set<string>() : readDirty(store);
  const send: string[] = [];
  let changed = owner !== userId && !!owner;
  const put = (k: string, value: unknown) => {
    if (!sameData(parse(store.get(k)), value)) changed = true;
    store.set(k, JSON.stringify(value));
  };
  const here = store.keys().filter(isSynced);
  for (const k of here) {
    const mine = parse(store.get(k));
    if (!account.has(k) || dirty.has(k)) {
      send.push(k);
      continue;
    }
    const theirs = account.get(k);
    const next = guest ? mergeValues(theirs, mine) : theirs;
    put(k, next);
    if (!sameData(next, theirs)) send.push(k);
  }
  for (const [k, v] of account) if (!here.includes(k)) put(k, v);
  store.set(OWNER_KEY, userId);
  writeDirty(store, new Set(send));
  return { send, changed };
}

// Sends the given keys as they stand in this browser now; a key no longer here is deleted from the account too.
export async function pushKeys(backend: Backend, store: LocalStore, keys: string[]) {
  const sent = new Map(keys.map((k) => [k, store.get(k)]));
  const present = keys.filter((k) => sent.get(k) != null);
  const gone = keys.filter((k) => sent.get(k) == null);
  if (present.length) await backend.put(present.map((key) => ({ key, value: parse(sent.get(key)!) })));
  if (gone.length) await backend.remove(gone);
  // a key changed again while this was on its way stays marked, for the next send
  const dirty = readDirty(store);
  for (const k of keys) if (store.get(k) === sent.get(k)) dirty.delete(k);
  writeDirty(store, dirty);
}
