// Earnings and mutual fund holdings for CAN SLIM's C, A and I, cached in data/fundamentals.json.
//
// Both come from nepsetrading.com, whose robots.txt allows these pages. Requests stay few: one listing of every
// company a day, a company's own page only after it files something new (or once a month), its five-year page once
// a year, and its holdings page every two weeks (mutual funds report monthly), at most HOLDINGS_PER_RUN a run.
// Two at a time, with a pause.
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { daysBetween } from '../shared/engine.ts';
import { nepalNow } from '../shared/clock.ts';
import { nextFlight, ntFiscalYearId, parseAnnual, parseFundHoldings, parseQuarterSeries, parseTearsheet, type Fundamentals } from '../shared/fundamentals.ts';
import { pool } from './source.ts';

const DATA_DIR = process.env.NEPSE_DATA_DIR ?? path.resolve(import.meta.dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'fundamentals.json');
const NT = 'https://nepsetrading.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) nepse-screener', Accept: 'text/html' };
const PAUSE_MS = 400;
// holdings older than this are dropped
const KEEP_HOLDINGS_DAYS = 400;
const HOLDINGS_EVERY_DAYS = 14;
// spreads the first full read over a few runs
const HOLDINGS_PER_RUN = 100;

interface Entry {
  f: Fundamentals;
  // the listing's EPS, book value and paid-up capital when the company page was last read: a change = a new filing
  sig?: string;
  read?: string;
  // the fiscal year the five-year page was last read for
  annualTo?: number;
  mfRead?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(1500);
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// every company on nepsetrading's screener: symbol -> what changes when it files new results
async function fetchListing(): Promise<Map<string, string>> {
  const flight = nextFlight(await get(`${NT}/stockanalysis/screener`));
  const out = new Map<string, string>();
  for (const m of flight.matchAll(/\{"symbol":"([A-Z0-9]+)","name":"[^"]*","sector":"[^"]*","as_of"[^{}]*?\}/g)) {
    try {
      const row = JSON.parse(m[0]) as { symbol: string; eps?: number; bvps?: number; paid_up_capital?: number };
      out.set(row.symbol, `${row.eps}|${row.bvps}|${row.paid_up_capital}`);
    } catch {
      // a row we can't read is a row we skip
    }
  }
  if (out.size < 100) throw new Error(`the listing had ${out.size} companies`);
  return out;
}

// From /quarterly pages: the latest quarter the company filed, five years of it, and five years of the quarter
// before (filings are year to date, so C needs both). [fiscal year, quarter, profit to date]
async function quarterlyPages(symbol: string): Promise<[number, number, number][]> {
  const latest = parseQuarterSeries(nextFlight(await get(`${NT}/quarterly?symbol=${encodeURIComponent(symbol)}`)));
  await sleep(PAUSE_MS);
  if (!latest) return [];
  const fy = latest.rows[latest.rows.length - 1][0];
  const out: [number, number, number][] = latest.rows.map(([y, v]) => [y, latest.quarter, v]);
  if (latest.quarter > 1) {
    const url = `${NT}/quarterly?symbol=${encodeURIComponent(symbol)}&fiscalYearId=${ntFiscalYearId(fy)}&quarterNo=Q${latest.quarter - 1}`;
    const before = parseQuarterSeries(nextFlight(await get(url)));
    await sleep(PAUSE_MS);
    if (before?.quarter === latest.quarter - 1) for (const [y, v] of before.rows) out.push([y, before.quarter, v]);
  }
  return out;
}

export class FundamentalsStore {
  entries = new Map<string, Entry>();

  async load() {
    try {
      const raw = JSON.parse(await readFile(FILE, 'utf8')) as Record<string, Entry & { f: Fundamentals & { shares?: number } }>;
      // holdings once came from another site, as a share of all listed shares; read them again
      for (const e of Object.values(raw)) {
        if (e.f.shares != null) {
          delete e.f.shares;
          delete e.f.mf;
          delete e.mfRead;
        }
      }
      this.entries = new Map(Object.entries(raw));
    } catch {
      this.entries = new Map();
    }
  }

