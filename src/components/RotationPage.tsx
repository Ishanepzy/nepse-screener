import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RotationPoint, RotationResponse } from '../../shared/types.ts';
import type { Quadrant } from '../../shared/analysis.ts';
import { api } from '../api.ts';
import { load, save } from '../storage.ts';
import { useWatchlist } from '../watchlist.ts';
import { RsBadge } from './Badges.tsx';

type Scope = 'all' | 'scan' | 'watchlist';
const SCOPE_KEY = 'nepse.rotation.scope';

// clockwise, the way stocks usually travel
const QUADRANTS: { id: Quadrant; label: string; help: string }[] = [
  { id: 'improving', label: 'Improving', help: 'Still behind the market, but catching up' },
  { id: 'leading', label: 'Leading', help: 'Beating the market, and the lead is growing' },
  { id: 'weakening', label: 'Weakening', help: 'Still ahead of the market, but the lead is shrinking' },
  { id: 'lagging', label: 'Lagging', help: 'Behind the market, and falling further behind' },
];
const COLOR: Record<Quadrant, string> = { leading: 'var(--up)', weakening: 'var(--neutral)', lagging: 'var(--down)', improving: 'var(--accent)' };

// how far a stock sits into its quadrant, in units of the chart's half-width (0 = centre, 1 = edge)
const depth = (p: RotationPoint, sx: number, sy: number) => Math.hypot((p.x - 100) / sx, (p.y - 100) / sy);

interface Props {
  version: number;
  onOpenChart: (symbol: string, list: string[]) => void;
  // what the screener currently shows, chips applied
  scanSymbols: string[];
  scanLabel: string;
}

