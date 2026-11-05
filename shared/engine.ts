// Everything the UI asks of the data: screening, preset counts, market summary, chart series.
// Pure and synchronous over an in-memory Dataset, so it runs the same in the browser and in Node.
import type {
  Bars,
  ChartResponse,
  ChartSeries,
  Company,
  Condition,
  LeaderItem,
  LeadersResponse,
  LiveQuote,
  Market,
  Operand,
  ScreenRequest,
  ScreenResponse,
  ScreenRow,
  SectorStrength,
  Universe,
} from './types.ts';
import { crossIndices, getLine, isCross, normalizeCondition, screenSymbol, type SeriesCache } from './screener.ts';
import { getDef, normalizeOperand, operandLabel, seriesKey } from './registry.ts';
import { PRESETS } from './presets.ts';
import { buildProfiles, type Profile, type Stage } from './analysis.ts';

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
const OPS = new Set(['crossAbove', 'crossBelow', 'above', 'below', 'rising', 'falling', 'fired']);
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
const DEFAULT_STALE_DAYS = 10;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pctBelowHigh = (close: number, p: Profile | undefined) => (p?.high52 ? Math.max(0, (1 - close / p.high52) * 100) : null);

export class Engine {
  private caches = new Map<string, SeriesCache>();
  private overviewItems: OverviewItem[] | null = null;
  private marketSummary: Market | null = null;
  private profileMap: Map<string, Profile> | null = null;
  readonly ds: Dataset;

  constructor(ds: Dataset) {
    this.ds = ds;
  }

  private cache(symbol: string): SeriesCache {
    let c = this.caches.get(symbol);
    if (!c) this.caches.set(symbol, (c = new Map()));
    return c;
  }

  /** Stage, RS rating, trend template and returns of every stock, as of its latest bar. */
  profiles(): Map<string, Profile> {
    if (this.profileMap) return this.profileMap;
    const { asOf } = this.ds;
    const input = new Map<string, { bars: Bars; ranked: boolean }>();
    for (const [symbol, bars] of this.ds.bars) {
      const co = this.ds.companies.get(symbol);
      if (!co || !bars.c.length) continue;
      const fresh = !asOf || daysBetween(bars.t[bars.t.length - 1], asOf) <= DEFAULT_STALE_DAYS;
      input.set(symbol, { bars, ranked: fresh && isEquity(co) });
    }
    this.profileMap = buildProfiles(input);
    return this.profileMap;
  }

