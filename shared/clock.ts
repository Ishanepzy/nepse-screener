// Nepal time is UTC+5:45, no daylight saving.
const NPT_OFFSET_MIN = 345;

export function nepalNow(now = Date.now()): { day: number; minutes: number; date: string } {
  const d = new Date(now + NPT_OFFSET_MIN * 60_000);
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), date: d.toISOString().slice(0, 10) };
}

// 10:30 (pre-open) to 15:15, every day but Saturday. NEPSE trades Mon-Fri now, but it traded Sundays until 2026
// and an idle poll is cheap. On holidays the feed just doesn't change.
export function marketMayBeOpen(now = Date.now()): boolean {
  const { day, minutes } = nepalNow(now);
  return day !== 6 && minutes >= 10 * 60 + 30 && minutes <= 15 * 60 + 15;
}

// merolagani stamps look like "2026/11/05 03:00:00": 12-hour clock with the AM/PM dropped.
// Trading runs 11:00 to 15:00, so an hour below 10 can only be PM.
export function parseFeedStamp(stamp: string | undefined): { date: string; time: string } | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})/.exec(stamp ?? '');
  if (!m) return null;
  let h = Number(m[4]);
  if (h < 10) h += 12;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${String(h).padStart(2, '0')}:${m[5]}` };
}

export type Session = 'live' | 'waiting' | 'closed';

// live    = market hours and the feed already has today's trades
// waiting = market hours, but the feed still shows the previous close (before the first trade, or a holiday)
export function sessionState(feedDate: string | null | undefined, now = Date.now()): Session {
  if (!marketMayBeOpen(now)) return 'closed';
  return feedDate === nepalNow(now).date ? 'live' : 'waiting';
}
