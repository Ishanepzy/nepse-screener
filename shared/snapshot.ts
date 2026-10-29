// The one data file the site ships: every active symbol's recent daily bars, packed small.
// Prices are stored as integer paisa, closes as day-to-day differences and open/high/low relative to the close,
// and dates as steps through a shared calendar. That turns most values into short integers that gzip well
// (~2.4 MB for four years of ~390 symbols).
import type { Bars, Company } from './types.ts';
import type { Dataset } from './engine.ts';

/** Four years, so EMA(200) has fully settled; with three, borderline crosses could differ from full history. */
export const SNAPSHOT_YEARS = 4;

/** [date steps, close diffs, open−close, high−close, close−low, volume] */
type PackedBars = [number[], number[], number[], number[], number[], number[]];

export interface SnapshotFile {
  v: 1;
  asOf: string | null;
  builtAt: string | null;
  /** Every trade date in the window, ascending. */
  dates: string[];
  /** [symbol, name, sector] */
  companies: [string, string, string][];
  bars: Record<string, PackedBars>;
  index: PackedBars | null;
}

const paisa = (x: number) => Math.round(x * 100);

function pack(b: Bars, from: string, pos: Map<string, number>): PackedBars | null {
  const i0 = b.t.findIndex((t) => t >= from);
  if (i0 < 0) return null;
  const out: PackedBars = [[], [], [], [], [], []];
  let prevDate = -1;
  let prevClose = 0;
  for (let i = i0; i < b.t.length; i++) {
    const d = pos.get(b.t[i])!;
    const c = paisa(b.c[i]);
    out[0].push(d - prevDate);
    out[1].push(c - prevClose);
    out[2].push(paisa(b.o[i]) - c);
    out[3].push(paisa(b.h[i]) - c);
    out[4].push(c - paisa(b.l[i]));
    out[5].push(Math.round(b.v[i]));
    prevDate = d;
    prevClose = c;
  }
  return out;
}

function unpack(p: PackedBars, dates: string[]): Bars {
  const [dd, dc, o, h, l, v] = p;
  const b: Bars = { t: [], o: [], h: [], l: [], c: [], v };
  let d = -1;
  let c = 0;
  for (let i = 0; i < dd.length; i++) {
    d += dd[i];
    c += dc[i];
    b.t.push(dates[d]);
    b.c.push(c / 100);
    b.o.push((c + o[i]) / 100);
    b.h.push((c + h[i]) / 100);
    b.l.push((c - l[i]) / 100);
  }
  return b;
}

export function encodeSnapshot(ds: Dataset, years = SNAPSHOT_YEARS): SnapshotFile {
  const from = new Date(Date.parse(ds.asOf ?? new Date().toISOString()) - years * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const all = [...ds.bars.values(), ...(ds.index ? [ds.index] : [])];
  const dates = [...new Set(all.flatMap((b) => b.t.filter((t) => t >= from)))].sort();
  const pos = new Map(dates.map((d, i) => [d, i]));
  const bars: Record<string, PackedBars> = {};
  const companies: SnapshotFile['companies'] = [];
  for (const [symbol, b] of ds.bars) {
    const packed = pack(b, from, pos);
    const co = ds.companies.get(symbol);
    if (!packed || !co) continue;
    bars[symbol] = packed;
    companies.push([symbol, co.name, co.sector ?? '']);
  }
  return { v: 1, asOf: ds.asOf, builtAt: ds.builtAt, dates, companies, bars, index: ds.index && pack(ds.index, from, pos) };
}

export function decodeSnapshot(f: SnapshotFile): Dataset {
  if (f.v !== 1) throw new Error(`Unsupported data file version ${f.v}`);
  const companies = new Map<string, Company>(
    f.companies.map(([symbol, name, sector]) => [symbol, { symbol, name, sector: sector || undefined, active: true }]),
  );
  const bars = new Map(Object.entries(f.bars).map(([s, p]) => [s, unpack(p, f.dates)]));
  return { asOf: f.asOf, builtAt: f.builtAt, companies, bars, index: f.index && unpack(f.index, f.dates) };
}
