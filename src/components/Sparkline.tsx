interface Props {
  values: number[];
  width?: number;
  height?: number;
  /** Shown as the hover title and read by screen readers. */
  label?: string;
}

/** Tiny close-price line, green if the window ended higher than it started, red if lower. */
export function Sparkline({ values, width = 104, height = 30, label }: Props) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 3;
  const x = (i: number) => (i / (values.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const first = values[0];
  const last = values.at(-1)!;
  const tone = last > first ? 'up' : last < first ? 'down' : 'flat';
  const change = ((last - first) / first) * 100;
  const title = label ?? `${change >= 0 ? '+' : ''}${change.toFixed(1)}% over ${values.length} sessions`;
  return (
    <svg className={`spark ${tone}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      <title>{title}</title>
      <polygon className="spark-area" points={`${x(0)},${height} ${pts.join(' ')} ${x(values.length - 1)},${height}`} />
      <polyline className="spark-line" points={pts.join(' ')} />
      <circle className="spark-dot" cx={x(values.length - 1)} cy={y(last)} r={2.5} />
    </svg>
  );
}
