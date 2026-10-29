// Everything the UI asks of the data: screening, preset counts, market summary, chart series.
// Pure and synchronous over an in-memory Dataset, so it runs the same in the browser and in Node.
import type {
  Bars,
  ChartResponse,
  ChartSeries,
  Company,
  Condition,
  Market,
  Operand,
  ScreenRequest,
  ScreenResponse,
  ScreenRow,
  Universe,
} from './types.ts';
import { crossIndices, getLine, isCross, normalizeCondition, screenSymbol, type SeriesCache } from './screener.ts';
import { getDef, normalizeOperand, operandLabel, seriesKey } from './registry.ts';
import { PRESETS } from './presets.ts';

export interface Dataset {
  /** Latest session date in the data. */
  asOf: string | null;
  /** When the data was downloaded (ISO timestamp). */
  builtAt: string | null;
  companies: Map<string, Company>;
  bars: Map<string, Bars>;
  /** The NEPSE index itself; not a tradeable symbol, so kept out of `bars`. */
  index: Bars | null;
}

export interface OverviewItem {
  id: string;
  count: number;
  /** Most liquid matches, for a quick peek. */
  top: string[];
}

export interface SectorCount {
  name: string;
  count: number;
}

const SPARK_BARS = 60;
const OPS = new Set(['crossAbove', 'crossBelow', 'above', 'below', 'rising', 'falling']);
const MAX_CONDITIONS = 12;
const PLAIN_PRICE = new Set(['close', 'open', 'high', 'low', 'value', 'volume']);
const NON_EQUITY_SECTORS = /mutual fund|debenture|bond|preferred|preference|promot/i;
const NON_EQUITY_NAMES = /mutual fund|debenture|\bbond\b|promot[eo]r share|\bfund\b|\bscheme\b|yojana/i;

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function isEquity(c: Pick<Company, 'name' | 'sector'>): boolean {
  if (c.sector) return !NON_EQUITY_SECTORS.test(c.sector);
  return !NON_EQUITY_NAMES.test(c.name);
}

export function parseConditions(raw: unknown): Condition[] {
  if (!Array.isArray(raw)) throw new Error('conditions must be an array');
  if (raw.length > MAX_CONDITIONS) throw new Error(`at most ${MAX_CONDITIONS} conditions`);
  return raw.map((c: Condition, i) => {
    if (!c || typeof c !== 'object' || !OPS.has(c.op)) throw new Error(`condition ${i + 1}: bad op`);
    try {
      return normalizeCondition(c);
    } catch (e) {
      throw new Error(`condition ${i + 1}: ${(e as Error).message}`);
    }
  });
}

function avgTurnover(b: Bars, n = 20): number {
  const start = Math.max(0, b.c.length - n);
  let s = 0;
  for (let i = start; i < b.c.length; i++) s += b.c[i] * b.v[i];
  return s / Math.max(1, b.c.length - start);
}

const round = (x: number) => Math.round(x * 10_000) / 10_000;

export class Engine {
  private caches = new Map<string, SeriesCache>();
  private overviewItems: OverviewItem[] | null = null;
  private marketSummary: Market | null = null;
  readonly ds: Dataset;

  constructor(ds: Dataset) {
    this.ds = ds;
  }

  private cache(symbol: string): SeriesCache {
    let c = this.caches.get(symbol);
    if (!c) this.caches.set(symbol, (c = new Map()));
    return c;
  }

  private *universe(u: Universe = {}) {
    const { asOf } = this.ds;
    const sectors = u.sectors?.length ? new Set(u.sectors) : null;
    const maxStale = u.maxStaleDays ?? 10;
    for (const [symbol, bars] of this.ds.bars) {
      const co = this.ds.companies.get(symbol);
      if (!co) continue;
      const last = bars.c.length - 1;
      if (asOf && daysBetween(bars.t[last], asOf) > maxStale) continue;
      if (u.equityOnly !== false && !isEquity(co)) continue;
      if (sectors && !sectors.has(co.sector ?? 'Unknown')) continue;
      const close = bars.c[last];
      if (u.minPrice != null && close < u.minPrice) continue;
      if (u.maxPrice != null && close > u.maxPrice) continue;
      const turnover = avgTurnover(bars);
      if (u.minTurnover != null && turnover < u.minTurnover) continue;
      yield { symbol, co, bars, turnover };
    }
  }

