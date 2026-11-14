// What the UI asks of the data. Synchronous code over an in-memory Dataset, so node --test can run it too.
import type {
  Bars,
  ChartResponse,
  Company,
  Condition,
  LeaderItem,
  LeadersResponse,
  LiveQuote,
  RotationPoint,
  RotationResponse,
  Market,
  Operand,
  ScreenRequest,
  ScreenResponse,
  ScreenRow,
  SectorStrength,
  Universe,
} from './types.ts';
import { crossIndices, normalizeCondition, screenSymbol, type SeriesCache } from './screener.ts';
import { getDef, isStateLine, seriesKey } from './registry.ts';
import { PRESETS } from './presets.ts';
import { ROTATION_WEEKS, buildProfiles, quadrantOf, rotationSeries, rsRatingHistory, rsRatingSeries, type Profile, type Stage } from './analysis.ts';

export interface Dataset {
  asOf: string | null;
  builtAt: string | null;
  companies: Map<string, Company>;
  bars: Map<string, Bars>;
  // the index is not a tradeable symbol, so it stays out of bars
  index: Bars | null;
}

export interface OverviewItem {
  id: string;
  count: number;
  top: string[];
}

const SPARK_BARS = 60;
const OPS = new Set(['crossAbove', 'crossBelow', 'above', 'below', 'rising', 'falling', 'fired']);
const MAX_CONDITIONS = 12;
const NON_EQUITY_SECTORS = /mutual fund|debenture|bond|preferred|preference|promot/i;
const NON_EQUITY_NAMES = /mutual fund|debenture|\bbond\b|promot[eo]r share|\bfund\b|\bscheme\b|yojana/i;

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function isEquity(c: Pick<Company, 'name' | 'sector'>): boolean {
  if (c.sector) return !NON_EQUITY_SECTORS.test(c.sector);
  return !NON_EQUITY_NAMES.test(c.name);
}

