// data/ cache of companies and daily bars, and the refresh from merolagani.
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Bars, Company } from '../shared/types.ts';
import { daysBetween, type Dataset } from '../shared/engine.ts';
import { nepalNow } from '../shared/clock.ts';
import { fetchBars, fetchCompanyList, fetchMarketSummary, fetchSector, pool, prettySector } from './source.ts';

const DATA_DIR = process.env.NEPSE_DATA_DIR ?? path.resolve(import.meta.dirname, '..', 'data');
const BARS_DIR = path.join(DATA_DIR, 'bars');
const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

// no trade for this long = suspended or delisted; stop refreshing it
const ACTIVE_WITHIN_DAYS = 60;
// how often to re-scan the full symbol list (new listings that rarely trade)
const DISCOVER_EVERY_DAYS = 7;

interface Meta {
  asOf: string | null;
  lastRefresh: string | null;
  discoveredAt: string | null;
}

// some debenture symbols contain '/', e.g. NICD83/84
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

    const stale = !this.meta.discoveredAt || daysBetween(this.meta.discoveredAt.slice(0, 10), nepalNow().date) >= DISCOVER_EVERY_DAYS;
    const doDiscover = discover || stale || this.bars.size === 0;
    const todo = new Set(summary.symbols);
    for (const c of this.companies.values()) {
      if (c.active) todo.add(c.symbol);
      // promoter shares can't be traded by the public and are ~300 of the symbols; skip them
      else if (doDiscover && !/promot[eo]r/i.test(c.name)) todo.add(c.symbol);
    }
    for (const s of todo) if (!this.companies.has(s)) this.companies.set(s, { symbol: s, name: s, active: false });

    const symbols = [...todo];
    log(`${doDiscover ? 'Discovering listed companies' : 'Downloading price history'}: ${symbols.length} symbols`);
    const asOfGuess = summary.date ?? nepalNow().date;
    let failed = 0;
    let done = 0;
    await pool(symbols, 6, async (symbol) => {
      try {
        const b = await fetchBars(symbol);
        // history doesn't vanish: an empty answer for a symbol we already have is a glitch, so keep the cache
        if (!b.t.length && this.bars.has(symbol)) throw new Error('empty response');
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
