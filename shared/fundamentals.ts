// Company earnings and mutual fund holdings, for CAN SLIM's C, A and I. The pipeline reads them from
// nepsetrading.com; the parsing and the rules live here so tests can reach them without the network.

export interface Fundamentals {
  // net profit for the fiscal year to date, as filed, in rupees: [fiscal year start (BS), quarter 1-4, profit]
  q: [number, number, number][];
  // full-year net profit in rupees: [fiscal year start, profit]
  a: [number, number][];
  // shares all mutual funds together hold, by the date it was read: [date, shares], oldest first
  mf?: [string, number][];
  // shares the public holds (not promoters), with the holdings
  float?: number;
}

// O'Neil's lines: 25% and up on the year-ago quarter, 25% a year over three years
export const C_MIN_GROWTH = 25;
export const A_MIN_GROWTH = 25;
// mutual funds together hold at least this share of the public's shares
export const I_MIN_PCT = 1;
// "not falling": compared with a reading at least this old
const I_LOOKBACK_DAYS = 60;

export const fyLabel = (fy: number) => `${fy}/${String((fy + 1) % 100).padStart(2, '0')}`;
const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;

export interface Letter {
  // null: not enough data to say
  ok: boolean | null;
  why: string;
}

// ---------- the rules ----------

// profit to date at the end of a quarter; a fourth quarter missing from the quarterly results is the full year
function ytd(f: Fundamentals, fy: number, q: number): number | null {
  return f.q.find((x) => x[0] === fy && x[1] === q)?.[2] ?? (q === 4 ? f.a.find((x) => x[0] === fy)?.[1] ?? null : null);
}

// net profit of that quarter alone: filings are year to date, so take off the quarter before
export function quarterProfit(f: Fundamentals, fy: number, q: number): number | null {
  const now = ytd(f, fy, q);
  if (now == null || q === 1) return now;
  const before = ytd(f, fy, q - 1);
  return before == null ? null : now - before;
}

// C: the latest quarter's net profit against the same quarter a year before. Net profit, not EPS, because NEPSE
// companies issue bonus shares often and EPS isn't restated for them.
export function letterC(f: Fundamentals | undefined): Letter {
  if (!f?.q.length) return { ok: null, why: 'C: no quarterly results' };
  const [fy, q] = f.q.reduce((a, b) => (b[0] * 4 + b[1] > a[0] * 4 + a[1] ? b : a));
  const label = `Q${q} ${fyLabel(fy)}`;
  const now = quarterProfit(f, fy, q);
  const before = quarterProfit(f, fy - 1, q);
  if (now == null || before == null) return { ok: null, why: `C: ${label} can't be compared with a year before` };
  if (before <= 0) return { ok: false, why: `C: ${label} against a loss (or no profit) a year before` };
  const g = ((now - before) / before) * 100;
  return { ok: g >= C_MIN_GROWTH, why: `C: ${label} net profit ${pct(g)} on the same quarter a year before (needs +${C_MIN_GROWTH}%)` };
}

// full-year profits: the 5-year page, plus any fourth quarter the quarterly results already hold
export function annualProfits(f: Fundamentals): Map<number, number> {
  const m = new Map<number, number>(f.a);
  for (const [fy, q, v] of f.q) if (q === 4) m.set(fy, v);
  return m;
}

// A: net profit up in each of the last three fiscal years, by 25% a year or more over the three
export function letterA(f: Fundamentals | undefined): Letter {
  const years = f ? annualProfits(f) : new Map<number, number>();
  if (!years.size) return { ok: null, why: 'A: no yearly results' };
  const last = Math.max(...years.keys());
  const run = [last - 3, last - 2, last - 1, last].map((y) => years.get(y));
  if (run.some((v) => v == null)) return { ok: null, why: `A: fewer than four years of results up to ${fyLabel(last)}` };
  const [v0, v1, v2, v3] = run as number[];
  const range = `${fyLabel(last - 3)} to ${fyLabel(last)}`;
  if (v0 <= 0) return { ok: false, why: `A: a loss (or no profit) in ${fyLabel(last - 3)}` };
  const rises = v1 > v0 && v2 > v1 && v3 > v2;
  const cagr = v3 > 0 ? ((v3 / v0) ** (1 / 3) - 1) * 100 : -100;
  return {
    ok: rises && cagr >= A_MIN_GROWTH,
    why: `A: net profit ${pct(cagr)} a year from ${range}${rises ? ', up every year' : ', not up every year'} (needs +${A_MIN_GROWTH}% and a rise each year)`,
  };
}

