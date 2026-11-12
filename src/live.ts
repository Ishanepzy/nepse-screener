// Near-live prices. merolagani's market summary feed sends CORS *, so the page can poll it directly and we need
// no server. Each poll becomes today's bar for every stock that traded.
import type { LiveQuote } from '../shared/types.ts';
import { parseFeedStamp } from '../shared/clock.ts';

const FEED = 'https://merolagani.com/handlers/webrequesthandler.ashx?type=market_summary';

export const LIVE_POLL_MS = 30_000;

export interface LiveSnapshot {
  date: string;
  // HH:MM, Nepal time
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

export async function fetchLive(): Promise<LiveSnapshot | null> {
  const res = await fetch(FEED, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Live feed HTTP ${res.status}`);
  const f = (await res.json()) as Feed;
  const stamp = parseFeedStamp(f.turnover?.date ?? f.overall?.d);
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