  private *universe(u: Universe = {}) {
    const { asOf } = this.ds;
    const sectors = u.sectors?.length ? new Set(u.sectors) : null;
    const stages = u.stages?.length ? new Set<Stage | null>(u.stages) : null;
    const needProfile = u.trendTemplate || u.minRs != null || stages;
    const profiles = needProfile ? this.profiles() : null;
    const maxStale = u.maxStaleDays ?? DEFAULT_STALE_DAYS;
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
      if (profiles) {
        const p = profiles.get(symbol);
        if (u.trendTemplate && p?.tt !== 8) continue;
        if (u.minRs != null && !((p?.rs ?? 0) >= u.minRs)) continue;
        if (stages && !stages.has(p?.stage ?? null)) continue;
      }
      yield { symbol, co, bars, turnover };
    }
  }

  screen(req: ScreenRequest): ScreenResponse {
    const started = performance.now();
    const conditions = parseConditions(req.conditions);
    const match = req.match === 'any' ? 'any' : 'all';
    const rows: ScreenRow[] = [];
    const profiles = this.profiles();
    let scanned = 0;
    for (const { symbol, co, bars, turnover } of this.universe(req.universe)) {
      scanned++;
      // No conditions = every stock that passes the filters (the "All stocks" list).
      const { pass, hits } = conditions.length ? screenSymbol(bars, conditions, match, this.cache(symbol)) : { pass: true, hits: [] };
      if (!pass) continue;
      const last = bars.c.length - 1;
      const p = profiles.get(symbol);
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
        rs: p?.rs ?? null,
        stage: p?.stage ?? null,
        stageWeeks: p?.stageWeeks ?? 0,
        tt: p?.tt ?? 0,
        ttChecks: p?.ttChecks ?? [],
        fromHigh: pctBelowHigh(bars.c[last], p),
      });
    }
    if (conditions.length) {
      // Freshest signal first, then the most liquid.
      const freshness = (r: ScreenRow) => Math.min(...r.hits.map((h) => (h.pass && h.barsAgo != null ? h.barsAgo : 999)));
      rows.sort((a, b) => freshness(a) - freshness(b) || b.avgTurnover - a.avgTurnover);
    } else {
      // A plain list: strongest first.
      rows.sort((a, b) => (b.rs ?? -1) - (a.rs ?? -1) || b.avgTurnover - a.avgTurnover);
    }
    return { asOf: this.ds.asOf, scanned, rows, tookMs: Math.round(performance.now() - started) };
  }

  /** Match count for every preset (equities only). */
  overview(): OverviewItem[] {
    this.overviewItems ??= PRESETS.map((p) => {
      const res = this.screen({ conditions: p.conditions, match: p.match, universe: { equityOnly: true, ...p.universe } });
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
            date: ix.t[n - 1],
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
        markers.push({ date: bars.t[idx], dir: c.op === 'crossBelow' ? 'down' : 'up', text: conditions.length > 1 ? `C${i + 1}` : '' });
      }
    });
    markers.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return { symbol, name: co.name, sector: co.sector ?? 'Unknown', bars, series, levels, markers, profile: this.profiles().get(symbol) ?? null };
  }

  /** Stage 2 leaders, the stage count, and each sector's strength with its leaders and laggards. */
  leaders(minTurnover?: number): LeadersResponse {
    const profiles = this.profiles();
    const items: LeaderItem[] = [];
    for (const { symbol, co, bars } of this.universe({ equityOnly: true, minTurnover })) {
      const p = profiles.get(symbol);
      if (p?.rs == null) continue;
      const last = bars.c.length - 1;
      items.push({
        symbol,
        name: co.name,
        sector: co.sector ?? 'Unknown',
        close: bars.c[last],
        changePct: last > 0 ? ((bars.c[last] - bars.c[last - 1]) / bars.c[last - 1]) * 100 : null,
        rs: p.rs,
        stage: p.stage,
        stageWeeks: p.stageWeeks,
        tt: p.tt,
        ret3m: p.ret.m3,
        fromHigh: pctBelowHigh(bars.c[last], p),
      });
    }
    items.sort((a, b) => b.rs - a.rs);
    const stages: Record<Stage, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const it of items) if (it.stage) stages[it.stage]++;

    const bySector = new Map<string, LeaderItem[]>();
    for (const it of items) {
      let list = bySector.get(it.sector);
      if (!list) bySector.set(it.sector, (list = []));
      list.push(it);
    }
    const sectors: SectorStrength[] = [...bySector].map(([sector, list]) => {
      // Up to 3 each, and never the same stock on both sides: a sector of 3 shows 1 leader and 1 laggard.
      const k = Math.min(3, Math.floor(list.length / 2));
      return {
        sector,
        count: list.length,
        medianRs: Math.round(median(list.map((x) => x.rs))!),
        stage2Pct: Math.round((list.filter((x) => x.stage === 2).length / list.length) * 100),
        ret3m: median(list.flatMap((x) => (x.ret3m == null ? [] : [x.ret3m]))),
        leaders: list.slice(0, Math.max(1, k)),
        laggards: k ? list.slice(-k).reverse() : [],
      };
    });
    sectors.sort((a, b) => b.medianRs - a.medianRs || b.stage2Pct - a.stage2Pct);
    return {
      asOf: this.ds.asOf,
      stages,
      stage2Leaders: items.filter((x) => x.stage === 2 && x.rs >= 80),
      sectors,
    };
  }

  /**
   * Folds the live market feed into the data as the bar for `date`: replaces that day's bar if the data already has
   * it, or appends it. Returns how many stocks changed; caches built on the old bars are dropped.
   */
  applyLive(date: string, quotes: LiveQuote[]): number {
    let changed = 0;
    for (const q of quotes) {
      const b = this.ds.bars.get(q.symbol);
      if (!b || !(q.close > 0) || !b.t.length) continue;
      const last = b.t.length - 1;
      if (b.t[last] > date) continue; // the data file is already newer
      const open = q.open > 0 ? q.open : q.close;
      const high = Math.max(q.high, open, q.close);
      const low = Math.min(q.low > 0 ? q.low : q.close, open, q.close);
      const same = b.t[last] === date;
      if (same && b.o[last] === open && b.c[last] === q.close && b.h[last] === high && b.l[last] === low && b.v[last] === q.volume) continue;
      // New arrays, so anything holding the old bars (an open chart) keeps a consistent copy.
      const keep = same ? last : last + 1;
      this.ds.bars.set(q.symbol, {
        t: [...b.t.slice(0, keep), date],
        o: [...b.o.slice(0, keep), open],
        h: [...b.h.slice(0, keep), high],
        l: [...b.l.slice(0, keep), low],
        c: [...b.c.slice(0, keep), q.close],
        v: [...b.v.slice(0, keep), q.volume],
      });
      this.caches.delete(q.symbol);
      changed++;
    }
    if (changed) {
      if (!this.ds.asOf || date > this.ds.asOf) this.ds.asOf = date;
      this.overviewItems = null;
      this.marketSummary = null;
      this.profileMap = null;
    }
    return changed;
  }
}