// I: mutual funds hold a real stake of what the public can trade, and it isn't shrinking. Mutual funds are the
// institutions NEPSE publishes holdings for.
export function letterI(f: Fundamentals | undefined, today: string): Letter {
  const mf = f?.mf;
  if (!mf?.length || !f?.float) return { ok: null, why: 'I: no data on mutual fund holdings' };
  const [, now] = mf[mf.length - 1];
  const share = (now / f.float) * 100;
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - I_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const older = [...mf].reverse().find(([d]) => d <= cutoff);
  const change = older ? ((now - older[1]) / Math.max(1, older[1])) * 100 : null;
  const big = share >= I_MIN_PCT;
  const steady = change == null || change >= 0;
  const trend = change == null ? '' : `, ${pct(change)} since ${older![0]}`;
  return { ok: big && steady, why: `I: mutual funds hold ${share.toFixed(2)}% of the public's shares${trend} (needs ${I_MIN_PCT}% and not falling)` };
}

// ---------- C, A and I on every bar, for the chart ----------

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// When a quarter's results were most likely out: the quarter's last day plus the month SEBON allows. The fiscal
// year runs Shrawan to Ashad (mid-July to mid-July), and BS year Y starts in AD year Y - 57.
export function quarterPublished(fy: number, q: number): string {
  const ad = fy - 57;
  const end = [`${ad}-10-17`, `${ad + 1}-01-14`, `${ad + 1}-04-13`, `${ad + 1}-07-16`][q - 1];
  return addDays(end, 30);
}

// C, A and I as they stood on each date: 1 met, 0 not, NaN not known then. Results count from the date they were
// most likely out; the newest one in the data was out by the last date, however late the estimate puts it. A
// holdings reading reflects the funds' latest monthly reports, so it also stands for the month before it was taken.
export function caiSeries(f: Fundamentals | undefined, dates: string[]): { c: number[]; a: number[]; i: number[] } {
  const n = dates.length;
  const out = { c: new Array<number>(n).fill(NaN), a: new Array<number>(n).fill(NaN), i: new Array<number>(n).fill(NaN) };
  if (!f || !n) return out;
  const last = dates[n - 1];
  const val = (l: Letter) => (l.ok == null ? NaN : l.ok ? 1 : 0);
  const newestQ = Math.max(...f.q.map((x) => x[0] * 4 + x[1]));
  const newestA = Math.max(...f.a.map((x) => x[0]));
  const cap = (d: string, newest: boolean) => (newest && d > last ? last : d);
  const qOut = f.q.map((x) => cap(quarterPublished(x[0], x[1]), x[0] * 4 + x[1] === newestQ));
  const aOut = f.a.map((x) => cap(quarterPublished(x[0], 4), x[0] === newestA));
  // what was out only grows with the date, so the counts name the set
  let seen = '';
  let c = NaN;
  let a = NaN;
  for (let k = 0; k < n; k++) {
    const d = dates[k];
    const q = f.q.filter((_, j) => qOut[j] <= d);
    const an = f.a.filter((_, j) => aOut[j] <= d);
    if (`${q.length}|${an.length}` !== seen) {
      seen = `${q.length}|${an.length}`;
      c = val(letterC({ q, a: an }));
      a = val(letterA({ q, a: an }));
    }
    out.c[k] = c;
    out.a[k] = a;
  }
  const mf = f.mf ?? [];
  if (mf.length && f.float) {
    const from = mf.map(([d]) => addDays(d, -30));
    for (let k = 0; k < n; k++) {
      let r = -1;
      for (let j = 0; j < mf.length; j++) if (from[j] <= dates[k]) r = j;
      if (r >= 0) out.i[k] = val(letterI({ ...f, mf: mf.slice(0, r + 1) }, mf[r][0]));
    }
  }
  return out;
}

// ---------- reading the pages ----------

