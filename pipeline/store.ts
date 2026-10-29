// On-disk cache of companies + daily bars (data/), and the job that refreshes it from merolagani.
// The cache keeps sector lookups and the list of active symbols between runs, so a daily refresh only
// re-downloads prices.
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Bars, Company } from '../shared/types.ts';
import { daysBetween, type Dataset } from '../shared/engine.ts';
import { fetchBars, fetchCompanyList, fetchMarketSummary, fetchSector, pool, prettySector } from './source.ts';

const DATA_DIR = process.env.NEPSE_DATA_DIR ?? path.resolve(import.meta.dirname, '..', 'data');
const BARS_DIR = path.join(DATA_DIR, 'bars');
const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

/** A symbol with no trade for this long is treated as suspended / delisted and stops being refreshed. */
const ACTIVE_WITHIN_DAYS = 60;
/** Re-scan the full merolagani symbol list this often, to pick up new listings that rarely trade. */
const DISCOVER_EVERY_DAYS = 7;

interface Meta {
  asOf: string | null;
  lastRefresh: string | null;
  discoveredAt: string | null;
}

/** Some debenture symbols contain '/', e.g. NICD83/84. */
const barsFile = (symbol: string) => path.join(BARS_DIR, `${encodeURIComponent(symbol)}.json`);

async function writeJson(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Today's date in Nepal (UTC+5:45). */
function today(): string {
  return new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
}

export class Store {
  companies = new Map<string, Company>();
  bars = new Map<string, Bars>();
  index: Bars | null = null;
  meta: Meta = { asOf: null, lastRefresh: null, discoveredAt: null };

  async load() {
    await mkdir(BARS_DIR, { recursive: true });
    this.meta = await readJson(META_FILE, this.meta);
    this.index = await readJson<Bars | null>(INDEX_FILE, null);
    const list = await readJson<Company[]>(COMPANIES_FILE, []);
    this.companies = new Map(list.map((c) => [c.symbol, { ...c, sector: c.sector && prettySector(c.sector) }]));
    const files = (await readdir(BARS_DIR)).filter((f) => f.endsWith('.json'));
    await pool(files, 16, async (f) => {
      const b = await readJson<Bars | null>(path.join(BARS_DIR, f), null);
      if (b?.t?.length) this.bars.set(decodeURIComponent(f.slice(0, -5)), b);
    });
  }

  dataset(): Dataset {
    const companies = new Map([...this.companies].filter(([s]) => this.bars.has(s)));
    return { asOf: this.meta.asOf, builtAt: this.meta.lastRefresh, companies, bars: this.bars, index: this.index };
  }

  /** Downloads fresh bars for every active symbol (and, when discovering, every listed one). Throws on failure. */
  async refresh({ discover = false, log = () => {} }: { discover?: boolean; log?: (msg: string) => void } = {}) {
    const [listed, summary, index] = await Promise.all([fetchCompanyList(), fetchMarketSummary(), fetchBars('NEPSE').catch(() => null)]);
    if (index?.t.length) {
      this.index = index;
      await writeJson(INDEX_FILE, index);
    }
    for (const { symbol, name } of listed) {
      const c = this.companies.get(symbol);
      if (c) c.name = name;
      else this.companies.set(symbol, { symbol, name, active: false });
    }

    const stale = !this.meta.discoveredAt || daysBetween(this.meta.discoveredAt.slice(0, 10), today()) >= DISCOVER_EVERY_DAYS;
    const doDiscover = discover || stale || this.bars.size === 0;
    const todo = new Set(summary.symbols);
    for (const c of this.companies.values()) {
      if (c.active) todo.add(c.symbol);
      // Promoter shares are untradeable for the public and make up ~300 of the symbols; skip them in discovery.
      else if (doDiscover && !/promot[eo]r/i.test(c.name)) todo.add(c.symbol);
    }
    for (const s of todo) if (!this.companies.has(s)) this.companies.set(s, { symbol: s, name: s, active: false });

    const symbols = [...todo];
    log(`${doDiscover ? 'Discovering listed companies' : 'Downloading price history'}: ${symbols.length} symbols`);
    const asOfGuess = summary.date ?? today();
    let failed = 0;
    let done = 0;
    await pool(symbols, 6, async (symbol) => {
      try {
        const b = await fetchBars(symbol);
        const c = this.companies.get(symbol)!;
        const last = b.t.at(-1);
        c.lastBar = last;
        c.active = !!last && daysBetween(last, asOfGuess) <= ACTIVE_WITHIN_DAYS;
        const file = barsFile(symbol);
        if (c.active) {
          await writeJson(file, b);
          this.bars.set(symbol, b);
        } else if (this.bars.delete(symbol)) {
          await rm(file, { force: true });
        }
      } catch (e) {
        failed++;
        log(`  ${symbol}: ${(e as Error).message}`);
      } finally {
        if (++done % 100 === 0) log(`  ${done}/${symbols.length}`);
      }
    });
    if (failed > symbols.length / 2) throw new Error(`${failed} of ${symbols.length} downloads failed`);

    const needSector = [...this.companies.values()].filter((c) => c.active && !c.sector);
    log(`Looking up sectors: ${needSector.length} symbols`);
    await pool(needSector, 4, async (c) => {
      try {
        c.sector = (await fetchSector(c.symbol)) ?? undefined;
      } catch (e) {
        log(`  sector ${c.symbol}: ${(e as Error).message}`);
      }
    });

    let asOf = summary.date;
    for (const b of this.bars.values()) {
      const last = b.t.at(-1)!;
      if (!asOf || last > asOf) asOf = last;
    }
    this.meta = {
      asOf: asOf ?? null,
      lastRefresh: new Date().toISOString(),
      discoveredAt: doDiscover ? new Date().toISOString() : this.meta.discoveredAt,
    };
    await writeJson(COMPANIES_FILE, [...this.companies.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)));
    await writeJson(META_FILE, this.meta);
    log(`Done. ${this.bars.size} active symbols, data as of ${asOf}${failed ? `, ${failed} failed` : ''}.`);
  }
}
