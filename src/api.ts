// No backend: the page downloads one data file (built daily by the GitHub Action) and does the rest itself.
import type { ChartResponse, Condition, LeadersResponse, LiveQuote, Market, RotationResponse, ScreenRequest, ScreenResponse } from '../shared/types.ts';
import { Engine, type OverviewItem } from '../shared/engine.ts';
import { decodeSnapshot, type SnapshotFile } from '../shared/snapshot.ts';
import type { BacktestRequest, BacktestResult } from '../shared/backtest.ts';

export type { OverviewItem };

export interface DataInfo {
  asOf: string | null;
  builtAt: string | null;
  symbols: number;
}

let loading: Promise<Engine> | null = null;

function engine(): Promise<Engine> {
  loading ??= (async () => {
    // no-cache = revalidate on every visit: a new day's file gets picked up, an unchanged one isn't downloaded again
    const res = await fetch(`${import.meta.env.BASE_URL}data/snapshot.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status === 404 ? 'No price data yet. Run `npm run data` to download it.' : `Couldn't load price data (HTTP ${res.status})`);
    return new Engine(decodeSnapshot((await res.json()) as SnapshotFile));
  })().catch((e) => {
    loading = null; // let the next call retry
    throw e;
  });
  return loading;
}

export const api = {
  info: async (): Promise<DataInfo> => {
    const { ds } = await engine();
    return { asOf: ds.asOf, builtAt: ds.builtAt, symbols: ds.bars.size };
  },
  symbols: async (): Promise<{ symbol: string; name: string }[]> =>
    [...(await engine()).ds.companies.values()].map((c) => ({ symbol: c.symbol, name: c.name })).sort((a, b) => a.symbol.localeCompare(b.symbol)),
  overview: async (): Promise<OverviewItem[]> => (await engine()).overview(),
  market: async (): Promise<Market> => (await engine()).market(),
  screen: async (req: ScreenRequest): Promise<ScreenResponse> => (await engine()).screen(req),
  chart: async (symbol: string, conditions: Condition[] = [], withRs = false): Promise<ChartResponse> =>
    (await engine()).chart(symbol, conditions, withRs),
  leaders: async (minTurnover?: number): Promise<LeadersResponse> => (await engine()).leaders(minTurnover),
  watch: async (symbols: string[]): Promise<ScreenResponse> => (await engine()).watch(symbols),
  rotation: async (symbols: string[] | null): Promise<RotationResponse> => (await engine()).rotation(symbols),
  backtest: async (req: BacktestRequest): Promise<BacktestResult> => (await engine()).backtest(req),
  // first and last session in the data, for the backtest's date range
  range: async (): Promise<{ from: string; to: string } | null> => {
    const ix = (await engine()).ds.index;
    return ix?.t.length ? { from: ix.t[0], to: ix.t[ix.t.length - 1] } : null;
  },
  lastPrices: async (): Promise<Map<string, { close: number; date: string }>> => {
    const m = new Map<string, { close: number; date: string }>();
    for (const [s, b] of (await engine()).ds.bars) if (b.c.length) m.set(s, { close: b.c[b.c.length - 1], date: b.t[b.t.length - 1] });
    return m;
  },
  applyLive: async (date: string, quotes: LiveQuote[]): Promise<number> => (await engine()).applyLive(date, quotes),
};