// The data a Next.js page renders, from its self.__next_f.push([1, "..."]) script tags, joined.
export function nextFlight(html: string): string {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) out += JSON.parse(m[1]) as string;
  return out;
}

const UNITS: Record<string, number> = { '': 1, K: 1e3, L: 1e5, Lakh: 1e5, Lakhs: 1e5, Cr: 1e7, Crore: 1e7, Ar: 1e9, Arba: 1e9 };

// "2.56 Arba", "-82.12 Cr", "1,234" -> rupees
export function parseAmount(s: string): number | null {
  const m = /^(-?[\d,]*\.?\d+)\s*([A-Za-z]*)$/.exec(s.trim());
  const unit = m ? UNITS[m[2]] : undefined;
  if (!m || unit == null) return null;
  const n = Number(m[1].replaceAll(',', ''));
  return Number.isFinite(n) ? n * unit : null;
}

// nepsetrading's tearsheet: "Key financials — last 8 quarters". Its cells are keyed like "2083/2084Q1netProfit"
// and hold rounded text such as "2.56 Arba" (three significant figures, close enough for a 25% test).
export function parseTearsheet(flight: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const m of flight.matchAll(/"td","(\d{4})\/\d{4}Q([1-4])netProfit",\{(?:[^{}]|\{[^{}]*\})*?"children":"([^"]*)"/g)) {
    const v = parseAmount(m[3]);
    if (v != null) out.push([Number(m[1]), Number(m[2]), v]);
  }
  return out;
}

// nepsetrading's /quarterly page: five years of one quarter's net profit to date, in exact figures. Keys look like
// "78/79 Q4"; null without that block.
export function parseQuarterSeries(flight: string): { quarter: number; rows: [number, number][] } | null {
  const m = /\{"keys":(\[[^\]]*\]),"values":(\[[^\]]*\]),"precision":(\d+)[^{}]*?"label":"Net Profit"/.exec(flight);
  if (!m) return null;
  const keys = JSON.parse(m[1]) as string[];
  const values = JSON.parse(m[2]) as number[];
  const unit = Number(m[3]);
  let quarter = 0;
  const rows: [number, number][] = [];
  keys.forEach((k, i) => {
    const y = /^(\d{2})\/\d{2} Q([1-4])$/.exec(k);
    if (!y || !Number.isFinite(values[i])) return;
    quarter = Number(y[2]);
    rows.push([2000 + Number(y[1]), Math.round(values[i] * unit)]);
  });
  return rows.length ? { quarter, rows } : null;
}

// the fourth-quarter page: full-year net profit by fiscal year, only if the page is for the year asked
export function parseAnnual(flight: string, fy: number): [number, number][] | null {
  const s = parseQuarterSeries(flight);
  return s && s.quarter === 4 && s.rows.at(-1)?.[0] === fy ? s.rows : null;
}

// nepsetrading numbers its fiscal years from 2045/46
export const ntFiscalYearId = (fy: number) => fy - 2045;

// nepsetrading's /quarterly page, mutual fund table and ownership. The table names a few schemes, each with its
// shares and its part of everything mutual funds hold in the stock ("69.2%"), so the total is shares / part. The
// row with the biggest part gives the closest total. No table at all = no mutual fund holds it.
export function parseFundHoldings(flight: string): { mf: number; float: number | null } | null {
  const own = (who: string) => {
    const m = new RegExp(`"div","${who}",\\{"children":[\\s\\S]{0,800}?"children":\\["([\\d,]+)"," sh"\\]`).exec(flight);
    return m ? Number(m[1].replaceAll(',', '')) : null;
  };
  const float = own('Public');
  const at = flight.indexOf('"id":"funds"');
  if (at < 0) return float == null ? null : { mf: 0, float };
  const end = flight.indexOf('"$","section"', at + 1);
  const table = flight.slice(at, end > 0 ? end : at + 30_000);
  let mf: number | null = null;
  let best = 0;
  for (const row of table.matchAll(/"tr","[A-Za-z0-9]+-[^"]*-(\d+)",\{[\s\S]*?"children":"([\d.]+)%"/g)) {
    const shares = Number(row[1]);
    const part = Number(row[2]);
    if (part > best && shares > 0) [best, mf] = [part, Math.round(shares / (part / 100))];
  }
  return { mf: mf ?? 0, float };
}
