// Starred stocks. One list shared by every star button and the Watchlist page; other tabs follow too.
import { useSyncExternalStore } from 'react';
import { load, onOtherTab, save } from './storage.ts';

const KEY = 'nepse.watchlist.v1';
const listeners = new Set<() => void>();

function read(): string[] {
  const v = load(KEY);
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

// Read on first use, not when this file loads: signed in, the account's copy only lands in storage after the
// modules have loaded (main.tsx), and a list read too early would show stale stars and save them over the account's.
let list: string[] | null = null;
const current = () => (list ??= read());

function set(next: string[]) {
  list = next;
  save(KEY, next);
  listeners.forEach((f) => f());
}

onOtherTab(KEY, () => {
  list = read();
  listeners.forEach((f) => f());
});

export const watchlist = {
  get: current,
  has: (symbol: string) => current().includes(symbol),
  // newest first
  toggle: (symbol: string) => set(current().includes(symbol) ? current().filter((s) => s !== symbol) : [symbol, ...current()]),
  subscribe: (f: () => void) => {
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  },
};

export const useWatchlist = () => useSyncExternalStore(watchlist.subscribe, watchlist.get);
