// Market data from merolagani.com's public endpoints (the same ones its own charts and search box use).
import type { Bars } from '../shared/types.ts';

const BASE = 'https://merolagani.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) nepse-screener',
  Accept: 'application/json, text/html;q=0.9',
};

async function get(url: string, retries = 2): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 750 * attempt));
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export interface ListedName {
  symbol: string;
  name: string;
}

/** Every symbol merolagani knows, including delisted ones, debentures and promoter shares. */
export async function fetchCompanyList(): Promise<ListedName[]> {
  const rows = JSON.parse(await get(`${BASE}/handlers/AutoSuggestHandler.ashx?type=Company`)) as { l: string; d: string }[];
  return rows
    .filter((r) => r.d)
    .map((r) => {
      const symbol = r.d.trim().toUpperCase();
      // Label is "SYMBOL (Company Name)".
      const name = r.l.startsWith(r.d) ? r.l.slice(r.d.length).trim().replace(/^\((.*)\)$/, '$1') : r.l;
      return { symbol, name: name || symbol };
    });
}

/** Symbols that traded in the latest session, and that session's date. */
export async function fetchMarketSummary(): Promise<{ date: string | null; symbols: string[] }> {
  const j = JSON.parse(await get(`${BASE}/handlers/webrequesthandler.ashx?type=market_summary`));
  const d: string | undefined = j?.overall?.d ?? j?.turnover?.date; // "2026/10/09 03:00:00"
  const date = d ? d.slice(0, 10).replaceAll('/', '-') : null;
  const symbols = ((j?.turnover?.detail ?? []) as { s: string }[]).map((x) => x.s.trim().toUpperCase());
  return { date, symbols };
}

/** Daily bars, adjusted for bonus / right shares, oldest first. */
export async function fetchBars(symbol: string, years = 5): Promise<Bars> {
  const to = Math.floor(Date.now() / 1000) + 86_400;
  const from = to - Math.round(years * 365.25 * 86_400);
  const url =
    `${BASE}/handlers/TechnicalChartHandler.ashx?type=get_advanced_chart&symbol=${encodeURIComponent(symbol)}` +
    `&resolution=1D&rangeStartDate=${from}&rangeEndDate=${to}&isAdjust=1&currencyCode=NPR`;
  const j = JSON.parse(await get(url)) as { s?: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[] };
  const out: Bars = { t: [], o: [], h: [], l: [], c: [], v: [] };
  if (j.s !== 'ok' || !j.t?.length) return out;
  // The bar timestamp's UTC calendar date is the trade date (it matches market_summary's session date).
  const byDate = new Map<string, number>();
  j.t.forEach((ts, i) => {
    if (!(j.c![i] > 0)) return;
    byDate.set(new Date(ts * 1000).toISOString().slice(0, 10), i);
  });
  for (const [date, i] of [...byDate].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const c = j.c![i];
    // Thinly traded scrips sometimes come back with a 0 open/high/low; fall back to the close.
    const pick = (x: number | undefined) => (x && x > 0 ? x : c);
    out.t.push(date);
    out.o.push(pick(j.o?.[i]));
    out.h.push(Math.max(pick(j.h?.[i]), c));
    out.l.push(Math.min(pick(j.l?.[i]), c));
    out.c.push(c);
    out.v.push(j.v?.[i] ?? 0);
  }
  return out;
}

const SECTOR_RE = /Sector\s*<\/th>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/i;

export async function fetchSector(symbol: string): Promise<string | null> {
  const html = await get(`${BASE}/CompanyDetail.aspx?symbol=${encodeURIComponent(symbol)}`);
  const m = SECTOR_RE.exec(html);
  return m ? prettySector(decodeEntities(m[1])) : null;
}

const SECTOR_NAMES: Record<string, string> = {
  'Development Bank Limited': 'Development Banks',
  'Hydro Power': 'Hydropower',
  'Hotels And Tourism': 'Hotels & Tourism',
  'Manufacturing And Processing': 'Manufacturing & Processing',
  Tradings: 'Trading',
  'Promotor Share': 'Promoter Share',
  'Corporate Debenture': 'Corporate Debentures',
  'Government Bond': 'Government Bonds',
};

export const prettySector = (s: string) => SECTOR_NAMES[s] ?? s;

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
