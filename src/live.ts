// Near-live prices during market hours. merolagani's market summary feed allows any site to read it (CORS *), so
// the page polls it directly: no server of our own. Each poll becomes today's bar for every stock that traded,
// and the scans re-run on it.
import type { LiveQuote } from '../shared/types.ts';

const FEED = 'https://merolagani.com/handlers/webrequesthandler.ashx?type=market_summary';

export interface LiveSnapshot {
  /** Trade date (YYYY-MM-DD). */
  date: string;
  /** Feed time, 24-hour HH:MM (Nepal time). */
  time: string;
  quotes: LiveQuote[];
  turnover: number;
  shares: number;
  trades: number;
  scrips: number;
}

interface Feed {
  mt: string;
  overall?: { d: string; t: string; q: string; tn: string; st: string };
  turnover?: { date: string; detail: { s: string; lp: number; op: number; h: number; l: number; q: number }[] };
}

/** "2026/11/05 03:00:00" → date and a 24-hour time. The feed drops AM/PM; trading runs 11:00–15:00, so 1–9 is PM. */
function parseStamp(stamp: string): { date: string; time: string } | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})/.exec(stamp ?? '');
  if (!m) return null;
  let h = Number(m[4]);
  if (h < 10) h += 12;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${String(h).padStart(2, '0')}:${m[5]}` };
}

export async function fetchLive(signal?: AbortSignal): Promise<LiveSnapshot | null> {
  const res = await fetch(FEED, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`Live feed HTTP ${res.status}`);
  const f = (await res.json()) as Feed;
  const stamp = parseStamp(f.turnover?.date ?? f.overall?.d ?? '');
  if (f.mt !== 'ok' || !stamp || !f.turnover?.detail?.length) return null;
  return {
    ...stamp,
    quotes: f.turnover.detail.map((d) => ({ symbol: d.s, open: d.op, high: d.h, low: d.l, close: d.lp, volume: d.q })),
    turnover: Number(f.overall?.t) || 0,
    shares: Number(f.overall?.q) || 0,
    trades: Number(f.overall?.tn) || 0,
    scrips: Number(f.overall?.st) || 0,
  };
}

/** Nepal time is UTC+5:45. */
export function nepalNow(now = Date.now()): { day: number; minutes: number; date: string } {
  const d = new Date(now + 345 * 60_000);
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), date: d.toISOString().slice(0, 10) };
}

/**
 * Whether prices may be moving: Sunday–Friday, 10:30 (pre-open) to 15:15 Nepal time. NEPSE trades Monday–Friday
 * now; Sunday stays in, since it traded Sundays until 2026 and an idle poll costs little. Holidays just see no change.
 */
export function marketMayBeOpen(now = Date.now()): boolean {
  const { day, minutes } = nepalNow(now);
  return day !== 6 && minutes >= 10 * 60 + 30 && minutes <= 15 * 60 + 15;
}

export const LIVE_POLL_MS = 30_000;