  async save() {
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(Object.fromEntries([...this.entries].sort((a, b) => a[0].localeCompare(b[0])))));
    await rename(tmp, FILE);
  }

  // what goes into the data file
  map(): Map<string, Fundamentals> {
    return new Map([...this.entries].map(([s, e]) => [s, e.f]));
  }

  // symbols: the company shares the site shows
  async refresh(symbols: string[], log: (msg: string) => void = () => {}, holdingsPerRun = HOLDINGS_PER_RUN) {
    const today = nepalNow().date;
    const listing = await fetchListing();
    const wanted = symbols.filter((s) => listing.has(s));
    const entry = (s: string) => {
      let e = this.entries.get(s);
      if (!e) this.entries.set(s, (e = { f: { q: [], a: [] } }));
      return e;
    };

    const due = wanted.filter((s) => {
      const e = this.entries.get(s);
      return !e?.read || e.sig !== listing.get(s) || daysBetween(e.read, today) > 30;
    });
    log(`Earnings: reading ${due.length} of ${wanted.length} companies`);
    let failed = 0;
    let annuals = 0;
    await pool(due, 2, async (s) => {
      const e = entry(s);
      try {
        let q = parseTearsheet(nextFlight(await get(`${NT}/stockanalysis/tearsheet/${encodeURIComponent(s)}`)));
        await sleep(PAUSE_MS);
        // insurers and a few others: the tearsheet leaves net profit blank, the quarterly pages have it
        if (!q.length) q = await quarterlyPages(s);
        if (q.length) e.f.q = q;
        // the latest full year it has filed; the five-year page for it comes once a year
        const latest = Math.max(...e.f.q.map((x) => x[0]));
        const q4 = e.f.q.filter((x) => x[1] === 4).map((x) => x[0]);
        const lastYear = q4.length ? Math.max(...q4) : latest - 1;
        if (Number.isFinite(lastYear) && (e.annualTo ?? 0) < lastYear) {
          const url = `${NT}/quarterly?symbol=${encodeURIComponent(s)}&fiscalYearId=${ntFiscalYearId(lastYear)}&quarterNo=Q4`;
          const a = parseAnnual(nextFlight(await get(url)), lastYear);
          await sleep(PAUSE_MS);
          if (a?.length) {
            e.f.a = a;
            e.annualTo = lastYear;
            annuals++;
          }
        }
        e.sig = listing.get(s);
        e.read = today;
      } catch (err) {
        failed++;
        log(`  earnings ${s}: ${(err as Error).message}`);
      }
    });
    log(`Earnings: ${due.length - failed} read, ${annuals} with five years of results${failed ? `, ${failed} failed` : ''}`);

    // holdings: the oldest reads first, so a capped run still works through everyone
    const mfDue = wanted
      .filter((s) => {
        const e = this.entries.get(s);
        return !e?.mfRead || daysBetween(e.mfRead, today) >= HOLDINGS_EVERY_DAYS;
      })
      .sort((a, b) => (this.entries.get(a)?.mfRead ?? '').localeCompare(this.entries.get(b)?.mfRead ?? ''))
      .slice(0, holdingsPerRun);
    let mfFailed = 0;
    const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - KEEP_HOLDINGS_DAYS * 86_400_000).toISOString().slice(0, 10);
    await pool(mfDue, 2, async (s) => {
      try {
        const h = parseFundHoldings(nextFlight(await get(`${NT}/quarterly?symbol=${encodeURIComponent(s)}`)));
        await sleep(PAUSE_MS);
        if (!h) throw new Error('no ownership on the page');
        const e = entry(s);
        e.f.mf = [...(e.f.mf ?? []).filter(([d]) => d >= cutoff && d !== today), [today, h.mf]];
        if (h.float) e.f.float = h.float;
        e.mfRead = today;
      } catch (err) {
        mfFailed++;
        log(`  holdings ${s}: ${(err as Error).message}`);
      }
    });
    if (mfDue.length) log(`Holdings: ${mfDue.length - mfFailed} of ${mfDue.length} read`);
    await this.save();
  }
}
