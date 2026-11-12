// Starred stocks. One list shared by every star button and the Watchlist page; other tabs follow too.
import { useSyncExternalStore } from 'react';
import { load, onOtherTab, save } from './storage.ts';

const KEY = 'nepse.watchlist.v1';
const listeners = new Set<() => void>();

function read(): string[] {
  const v = load(KEY);
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

let list = read();

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
  get: () => list,
  has: (symbol: string) => list.includes(symbol),
  // newest first
  toggle: (symbol: string) => set(list.includes(symbol) ? list.filter((s) => s !== symbol) : [symbol, ...list]),
  subscribe: (f: () => void) => {
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  },
};

export const useWatchlist = () => useSyncExternalStore(watchlist.subscribe, watchlist.get);
