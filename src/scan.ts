// The scan being edited: conditions + universe. Mirrored into the URL hash so a scan can be bookmarked or shared,
// and optionally saved by name in localStorage.
import type { Condition, Universe } from '../shared/types.ts';
import { PRESETS } from '../shared/presets.ts';

export interface Scan {
  conditions: Condition[];
  match: 'all' | 'any';
  universe: Universe;
}

export interface SavedScan {
  name: string;
  scan: Scan;
}

export const DEFAULT_UNIVERSE: Universe = { equityOnly: true, sectors: [], maxStaleDays: 10 };

export function scanFromPreset(id: string): Scan {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return { conditions: structuredClone(p.conditions), match: p.match, universe: { ...DEFAULT_UNIVERSE } };
}

const b64encode = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function scanToHash(scan: Scan): string {
  return '#s=' + b64encode(JSON.stringify(scan));
}

export function scanFromHash(hash: string): Scan | null {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  try {
    const s = JSON.parse(b64decode(m[1])) as Scan;
    if (!Array.isArray(s.conditions)) return null;
    return { conditions: s.conditions, match: s.match === 'any' ? 'any' : 'all', universe: { ...DEFAULT_UNIVERSE, ...s.universe } };
  } catch {
    return null;
  }
}

const SAVED_KEY = 'nepse.savedScans';

export function loadSaved(): SavedScan[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function storeSaved(list: SavedScan[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    // Private mode / storage full: saving is a convenience, the URL hash still works.
  }
}