export function RotationPage({ version, onOpenChart, scanSymbols, scanLabel }: Props) {
  const watch = useWatchlist();
  const [scope, setScopeState] = useState<Scope>(() => {
    const v = load(SCOPE_KEY);
    return v === 'scan' || v === 'watchlist' ? v : 'all';
  });
  const setScope = (s: Scope) => {
    setScopeState(s);
    save(SCOPE_KEY, s);
  };
  const [data, setData] = useState<RotationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Quadrant | null>(null);
  const [find, setFind] = useState('');

  const symbols = scope === 'all' ? null : scope === 'scan' ? scanSymbols : watch;
  const key = scope === 'all' ? 'all' : symbols!.join(',');
  useEffect(() => {
    let off = false;
    api
      .rotation(symbols)
      .then((d) => !off && (setData(d), setError(null)))
      .catch((e) => !off && setError(e.message));
    return () => {
      off = true;
    };
  }, [key, version]);

  const points = data?.points ?? [];
  const counts = useMemo(() => {
    const c: Record<Quadrant, number> = { leading: 0, weakening: 0, lagging: 0, improving: 0 };
    for (const p of points) c[p.quadrant]++;
    return c;
  }, [points]);
  const q = find.trim().toUpperCase();
  const found = q ? points.find((p) => p.symbol === q) ?? points.find((p) => p.symbol.startsWith(q)) : undefined;

  return (
    <>
      <section className="card page-intro">
        <div className="page-intro-head">
          <div>
            <h2 className="section-title">Relative rotation</h2>
            <p className="muted small">
              Each stock against the NEPSE index, on weekly closes. Right of centre: beating the market. Above centre: its lead is growing (or its lag
              shrinking). Stocks usually travel clockwise, improving → leading → weakening → lagging. A bigger bubble sits further into its quadrant.
            </p>
          </div>
          <div className="seg" role="group" aria-label="Which stocks">
            {(
              [
                ['all', 'All company shares'],
                ['scan', `Screener (${scanSymbols.length})`],
                ['watchlist', `Watchlist (${watch.length})`],
              ] as [Scope, string][]
            ).map(([s, label]) => (
              <button
                key={s}
                className={scope === s ? 'on' : ''}
                aria-pressed={scope === s}
                title={s === 'scan' ? `What the screener table shows now: ${scanLabel}, with its sector and stage chips` : undefined}
                onClick={() => setScope(s)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="rrg-tools">
          <div className="sector-chips rrg-quads" role="group" aria-label="Highlight a quadrant">
            {QUADRANTS.map((x) => (
              <button
                key={x.id}
                className={`chip quad-chip ${focus === x.id ? 'on' : ''}`}
                style={{ '--quad': COLOR[x.id] } as React.CSSProperties}
                aria-pressed={focus === x.id}
                title={`${x.help}. Click to highlight.`}
                onClick={() => setFocus(focus === x.id ? null : x.id)}
              >
                {x.label} <span className="chip-count">{counts[x.id]}</span>
              </button>
            ))}
          </div>
          <input className="search" type="search" placeholder="Find a stock" aria-label="Find a stock on the graph" value={find} onChange={(e) => setFind(e.target.value)} />
        </div>
      </section>

      <section className="card rrg-card" aria-label="Relative rotation graph">
        {error ? (
          <p className="notice error">{error}</p>
        ) : !data ? (
          <p className="notice muted">Loading…</p>
        ) : points.length === 0 ? (
          <p className="notice muted">
            {scope === 'scan' ? 'The screener shows no stocks right now.' : scope === 'watchlist' ? 'Your watchlist is empty.' : 'No stocks to show.'} Stocks
            need about 5 months of history to be placed.
          </p>
        ) : (
          <RotationChart points={points} focus={focus} found={found?.symbol ?? null} onOpen={(s) => onOpenChart(s, points.map((p) => p.symbol))} />
        )}
        {data && points.length > 0 && (
          <p className="muted small rrg-note">
            {points.length} stocks. RS-Ratio and RS-Momentum are 100 + z-scores over {data.weeks} weeks of price ÷ NEPSE. Hover a bubble for its last 6
            weeks; click to open its chart.
          </p>
        )}
      </section>

      {points.length > 0 && <QuadrantLists points={points} onOpen={(s) => onOpenChart(s, points.map((p) => p.symbol))} />}
    </>
  );
}

function RotationChart({ points, focus, found, onOpen }: { points: RotationPoint[]; focus: Quadrant | null; found: string | null; onOpen: (s: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const [hover, setHover] = useState<string | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setW(Math.max(280, el.clientWidth)); // before the first paint, so it never flashes at the default width
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = Math.round(Math.min(Math.max(w * 0.66, 320), 680));
  const pad = { l: 46, r: 14, t: 14, b: 36 };
  // half-width of each axis: wide enough for 95% of the stocks; the rest sit on the edge
  const span = (vals: number[]) => {
    const d = vals.map((v) => Math.abs(v - 100)).sort((a, b) => a - b);
    return Math.max(0.5, (d[Math.floor((d.length - 1) * 0.95)] ?? 1) * 1.15);
  };
  const sx = span(points.map((p) => p.x));
  const sy = span(points.map((p) => p.y));
  const clamp = (v: number, s: number) => Math.min(100 + s, Math.max(100 - s, v));
  const X = (v: number) => pad.l + ((clamp(v, sx) - (100 - sx)) / (2 * sx)) * (w - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (clamp(v, sy) - (100 - sy)) / (2 * sy)) * (h - pad.t - pad.b);
  // bubble radius grows with how far out the stock is; smaller all round on a narrow chart
  const scale = Math.min(1, w / 700);
  const r = (p: RotationPoint) => Math.max(2.5, (3.5 + 9 * Math.min(1, depth(p, sx, sy))) * scale);

  // biggest first, so small bubbles stay on top and clickable
  const drawn = [...points].sort((a, b) => r(b) - r(a));
  const active = points.find((p) => p.symbol === (hover ?? found));
  const labelLeft = (p: RotationPoint) => X(p.x) > w - pad.r - 60;
  // names for the stocks furthest out, skipping any that would overlap a name already placed
  const labels: { p: RotationPoint; box: [number, number, number, number] }[] = [];
  const must = [active, points.find((p) => p.symbol === found)].filter((p): p is RotationPoint => !!p);
  const candidates = [...points].filter((p) => !focus || p.quadrant === focus).sort((a, b) => depth(b, sx, sy) - depth(a, sx, sy));
  for (const p of [...must, ...candidates]) {
    if (labels.length >= (w < 600 ? 6 : 16) + must.length || labels.some((l) => l.p === p)) continue;
    const tw = p.symbol.length * 7 + 4;
    const x0 = labelLeft(p) ? X(p.x) - r(p) - 4 - tw : X(p.x) + r(p) + 4;
    const box: [number, number, number, number] = [x0, Y(p.y) - 8, x0 + tw, Y(p.y) + 6];
    const hit = labels.some(({ box: b }) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3]);
    if (hit && !must.includes(p)) continue;
    labels.push({ p, box });
  }

  const nearest = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - box.left;
    const my = e.clientY - box.top;
    let best: RotationPoint | null = null;
    let bd = 16;
    for (const p of points) {
      if (focus && p.quadrant !== focus) continue;
      const d = Math.hypot(X(p.x) - mx, Y(p.y) - my) - r(p);
      if (d < bd) [best, bd] = [p, d];
    }
    return best;
  };

  const cx = X(100);
  const cy = Y(100);
  const quadRect = (id: Quadrant) => {
    const left = id === 'improving' || id === 'lagging';
    const top = id === 'improving' || id === 'leading';
    return { x: left ? pad.l : cx, y: top ? pad.t : cy, width: left ? cx - pad.l : w - pad.r - cx, height: top ? cy - pad.t : h - pad.b - cy };
  };
  const ticks = (s: number) => [-s, -s / 2, 0, s / 2, s].map((d) => 100 + d);

  return (
    <div className="rrg-wrap" ref={wrap}>
      <svg
        width={w}
        height={h}
        role="img"
        aria-label={`Relative rotation graph of ${points.length} stocks`}
        onPointerMove={(e) => setHover(nearest(e)?.symbol ?? null)}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const p = nearest(e as unknown as React.PointerEvent<SVGSVGElement>);
          if (p) onOpen(p.symbol);
        }}
        style={{ cursor: hover ? 'pointer' : 'default' }}
      >
        {QUADRANTS.map((q) => (
          <rect key={q.id} {...quadRect(q.id)} style={{ fill: `color-mix(in srgb, ${COLOR[q.id]} ${focus === q.id ? 12 : 6}%, transparent)` }} />
        ))}
        {QUADRANTS.map((q) => {
          const R = quadRect(q.id);
          const right = q.id === 'leading' || q.id === 'weakening';
          const top = q.id === 'improving' || q.id === 'leading';
          return (
            <text key={q.id} className="rrg-quad" x={right ? R.x + R.width - 10 : R.x + 10} y={top ? R.y + 18 : R.y + R.height - 10} textAnchor={right ? 'end' : 'start'} style={{ fill: COLOR[q.id] }}>
              {q.label.toUpperCase()}
            </text>
          );
        })}
        <line className="rrg-axis" x1={cx} x2={cx} y1={pad.t} y2={h - pad.b} />
        <line className="rrg-axis" x1={pad.l} x2={w - pad.r} y1={cy} y2={cy} />
        {ticks(sx).map((v) => (
          <text key={`x${v}`} className="rrg-tick" x={X(v)} y={h - pad.b + 16} textAnchor="middle">
            {v.toFixed(1)}
          </text>
        ))}
        {ticks(sy).slice(1).map((v) => ( // the lowest one would sit on the x axis numbers
          <text key={`y${v}`} className="rrg-tick" x={pad.l - 6} y={Y(v) + 4} textAnchor="end">
            {v.toFixed(1)}
          </text>
        ))}
        <text className="rrg-title" x={w - pad.r} y={h - 4} textAnchor="end">
          RS-Ratio: beating the market →
        </text>
        <text className="rrg-title" transform={`translate(12 ${h - pad.b}) rotate(-90)`} textAnchor="start">
          RS-Momentum: lead growing →
        </text>

        {drawn.map((p) => {
          const dim = (focus && p.quadrant !== focus) || (active && active.symbol !== p.symbol);
          return (
            <circle
              key={p.symbol}
              cx={X(p.x)}
              cy={Y(p.y)}
              r={r(p)}
              className="rrg-dot"
              style={{ fill: COLOR[p.quadrant], opacity: dim ? 0.18 : 0.85 }}
            />
          );
        })}

        {active && active.tail.length > 1 && (
          <g className="rrg-tail" style={{ color: COLOR[active.quadrant] }}>
            <polyline points={active.tail.map((t) => `${X(t.x)},${Y(t.y)}`).join(' ')} />
            {active.tail.slice(0, -1).map((t) => (
              <circle key={t.date} cx={X(t.x)} cy={Y(t.y)} r={2.5} />
            ))}
          </g>
        )}
        {active && <circle cx={X(active.x)} cy={Y(active.y)} r={r(active) + 3} className="rrg-ring" />}

        {labels.map(({ p }) => (
          // near the right edge the name goes on the bubble's left, or it gets cut off
          <text
            key={p.symbol}
            className="rrg-label"
            x={labelLeft(p) ? X(p.x) - r(p) - 4 : X(p.x) + r(p) + 4}
            y={Y(p.y) + 4}
            textAnchor={labelLeft(p) ? 'end' : 'start'}
            style={{ opacity: focus && p.quadrant !== focus ? 0.2 : 1 }}
          >
            {p.symbol}
          </text>
        ))}
      </svg>
      {active && <Tooltip p={active} x={X(active.x)} y={Y(active.y)} w={w} />}
    </div>
  );
}

function Tooltip({ p, x, y, w }: { p: RotationPoint; x: number; y: number; w: number }) {
  const left = x > w - 260;
  const quad = QUADRANTS.find((q) => q.id === p.quadrant)!;
  return (
    <div className="rrg-tip" style={{ left: left ? undefined : x + 16, right: left ? w - x + 16 : undefined, top: Math.max(4, y - 30) }}>
      <b>{p.symbol}</b> <span className="muted">{p.name}</span>
      <div style={{ color: COLOR[p.quadrant] }}>
        {quad.label}: <span className="muted">{quad.help.toLowerCase()}</span>
      </div>
      <div className="mono small">
        RS-Ratio {p.x.toFixed(2)} · RS-Momentum {p.y.toFixed(2)}
      </div>
      <div className="small">
        RS <RsBadge rs={p.rs} /> · Stage {p.stage ?? '—'} · <span className="muted">{p.sector}</span>
      </div>
    </div>
  );
}

// the same stocks as a list, strongest position first: readable on a phone, and without colour
function QuadrantLists({ points, onOpen }: { points: RotationPoint[]; onOpen: (s: string) => void }) {
  const sx = Math.max(...points.map((p) => Math.abs(p.x - 100)), 0.5);
  const sy = Math.max(...points.map((p) => Math.abs(p.y - 100)), 0.5);
  return (
    <section className="card rrg-lists" aria-label="Stocks by quadrant">
      {QUADRANTS.map((q) => {
        const list = points.filter((p) => p.quadrant === q.id).sort((a, b) => depth(b, sx, sy) - depth(a, sx, sy));
        return (
          <div key={q.id} className="rrg-list">
            <h3 style={{ color: COLOR[q.id] }}>
              {q.label} <span className="muted small">{list.length}</span>
            </h3>
            <p className="muted small">{q.help}.</p>
            <div className="sym-chips wrap">
              {list.slice(0, 24).map((p) => (
                <button key={p.symbol} className="sym-chip" title={p.name} onClick={() => onOpen(p.symbol)}>
                  {p.symbol}
                </button>
              ))}
              {list.length > 24 && <span className="muted small">+{list.length - 24} more</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
