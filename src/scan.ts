// The scan being edited: conditions + filters. Remembered in this browser between visits, and saved by name on
// request. The URL stays short: it only names the open chart (`#/chart/NABIL`), so Back closes it.
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

function cleanScan(s: Partial<Scan> | null | undefined): Scan | null {
  if (!s || !Array.isArray(s.conditions)) return null;
  return { conditions: s.conditions, match: s.match === 'any' ? 'any' : 'all', universe: { ...DEFAULT_UNIVERSE, ...s.universe } };
}

// ---- URL: the page, or the open chart ----

export type Page = 'screener' | 'leaders' | 'journal' | 'calculator';

export const PAGES: { id: Page; label: string; title: string }[] = [
  { id: 'screener', label: 'Screener', title: 'Scan every stock for technical signals' },
  { id: 'leaders', label: 'Leaders', title: 'Stage 2 leaders, and the strongest and weakest stocks in each sector' },
  { id: 'journal', label: 'Journal', title: 'Log your trades and track profit and loss' },
  { id: 'calculator', label: 'Position size', title: 'How many shares to buy for the risk you choose' },
];

/** `#/leaders`, `#/calculator/NABIL`; the screener is the bare address. */
export const pageHash = (page: Page, symbol?: string | null) =>
  page === 'screener' ? '' : `#/${page}${symbol ? `/${encodeURIComponent(symbol)}` : ''}`;

/** The page a hash names, or null when it names a chart. */
export function pageFromHash(hash: string): { page: Page; symbol: string | null } | null {
  if (chartFromHash(hash)) return null;
  const m = /^#\/(leaders|journal|calculator)(?:\/([^/?#]+))?$/.exec(hash);
  if (m) return { page: m[1] as Page, symbol: m[2] ? decodeURIComponent(m[2]) : null };
  return { page: 'screener', symbol: null };
}

export const chartHash = (symbol: string) => `#/chart/${encodeURIComponent(symbol)}`;

export function chartFromHash(hash: string): string | null {
  const m = /^#\/chart\/([^/?#]+)$/.exec(hash);
  if (m) return decodeURIComponent(m[1]);
  const legacy = /&c=([^&]+)$/.exec(hash); // links from before the URL was shortened
  return legacy ? decodeURIComponent(legacy[1]) : null;
}

/** Scans used to travel in the URL (`#s=<base64 JSON>`); keep opening those links. */
export function legacyScanFromHash(hash: string): Scan | null {
  const m = /^#s=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const json = new TextDecoder().decode(Uint8Array.from(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
    return cleanScan(JSON.parse(json));
  } catch {
    return null;
  }
}

// ---- browser storage ----

const CURRENT_KEY = 'nepse.currentScan';
const SAVED_KEY = 'nepse.savedScans';

export function loadCurrent(): { scan: Scan; preset: string | null } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CURRENT_KEY) ?? 'null');
    const scan = cleanScan(v?.scan);
    return scan ? { scan, preset: typeof v.preset === 'string' ? v.preset : null } : null;
  } catch {
    return null;
  }
}

export function storeCurrent(scan: Scan, preset: string | null) {
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify({ scan, preset }));
  } catch {
    // Private mode / storage full: the scan just won't survive a reload.
  }
}

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
    // Private mode / storage full: named scans are a convenience.
  }
}
