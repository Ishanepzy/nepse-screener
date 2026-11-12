// The scan being edited (conditions + filters) and the hash routes. The scan lives in localStorage; the URL only
// names the page or the open chart.
import type { Condition, Universe } from '../shared/types.ts';
import { PRESETS } from '../shared/presets.ts';
import { parseConditions } from '../shared/engine.ts';
import { load, onOtherTab, save } from './storage.ts';

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

// Anything read back from storage or a link goes through here: an unknown indicator or a half-written condition
// would otherwise throw while rendering and blank the page on every visit.
function cleanScan(s: Partial<Scan> | null | undefined): Scan | null {
  if (!s || !Array.isArray(s.conditions)) return null;
  try {
    return { conditions: parseConditions(s.conditions), match: s.match === 'any' ? 'any' : 'all', universe: { ...DEFAULT_UNIVERSE, ...s.universe } };
  } catch {
    return null;
  }
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export type Page = 'screener' | 'watchlist' | 'leaders' | 'journal' | 'calculator';

export const PAGES: { id: Page; label: string; title: string }[] = [
  { id: 'screener', label: 'Screener', title: 'Scan every stock for technical signals' },
  { id: 'watchlist', label: 'Watchlist', title: 'The stocks you starred' },
  { id: 'leaders', label: 'Leaders', title: 'Stage 2 leaders, and the strongest and weakest stocks in each sector' },
  { id: 'journal', label: 'Journal', title: 'Log your trades and track profit and loss' },
  { id: 'calculator', label: 'Position size', title: 'How many shares to buy for the risk you choose' },
];

// #/leaders, #/calculator/NABIL. The screener is the bare address.
export const pageHash = (page: Page, symbol?: string | null) =>
  page === 'screener' ? '' : `#/${page}${symbol ? `/${encodeURIComponent(symbol)}` : ''}`;

// null when the hash is a chart
export function pageFromHash(hash: string): { page: Page; symbol: string | null } | null {
  if (chartFromHash(hash)) return null;
  const m = /^#\/(watchlist|leaders|journal|calculator)(?:\/([^/?#]+))?$/.exec(hash);
  if (m) return { page: m[1] as Page, symbol: m[2] ? decode(m[2]) : null };
  return { page: 'screener', symbol: null };
}

export const chartHash = (symbol: string) => `#/chart/${encodeURIComponent(symbol)}`;

export function chartFromHash(hash: string): string | null {
  const m = /^#\/chart\/([^/?#]+)$/.exec(hash);
  if (m) return decode(m[1]);
  const legacy = /&c=([^&]+)$/.exec(hash); // links from before the URL was shortened
  return legacy ? decode(legacy[1]) : null;
}

// old links carried the whole scan as #s=<base64 json>; they still open
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

const CURRENT_KEY = 'nepse.currentScan';
const SAVED_KEY = 'nepse.savedScans';

export function loadCurrent(): { scan: Scan; preset: string | null } | null {
  const v = load(CURRENT_KEY) as { scan?: Partial<Scan>; preset?: unknown } | null;
  const scan = cleanScan(v?.scan);
  return scan ? { scan, preset: typeof v?.preset === 'string' ? v.preset : null } : null;
}

export function storeCurrent(scan: Scan, preset: string | null) {
  save(CURRENT_KEY, { scan, preset });
}

export function loadSaved(): SavedScan[] {
  const v = load(SAVED_KEY);
  if (!Array.isArray(v)) return [];
  return v.flatMap((x: Partial<SavedScan> | null) => {
    const scan = cleanScan(x?.scan);
    return scan && typeof x?.name === 'string' ? [{ name: x.name, scan }] : [];
  });
}

export function storeSaved(list: SavedScan[]) {
  save(SAVED_KEY, list);
}

export const onSavedChange = (fn: () => void) => onOtherTab(SAVED_KEY, fn);
