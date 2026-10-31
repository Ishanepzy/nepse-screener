// The site has no backend: it downloads one data file (built daily by GitHub Actions) and screens in the browser.
import type { ChartResponse, Condition, Market, Operand, ScreenRequest, ScreenResponse } from '../shared/types.ts';
import { Engine, type OverviewItem, type SectorCount } from '../shared/engine.ts';
import { decodeSnapshot, type SnapshotFile } from '../shared/snapshot.ts';

export type { OverviewItem, SectorCount };

export interface DataInfo {
  asOf: string | null;
  builtAt: string | null;
  symbols: number;
}

let loading: Promise<Engine> | null = null;

function engine(): Promise<Engine> {
  loading ??= (async () => {
    // no-cache = revalidate with the server each visit, so a new day's file is picked up but an unchanged one isn't re-downloaded.
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
  sectors: async (): Promise<SectorCount[]> => (await engine()).sectors(),
  /** Every stock in the data, for the chart page's search box. */
  symbols: async (): Promise<{ symbol: string; name: string }[]> =>
    [...(await engine()).ds.companies.values()].map((c) => ({ symbol: c.symbol, name: c.name })).sort((a, b) => a.symbol.localeCompare(b.symbol)),
  overview: async (): Promise<OverviewItem[]> => (await engine()).overview(),
  market: async (): Promise<Market> => (await engine()).market(),
  screen: async (req: ScreenRequest): Promise<ScreenResponse> => (await engine()).screen(req),
  chart: async (symbol: string, conditions: Condition[], extra: Operand[]): Promise<ChartResponse> =>
    (await engine()).chart(symbol, conditions, extra),
};