  screen(req: ScreenRequest): ScreenResponse {
    const started = performance.now();
    const conditions = parseConditions(req.conditions);
    const match = req.match === 'any' ? 'any' : 'all';
    const rows: ScreenRow[] = [];
    let scanned = 0;
    for (const { symbol, co, bars, turnover } of this.universe(req.universe)) {
      scanned++;
      const { pass, hits } = screenSymbol(bars, conditions, match, this.cache(symbol));
      if (!pass) continue;
      const last = bars.c.length - 1;
      rows.push({
        symbol,
        name: co.name,
        sector: co.sector ?? 'Unknown',
        date: bars.t[last],
        close: bars.c[last],
        changePct: last > 0 ? ((bars.c[last] - bars.c[last - 1]) / bars.c[last - 1]) * 100 : null,
        volume: bars.v[last],
        avgTurnover: Math.round(turnover),
        spark: bars.c.slice(-SPARK_BARS),
        hits,
      });
    }
    // Freshest signal first, then the most liquid.
    const freshness = (r: ScreenRow) => Math.min(...r.hits.map((h) => (h.pass && h.barsAgo != null ? h.barsAgo : 999)));
    rows.sort((a, b) => freshness(a) - freshness(b) || b.avgTurnover - a.avgTurnover);
    return { asOf: this.ds.asOf, scanned, rows, tookMs: Math.round(performance.now() - started) };
  }

  /** Match count for every preset (equities only). */
  overview(): OverviewItem[] {
    this.overviewItems ??= PRESETS.map((p) => {
      const res = this.screen({ conditions: p.conditions, match: p.match, universe: { equityOnly: true } });
      const top = [...res.rows].sort((a, b) => b.avgTurnover - a.avgTurnover).slice(0, 6).map((r) => r.symbol);
      return { id: p.id, count: res.rows.length, top };
    });
    return this.overviewItems;
  }

  sectors(): SectorCount[] {
    const counts = new Map<string, number>();
    for (const s of this.ds.bars.keys()) {
      const sector = this.ds.companies.get(s)?.sector ?? 'Unknown';
      counts.set(sector, (counts.get(sector) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }

  market(): Market {
    if (this.marketSummary) return this.marketSummary;
    const { asOf } = this.ds;
    const breadth = { up: 0, down: 0, flat: 0 };
    for (const [symbol, b] of this.ds.bars) {
      const co = this.ds.companies.get(symbol);
      const n = b.c.length;
      if (!co || !isEquity(co) || n < 2 || b.t[n - 1] !== asOf) continue;
      const d = b.c[n - 1] - b.c[n - 2];
      if (d > 0) breadth.up++;
      else if (d < 0) breadth.down++;
      else breadth.flat++;
    }
    const ix = this.ds.index;
    const n = ix?.c.length ?? 0;
    const index =
      ix && n >= 2
        ? {
            close: ix.c[n - 1],
            change: round(ix.c[n - 1] - ix.c[n - 2]),
            changePct: round(((ix.c[n - 1] - ix.c[n - 2]) / ix.c[n - 2]) * 100),
            spark: ix.c.slice(-SPARK_BARS),
          }
        : null;
    this.marketSummary = { asOf, index, breadth };
    return this.marketSummary;
  }

  chart(symbolRaw: string, rawConditions: unknown, rawExtra: unknown): ChartResponse {
    const symbol = symbolRaw.toUpperCase();
    const bars = this.ds.bars.get(symbol);
    const co = this.ds.companies.get(symbol);
    if (!bars || !co) throw new Error(`No data for ${symbol}`);
    const conditions = parseConditions(rawConditions ?? []);
    const extra = (Array.isArray(rawExtra) ? rawExtra : []).slice(0, 12).map((o: Operand) => normalizeOperand(o));
    const cache = this.cache(symbol);

    const operands = [...conditions.flatMap((c) => (isCross(c.op) || c.op === 'above' || c.op === 'below' ? [c.left, c.right] : [c.left])), ...extra];
    const seen = new Set<string>();
    const series: ChartSeries[] = [];
    for (const op of operands) {
      if (PLAIN_PRICE.has(op.id)) continue;
      const key = `${seriesKey(op)}:${op.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const def = getDef(op.id);
      series.push({
        key,
        label: operandLabel(op),
        pane: def.pane,
        group: def.pane === 'osc' ? seriesKey(op) : def.pane,
        values: getLine(bars, op, cache).map((x) => (Number.isFinite(x) ? round(x) : null)),
      });
    }

    const levels: ChartResponse['levels'] = [];
    for (const c of conditions) {
      const pairs: [Operand, Operand, number][] = [
        [c.left, c.right, c.factor ?? 1],
        [c.right, c.left, 1 / (c.factor ?? 1)],
      ];
      for (const [ind, val, f] of pairs) {
        if (val.id === 'value' && getDef(ind.id).pane === 'osc') levels.push({ group: seriesKey(ind), value: round(val.params[0] * f) });
      }
    }

    const markers: ChartResponse['markers'] = [];
    conditions.forEach((c, i) => {
      for (const idx of crossIndices(bars, c, cache).slice(-80)) {
        markers.push({ date: bars.t[idx], dir: c.op === 'crossAbove' ? 'up' : 'down', text: conditions.length > 1 ? `C${i + 1}` : '' });
      }
    });
    markers.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return { symbol, name: co.name, sector: co.sector ?? 'Unknown', bars, series, levels, markers };
  }
}
