// Indicator math. Series are plain number[] aligned with the bars; NaN marks "not enough data yet".
// Formulas follow TradingView's built-ins (Wilder smoothing for RSI/ATR/ADX, population stdev for BB)
// so values line up with what traders see on their charts.

export type Series = number[];

const nanArray = (n: number): Series => new Array<number>(n).fill(NaN);

function firstValid(src: Series): number {
  for (let i = 0; i < src.length; i++) if (!Number.isNaN(src[i])) return i;
  return src.length;
}

export function sma(src: Series, n: number): Series {
  const out = nanArray(src.length);
  const start = firstValid(src);
  let sum = 0;
  for (let i = start; i < src.length; i++) {
    sum += src[i];
    if (i - start >= n) sum -= src[i - n];
    if (i - start >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Exponential average with smoothing `alpha`, seeded by the SMA of the first n valid values. */
function smoothed(src: Series, n: number, alpha: number): Series {
  const out = nanArray(src.length);
  const start = firstValid(src);
  if (src.length - start < n) return out;
  let prev = 0;
  for (let i = start; i < start + n; i++) prev += src[i];
  prev /= n;
  out[start + n - 1] = prev;
  for (let i = start + n; i < src.length; i++) {
    prev = alpha * src[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export const ema = (src: Series, n: number): Series => smoothed(src, n, 2 / (n + 1));

/** Wilder's moving average (a.k.a. RMA / SMMA). */
export const rma = (src: Series, n: number): Series => smoothed(src, n, 1 / n);

export function wma(src: Series, n: number): Series {
  const out = nanArray(src.length);
  const start = firstValid(src);
  const denom = (n * (n + 1)) / 2;
  for (let i = start + n - 1; i < src.length; i++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += src[i - k] * (n - k);
    out[i] = s / denom;
  }
  return out;
}

export function rsi(close: Series, n: number): Series {
  const gain = nanArray(close.length);
  const loss = nanArray(close.length);
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    gain[i] = d > 0 ? d : 0;
    loss[i] = d < 0 ? -d : 0;
  }
  const ag = rma(gain, n);
  const al = rma(loss, n);
  return ag.map((g, i) => {
    const l = al[i];
    if (Number.isNaN(g) || Number.isNaN(l)) return NaN;
    if (l === 0) return g === 0 ? 50 : 100;
    return 100 - 100 / (1 + g / l);
  });
}

export function macd(close: Series, fast: number, slow: number, signal: number) {
  const f = ema(close, fast);
  const s = ema(close, slow);
  const line = f.map((x, i) => x - s[i]);
  const sig = ema(line, signal);
  const hist = line.map((x, i) => x - sig[i]);
  return { macd: line, signal: sig, hist };
}

export function stdev(src: Series, n: number): Series {
  const mean = sma(src, n);
  return mean.map((m, i) => {
    if (Number.isNaN(m)) return NaN;
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += (src[k] - m) ** 2;
    return Math.sqrt(s / n);
  });
}

export function bollinger(close: Series, n: number, mult: number) {
  const middle = sma(close, n);
  const sd = stdev(close, n);
  return {
    upper: middle.map((m, i) => m + mult * sd[i]),
    middle,
    lower: middle.map((m, i) => m - mult * sd[i]),
  };
}

export function trueRange(h: Series, l: Series, c: Series): Series {
  return h.map((hi, i) =>
    i === 0 ? hi - l[i] : Math.max(hi - l[i], Math.abs(hi - c[i - 1]), Math.abs(l[i] - c[i - 1])),
  );
}

export const atr = (h: Series, l: Series, c: Series, n: number): Series => rma(trueRange(h, l, c), n);

/** Highest value over the n bars BEFORE bar i (bar i itself excluded), so "close > prior high" is a breakout. */
export function priorHighest(src: Series, n: number): Series {
  const out = nanArray(src.length);
  for (let i = n; i < src.length; i++) {
    let m = -Infinity;
    for (let k = i - n; k < i; k++) if (src[k] > m) m = src[k];
    out[i] = m;
  }
  return out;
}

export function priorLowest(src: Series, n: number): Series {
  const out = nanArray(src.length);
  for (let i = n; i < src.length; i++) {
    let m = Infinity;
    for (let k = i - n; k < i; k++) if (src[k] < m) m = src[k];
    out[i] = m;
  }
  return out;
}

function rollingExtreme(src: Series, n: number, pick: (a: number, b: number) => number): Series {
  const out = nanArray(src.length);
  for (let i = n - 1; i < src.length; i++) {
    let m = src[i];
    for (let k = i - n + 1; k < i; k++) m = pick(m, src[k]);
    out[i] = m;
  }
  return out;
}

export function stochastic(h: Series, l: Series, c: Series, n: number, kSmooth: number, dSmooth: number) {
  const hh = rollingExtreme(h, n, Math.max);
  const ll = rollingExtreme(l, n, Math.min);
  const raw = c.map((x, i) => {
    const range = hh[i] - ll[i];
    if (Number.isNaN(range)) return NaN;
    return range === 0 ? 50 : (100 * (x - ll[i])) / range;
  });
  const k = sma(raw, kSmooth);
  return { k, d: sma(k, dSmooth) };
}

export function dmi(h: Series, l: Series, c: Series, n: number, adxSmooth: number) {
  const len = h.length;
  const plusDM = nanArray(len);
  const minusDM = nanArray(len);
  for (let i = 1; i < len; i++) {
    const up = h[i] - h[i - 1];
    const down = l[i - 1] - l[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  const tr = trueRange(h, l, c);
  tr[0] = NaN; // align with the DM series, which start at bar 1
  const trur = rma(tr, n);
  // A stock that doesn't move for n bars has trur 0; report 0 rather than letting NaN poison the smoothing.
  const pdi = rma(plusDM, n).map((x, i) => (trur[i] === 0 ? 0 : (100 * x) / trur[i]));
  const mdi = rma(minusDM, n).map((x, i) => (trur[i] === 0 ? 0 : (100 * x) / trur[i]));
  const dx = pdi.map((p, i) => {
    const sum = p + mdi[i];
    return (100 * Math.abs(p - mdi[i])) / (sum === 0 ? 1 : sum);
  });
  return { adx: rma(dx, adxSmooth), pdi, mdi };
}

/** TradingView-style Supertrend. dir = +1 in an uptrend (line below price), -1 in a downtrend. */
export function supertrend(h: Series, l: Series, c: Series, n: number, factor: number) {
  const len = c.length;
  const a = atr(h, l, c, n);
  const line = nanArray(len);
  const dir = nanArray(len);
  let prevUpper = NaN;
  let prevLower = NaN;
  for (let i = 0; i < len; i++) {
    if (Number.isNaN(a[i])) continue;
    const mid = (h[i] + l[i]) / 2;
    let upper = mid + factor * a[i];
    let lower = mid - factor * a[i];
    if (!Number.isNaN(prevLower) && !(lower > prevLower || c[i - 1] < prevLower)) lower = prevLower;
    if (!Number.isNaN(prevUpper) && !(upper < prevUpper || c[i - 1] > prevUpper)) upper = prevUpper;
    let d: number;
    if (Number.isNaN(line[i - 1])) d = -1;
    else if (line[i - 1] === prevUpper) d = c[i] > upper ? 1 : -1;
    else d = c[i] < lower ? -1 : 1;
    dir[i] = d;
    line[i] = d === 1 ? lower : upper;
    prevUpper = upper;
    prevLower = lower;
  }
  return { line, dir };
}

/** Percent change of close over n bars. */
export function roc(close: Series, n: number): Series {
  return close.map((x, i) => (i < n ? NaN : ((x - close[i - n]) / close[i - n]) * 100));
}
