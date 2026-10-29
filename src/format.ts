const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const price = (x: number | null | undefined) => (x == null ? '—' : nf2.format(x));
export const int = (x: number | null | undefined) => (x == null ? '—' : nf0.format(x));

export function pct(x: number | null | undefined): string {
  if (x == null) return '—';
  return `${x > 0 ? '+' : ''}${x.toFixed(2)}%`;
}

/** Nepali convention: lakh (1e5) and crore (1e7). */
export function npr(x: number | null | undefined): string {
  if (x == null) return '—';
  if (x >= 1e7) return `${(x / 1e7).toFixed(2)} Cr`;
  if (x >= 1e5) return `${(x / 1e5).toFixed(2)} L`;
  return nf0.format(x);
}

/** Indicator values: up to 2 decimals, compact for big volume-like numbers. */
export function value(x: number | null | undefined): string {
  if (x == null) return '—';
  const a = Math.abs(x);
  if (a >= 1e5) return npr(x);
  if (a >= 100) return x.toFixed(1);
  return x.toFixed(2);
}

export function ago(n: number | undefined): string {
  if (n == null) return '';
  return n === 0 ? 'today' : n === 1 ? '1 bar ago' : `${n} bars ago`;
}

export function relTime(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