const usesTrendTemplate = (conditions: Condition[]) => conditions.some((c) => c.left.id === 'tt' || c.right.id === 'tt');

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
  // RS rating history (b.rs) is only worked out when something needs it: the trend template indicator, or a scan
  // using it. rsEpoch moves on with every live update; rsAt says which epoch a stock's b.rs belongs to.
  private rsEpoch = 0;
  private rsAt = new WeakMap<Bars, number>();
  private rsAllAt = -1;
  readonly ds: Dataset;

  constructor(ds: Dataset) {
    this.ds = ds;
    for (const b of ds.bars.values()) b.ix = this.indexCloses(b.t);
  }

  // index close on or before each date
  private indexCloses(dates: string[]): number[] {
    const ix = this.ds.index;
    if (!ix?.t.length) return dates.map(() => NaN);
    const out: number[] = [];
    let j = 0;
    for (const d of dates) {
      while (j < ix.t.length && ix.t[j] <= d) j++;
      out.push(j > 0 ? ix.c[j - 1] : NaN);
    }
    return out;
  }

  private cache(symbol: string): SeriesCache {
    let c = this.caches.get(symbol);
    if (!c) this.caches.set(symbol, (c = new Map()));
    return c;
  }

  private equityBars(): Map<string, Bars> {
    const out = new Map<string, Bars>();
    for (const [s, b] of this.ds.bars) {
      const co = this.ds.companies.get(s);
      if (co && isEquity(co) && b.c.length) out.set(s, b);
    }
    return out;
  }

  private forgetTrendTemplate(symbol: string) {
    const c = this.caches.get(symbol);
    if (c) for (const k of [...c.keys()]) if (k.startsWith('tt(')) c.delete(k);
  }

  private attachRs(symbol: string) {
    const b = this.ds.bars.get(symbol);
    const co = this.ds.companies.get(symbol);
    if (!b || !co || !isEquity(co) || this.rsAt.get(b) === this.rsEpoch) return;
    b.rs = rsRatingSeries(symbol, this.equityBars());
    this.rsAt.set(b, this.rsEpoch);
    this.forgetTrendTemplate(symbol);
  }

  private attachRsAll() {
    if (this.rsAllAt === this.rsEpoch) return;
    const eq = this.equityBars();
    const history = rsRatingHistory(eq);
    for (const [s, b] of eq) {
      b.rs = history.get(s);
      this.rsAt.set(b, this.rsEpoch);
      this.forgetTrendTemplate(s);
    }
    this.rsAllAt = this.rsEpoch;
  }

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
    const conditions = parseConditions(req.conditions);
    const match = req.match === 'any' ? 'any' : 'all';
    if (usesTrendTemplate(conditions)) this.attachRsAll();
    const rows: ScreenRow[] = [];
    const profiles = this.profiles();
    let scanned = 0;
    const sectorSizes: Record<string, number> = {};
    for (const { symbol, co, bars, turnover } of this.universe(req.universe)) {
      scanned++;
      const sector = co.sector ?? 'Unknown';
      sectorSizes[sector] = (sectorSizes[sector] ?? 0) + 1;
      // no conditions = list everything that passes the filters
      const { pass, hits } = conditions.length ? screenSymbol(bars, conditions, match, this.cache(symbol)) : { pass: true, hits: [] };
      if (!pass) continue;
      rows.push(this.row(symbol, co, bars, turnover, hits, profiles.get(symbol)));
    }
    if (conditions.length) {
      // freshest signal first, then the most liquid
      const freshness = (r: ScreenRow) => Math.min(...r.hits.map((h) => (h.pass && h.barsAgo != null ? h.barsAgo : 999)));
      rows.sort((a, b) => freshness(a) - freshness(b) || b.avgTurnover - a.avgTurnover);
    } else {
      // plain list: strongest first
      rows.sort((a, b) => (b.rs ?? -1) - (a.rs ?? -1) || b.avgTurnover - a.avgTurnover);
    }
    return { asOf: this.ds.asOf, scanned, rows, sectorSizes };
  }

  private row(symbol: string, co: Company, bars: Bars, turnover: number, hits: ScreenRow['hits'], p: Profile | undefined): ScreenRow {
    const last = bars.c.length - 1;
    const prev = last > 0 ? bars.c[last - 1] : NaN;
    return {
      symbol,
      name: co.name,
      sector: co.sector ?? 'Unknown',
      date: bars.t[last],
      close: bars.c[last],
      change: prev > 0 ? round(bars.c[last] - prev) : null,
      changePct: prev > 0 ? ((bars.c[last] - prev) / prev) * 100 : null,
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
    };
  }

  // the watchlist: any symbol, in the order given
  watch(symbols: string[]): ScreenResponse {
    const profiles = this.profiles();
    const rows: ScreenRow[] = [];
    for (const symbol of new Set(symbols)) {
      const bars = this.ds.bars.get(symbol);
      const co = this.ds.companies.get(symbol);
      if (!bars?.c.length || !co) continue;
      rows.push(this.row(symbol, co, bars, avgTurnover(bars), [], profiles.get(symbol)));
    }
    // a watchlist's sectors are measured against everything still trading, funds included
    const sectorSizes: Record<string, number> = {};
    for (const { co } of this.universe({ equityOnly: false })) {
      const sector = co.sector ?? 'Unknown';
      sectorSizes[sector] = (sectorSizes[sector] ?? 0) + 1;
    }
    return { asOf: this.ds.asOf, scanned: rows.length, rows, sectorSizes };
  }

  overview(): OverviewItem[] {
    this.overviewItems ??= PRESETS.map((p) => {
      const res = this.screen({ conditions: p.conditions, match: p.match, universe: { equityOnly: true, ...p.universe } });
      const top = [...res.rows].sort((a, b) => b.avgTurnover - a.avgTurnover).slice(0, 6).map((r) => r.symbol);
      return { id: p.id, count: res.rows.length, top };
    });
    return this.overviewItems;
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

  // withRs: the chart shows the trend template, which needs this stock's RS rating on every bar
  chart(symbolRaw: string, rawConditions: unknown, withRs = false): ChartResponse {
    const symbol = symbolRaw.toUpperCase();
    const bars = this.ds.bars.get(symbol);
    const co = this.ds.companies.get(symbol);
    if (!bars || !co) throw new Error(`No data for ${symbol}`);
    const conditions = parseConditions(rawConditions ?? []);
    if (withRs || usesTrendTemplate(conditions)) this.attachRs(symbol);
    const cache = this.cache(symbol);

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
      if (isStateLine(c.left)) return; // e.g. "all 8 rules met": the panel's colour shows it
      for (const idx of crossIndices(bars, c, cache).slice(-80)) {
        markers.push({ date: bars.t[idx], dir: c.op === 'crossBelow' ? 'down' : 'up', text: conditions.length > 1 ? `C${i + 1}` : '' });
      }
    });
    markers.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return { symbol, name: co.name, sector: co.sector ?? 'Unknown', bars, levels, markers, profile: this.profiles().get(symbol) ?? null };
  }

  // Relative rotation of the given stocks against the index, or of every company share still trading.
  rotation(symbols: string[] | null = null, tailWeeks = 6): RotationResponse {
    const profiles = this.profiles();
    const list = symbols
      ? symbols.flatMap((s) => {
          const bars = this.ds.bars.get(s);
          const co = this.ds.companies.get(s);
          return bars && co ? [{ symbol: s, co, bars }] : [];
        })
      : [...this.universe({ equityOnly: true })];
    const points: RotationPoint[] = [];
    for (const { symbol, co, bars } of list) {
      const r = rotationSeries(bars);
      const last = r.x.length - 1;
      if (!(last >= 0 && Number.isFinite(r.x[last]) && Number.isFinite(r.y[last]))) continue; // under ~5 months of weeks
      const tail = [];
      for (let i = Math.max(0, last - tailWeeks); i <= last; i++) {
        if (Number.isFinite(r.x[i]) && Number.isFinite(r.y[i])) tail.push({ date: r.t[i], x: r.x[i], y: r.y[i] });
      }
      const p = profiles.get(symbol);
      points.push({
        symbol,
        name: co.name,
        sector: co.sector ?? 'Unknown',
        x: r.x[last],
        y: r.y[last],
        quadrant: quadrantOf(r.x[last], r.y[last]),
        tail,
        stage: p?.stage ?? null,
        rs: p?.rs ?? null,
      });
    }
    return { asOf: this.ds.asOf, weeks: ROTATION_WEEKS, points };
  }

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
        change: last > 0 ? round(bars.c[last] - bars.c[last - 1]) : null,
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
      // up to 3 a side, never the same stock on both: a sector of 3 shows 1 leader and 1 laggard
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

  // Live quotes become the bar for `date`, replacing it if the data already has that day.
  // Returns how many stocks changed.
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
      // new arrays, so whoever still holds the old bars (an open chart) keeps a consistent copy
      const keep = same ? last : last + 1;
      this.ds.bars.set(q.symbol, {
        t: [...b.t.slice(0, keep), date],
        o: [...b.o.slice(0, keep), open],
        h: [...b.h.slice(0, keep), high],
        l: [...b.l.slice(0, keep), low],
        c: [...b.c.slice(0, keep), q.close],
        v: [...b.v.slice(0, keep), q.volume],
        ix: [...(b.ix ?? this.indexCloses(b.t)).slice(0, keep), ...this.indexCloses([date])],
      });
      this.caches.delete(q.symbol);
      changed++;
    }
    if (changed) {
      this.rsEpoch++;
      if (!this.ds.asOf || date > this.ds.asOf) this.ds.asOf = date;
      this.overviewItems = null;
      this.marketSummary = null;
      this.profileMap = null;
    }
    return changed;
  }
}
