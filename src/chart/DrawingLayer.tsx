// SVG layer over the whole chart: every panel, the empty space past the last bar, and the axes (for labels).
// It never takes pointer events itself. Clicks are read from the chart box in the capture phase, so wheel zoom,
// panning and the crosshair keep working, and only a press that lands on a drawing (or places one) is kept
// from the chart. Hit testing asks the browser whether the point is on each shape's stroke or fill.
import { useEffect, useId, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts';
import type { Bars } from '../../shared/types.ts';
import {
  Anchors,
  FIB_EXTENSION,
  FIB_RETRACEMENT,
  colorValue,
  fibExtPrice,
  fibPrice,
  loadStyleDefaults,
  newId,
  positionOutcome,
  positionStats,
  styleOf,
  type Drawing,
  type DrawingType,
  type Style,
  type Tool,
} from './drawings.ts';

export interface PaneRef {
  // 'price', or the indicator key of the panel
  id: string;
  index: number;
  // the series whose price scale the panel's drawings use
  series: ISeriesApi<SeriesType>;
}

export interface Editing {
  id: string;
  // just placed: typing the text is part of placing it, so it shares one undo step
  isNew: boolean;
}

interface Props {
  chart: IChartApi;
  box: HTMLDivElement;
  panes: PaneRef[];
  bars: Bars;
  theme: 'light' | 'dark';
  drawings: Drawing[];
  onCommit: (next: Drawing[], sameStep?: boolean) => void;
  tool: Tool | null;
  onToolDone: () => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  magnet: boolean;
  lockAll: boolean;
  hideAll: boolean;
  editing: Editing | null;
  onEdit: (e: Editing | null) => void;
  // what the next click does, for the hint under the chart
  onStep: (step: number) => void;
}

interface PaneBox {
  ref: PaneRef;
  top: number;
  height: number;
}

interface Layout {
  left: number;
  width: number;
  axisW: number;
  timeTop: number;
  timeH: number;
  panes: PaneBox[];
}

interface Pt {
  L: number;
  p: number;
}

interface Hit {
  id: string;
  handle: number | null;
}

interface Draft {
  tool: Tool;
  pane: string;
  pts: Pt[];
  // follows the pointer until the next click
  cur: Pt | null;
}

type Op =
  | { kind: 'place'; x: number; y: number }
  | { kind: 'brush'; x: number; y: number }
  | { kind: 'drag'; id: string; handle: number | null; start: Pt; orig: Drawing; pane: string; preview: Drawing | null };

const SEPARATOR = 1; // px between panels, fixed in lightweight-charts

function measure(chart: IChartApi, panes: PaneRef[]): Layout | null {
  try {
    // a panel added this frame has no size until the chart draws it, on its next frame
    const sizes: { width: number; height: number }[] = [];
    for (const [i, pane] of chart.panes().entries()) {
      if (!pane.getHTMLElement()) break;
      sizes.push(chart.paneSize(i));
    }
    if (!sizes.length) return null;
    const tops: number[] = [];
    let y = 0;
    for (const s of sizes) {
      tops.push(y);
      y += s.height + SEPARATOR;
    }
    return {
      left: chart.priceScale('left').width(),
      width: sizes[0].width,
      axisW: chart.priceScale('right').width(),
      timeTop: y - SEPARATOR,
      timeH: chart.timeScale().height(),
      panes: panes.filter((p) => p.index < sizes.length).map((p) => ({ ref: p, top: tops[p.index], height: sizes[p.index].height })),
    };
  } catch {
    return null; // the chart was removed
  }
}

const dashArray = (dash: Style['dash'], w: number) => (dash === 'dashed' ? `${w * 3 + 3} ${w * 2 + 2}` : dash === 'dotted' ? `1 ${w * 2 + 2}` : undefined);
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
const fmtPct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
const POINTS_NEEDED: Partial<Record<DrawingType, number>> = { channel: 3, fibext: 3, pitchfork: 3, triangle: 3, curve: 3, arc: 3, dcurve: 4, path: Infinity };
// the text box sits on this point
const textPoint = (d: Drawing) => (d.type === 'callout' ? 1 : 0);
const hasText = (t: DrawingType) => t === 'text' || t === 'callout';

export function DrawingLayer(props: Props) {
  const { chart, box, panes, bars, theme, drawings, onCommit, tool, onToolDone, selected, onSelect, magnet, lockAll, hideAll, editing, onEdit, onStep } = props;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [preview, setPreview] = useState<Drawing | null>(null);
  const [hover, setHover] = useState<Hit | null>(null);
  const op = useRef<Op | null>(null);
  const anchors = useMemo(() => new Anchors(bars.t), [bars.t]);

  const setDraft = (d: Draft | null) => {
    draftRef.current = d;
    setDraftState(d);
    onStep(d ? d.pts.length : 0);
  };

  // Follow pans, zooms, resizes and price-scale drags. lightweight-charts has no event for a price scale that
  // rescales itself, so compare the mapping every frame and re-render only when it moved.
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const l = measure(chart, panes);
      const ts = chart.timeScale();
      const sig = !l
        ? ''
        : [
        l.left,
        l.width,
        l.axisW,
        l.timeTop,
        l.timeH,
        ts.logicalToCoordinate(0 as Logical),
        ts.logicalToCoordinate(1000 as Logical),
            ...l.panes.flatMap((p) => [p.top, p.height, p.ref.series.priceToCoordinate(0), p.ref.series.priceToCoordinate(1)]),
          ].join('|');
      if (sig !== last) {
        last = sig;
        redraw();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [chart, panes]);

  // a new tool, or none, drops a half-placed drawing
  useEffect(() => {
    setDraft(null);
  }, [tool]);

  const layout = measure(chart, panes);
  const ts = chart.timeScale();
  const X = (L: number) => (layout?.left ?? 0) + (ts.logicalToCoordinate(L as Logical) ?? NaN);
  const paneOf = (id: string) => layout?.panes.find((p) => p.ref.id === id) ?? null;
  const yOf = (pane: PaneBox) => (p: number) => pane.top + (pane.ref.series.priceToCoordinate(p) ?? NaN);
  const paneAt = (x: number, y: number) =>
    layout && x >= layout.left && x <= layout.left + layout.width ? layout.panes.find((p) => y >= p.top && y < p.top + p.height) ?? null : null;
  const toPt = (pane: PaneBox, x: number, y: number, snapToBar: boolean): Pt | null => {
    const L = ts.coordinateToLogical(x - layout!.left);
    const p = pane.ref.series.coordinateToPrice(y - pane.top);
    return L == null || p == null ? null : { L: snapToBar ? Math.round(L) : L, p: Number(p) };
  };
  const ptsOf = (d: Drawing): Pt[] => d.pts.map((a) => ({ L: anchors.toLogical(a) ?? NaN, p: a.p }));
  const withPts = (d: Drawing, pts: Pt[]): Drawing => ({ ...d, pts: pts.map((q) => anchors.fromLogical(q.L, q.p)) });

  // magnet: on the price panel, pull a point onto the nearest open / high / low / close of its bar
  const snap = (pane: PaneBox, pt: Pt, y: number): Pt => {
    if (!magnet || pane.ref.id !== 'price' || pt.L < 0 || pt.L >= bars.t.length) return pt;
    const Y = yOf(pane);
    const i = Math.round(pt.L);
    let best = pt.p;
    let bd = 30;
    for (const v of [bars.o[i], bars.h[i], bars.l[i], bars.c[i]]) {
      const dist = Math.abs(Y(v) - y);
      if (dist < bd) [best, bd] = [v, dist];
    }
    return { L: i, p: best };
  };
  // Shift while placing the second point of a line keeps it level
  const level = (pt: Pt, shift: boolean, d: Draft | null) => (shift && d && d.pts.length === 1 && d.tool.points === 2 ? { L: pt.L, p: d.pts[0].p } : pt);

  const hitTest = (x: number, y: number, paneIndex: number): Hit | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = new DOMPoint(x, y);
    const els = svg.querySelectorAll<SVGGeometryElement>('[data-hit]');
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      const pane = el.dataset.pane;
      if (pane !== '*' && Number(pane) !== paneIndex) continue;
      const fill = el.dataset.hit === 'fill';
      if (fill ? el.isPointInFill(pt) || el.isPointInStroke(pt) : el.isPointInStroke(pt)) {
        return { id: el.dataset.id!, handle: el.dataset.handle != null ? Number(el.dataset.handle) : null };
      }
    }
    return null;
  };

  const place = (t: Tool, paneId: string, pts: Pt[]) => {
    let full = pts;
    if (t.type === 'long' || t.type === 'short') {
      // a 10% target and a 5% stop to start from; the edges drag
      const [e] = pts;
      const long = t.type === 'long';
      const right = e.L + 20;
      full = [e, { L: right, p: e.p * (long ? 1.1 : 0.9) }, { L: right, p: e.p * (long ? 0.95 : 1.05) }];
    }
    const d: Drawing = {
      id: newId(),
      type: t.type,
      pane: paneId,
      pts: full.map((q) => anchors.fromLogical(q.L, q.p)),
      style: { ...loadStyleDefaults()[t.type], ...t.style },
    };
    setDraft(null);
    onCommit([...drawings, d]);
    onSelect(d.id);
    if (hasText(t.type)) onEdit({ id: d.id, isNew: true });
    onToolDone();
  };

  const finishPath = () => {
    const d = draftRef.current;
    if (d && d.pts.length >= 2) place(d.tool, d.pane, d.pts);
    else setDraft(null);
  };

  const moveWhole = (d: Drawing, start: Pt, now: Pt): Drawing => {
    const dL = Math.round(now.L - start.L);
    const dp = now.p - start.p;
    return withPts(
      d,
      ptsOf(d).map((q) => ({ L: q.L + dL, p: q.p + dp })),
    );
  };

  const moveHandle = (d: Drawing, i: number, pt: Pt): Drawing => {
    const q = ptsOf(d).map((x) => ({ ...x }));
    const st = styleOf(d);
    switch (d.type) {
      case 'rect':
        if (i < 2) q[i] = pt;
        else if (i === 2) [q[0].L, q[1].p] = [pt.L, pt.p];
        else [q[1].L, q[0].p] = [pt.L, pt.p];
        break;
      case 'hline':
        // a full-width line only moves up and down; a ray also moves sideways
        q[0] = st.ext[0] && st.ext[1] ? { L: q[0].L, p: pt.p } : pt;
        break;
      case 'vline':
        q[0] = { L: pt.L, p: q[0].p };
        break;
      case 'channel': {
        // the width stays as it was while either end of the first line moves
        const width = q[2].p - lineAt(q[0], q[1], q[2].L);
        if (i < 2) {
          q[i] = pt;
          q[2] = { L: q[2].L, p: lineAt(q[0], q[1], q[2].L) + width };
        } else q[2] = { L: (q[0].L + q[1].L) / 2, p: pt.p };
        break;
      }
      case 'long':
      case 'short':
        if (i === 0) q[0] = pt;
        else if (i === 1) q[1] = { L: q[1].L, p: pt.p };
        else if (i === 2) q[2] = { L: q[2].L, p: pt.p };
        else {
          const L = Math.max(pt.L, q[0].L + 1);
          q[1].L = L;
          q[2].L = L;
        }
        break;
      default:
        q[i] = pt;
    }
    return withPts(d, q);
  };

  const setCursor = (c: string) => {
    if (box.dataset.cursor !== c) box.dataset.cursor = c;
  };

  // ---------- pointer handling ----------

  const down = (e: PointerEvent, x: number, y: number): boolean => {
    if (editing) return false; // the text box closes on its own blur
    const pane = paneAt(x, y);
    const d0 = draftRef.current;
    if (tool) {
      const dp = d0 ? paneOf(d0.pane) : pane;
      if (!dp) return false; // on an axis: leave it to the chart
      const free = tool.type === 'brush' || tool.type === 'text';
      const raw = toPt(dp, x, y, !free);
      if (!raw) return true;
      if (tool.points === 0) {
        op.current = { kind: 'brush', x, y };
        setDraft({ tool, pane: dp.ref.id, pts: [raw], cur: null });
        return true;
      }
      const pt = level(free ? raw : snap(dp, raw, y), e.shiftKey, d0);
      if (tool.points < 0) {
        const last = d0?.pts.at(-1);
        if (last && Math.hypot(X(last.L) - x, yOf(dp)(last.p) - y) < 6) finishPath();
        else setDraft({ tool, pane: dp.ref.id, pts: d0 ? [...d0.pts, pt] : [pt], cur: pt });
        return true;
      }
      const pts = d0 ? [...d0.pts, pt] : [pt];
      if (pts.length >= tool.points) place(tool, dp.ref.id, pts);
      else {
        setDraft({ tool, pane: dp.ref.id, pts, cur: pt });
        op.current = { kind: 'place', x, y };
      }
      return true;
    }
    if (!pane || hideAll) return false;
    const hit = hitTest(x, y, pane.ref.index);
    if (!hit) {
      if (selected) onSelect(null);
      return false; // let the chart pan
    }
    onSelect(hit.id);
    const d = drawings.find((x) => x.id === hit.id);
    if (!d || lockAll || d.locked) return true;
    const dp = paneOf(d.pane) ?? pane;
    const start = toPt(dp, x, y, false);
    if (start) {
      op.current = { kind: 'drag', id: d.id, handle: hit.handle, start, orig: d, pane: dp.ref.id, preview: null };
      setCursor('grabbing');
    }
    return true;
  };

  const move = (e: PointerEvent, x: number, y: number) => {
    const o = op.current;
    const d0 = draftRef.current;
    if (o?.kind === 'drag') {
      const dp = paneOf(o.pane);
      const raw = dp && toPt(dp, x, y, false);
      if (!dp || !raw) return;
      const next = o.handle == null ? moveWhole(o.orig, o.start, raw) : moveHandle(o.orig, o.handle, snap(dp, { L: Math.round(raw.L), p: raw.p }, y));
      o.preview = next;
      setPreview(next);
      return;
    }
    if (o?.kind === 'brush' && d0) {
      if (Math.hypot(x - o.x, y - o.y) < 3) return;
      [o.x, o.y] = [x, y];
      const dp = paneOf(d0.pane);
      const pt = dp && toPt(dp, x, y, false);
      if (pt && d0.pts.length < 5000) setDraft({ ...d0, pts: [...d0.pts, pt] });
      return;
    }
    if (d0 && tool) {
      const dp = paneOf(d0.pane);
      const raw = dp && toPt(dp, x, y, tool.type !== 'text');
      if (dp && raw) setDraft({ ...d0, cur: level(snap(dp, raw, y), e.shiftKey, d0) });
      return;
    }
    const r = box.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const pane = inside ? paneAt(x, y) : null;
    const h = !tool && pane && !hideAll && !editing ? hitTest(x, y, pane.ref.index) : null;
    if (h?.id !== hover?.id || h?.handle !== hover?.handle) setHover(h);
    if (inside) {
      const locked = h && (lockAll || drawings.find((d) => d.id === h.id)?.locked);
      setCursor(tool ? 'crosshair' : !h ? '' : locked ? 'pointer' : h.handle != null ? 'grab' : 'move');
    }
  };

  const up = (e: PointerEvent, x: number, y: number) => {
    const o = op.current;
    op.current = null;
    const d0 = draftRef.current;
    if (o?.kind === 'drag') {
      const p = o.preview;
      if (p && JSON.stringify(p.pts) !== JSON.stringify(o.orig.pts)) onCommit(drawings.map((d) => (d.id === p.id ? p : d)));
      setPreview(null);
      setCursor('');
      return;
    }
    if (o?.kind === 'brush') {
      if (d0 && d0.pts.length >= 2) place(d0.tool, d0.pane, d0.pts);
      else setDraft(null);
      return;
    }
    // press, drag, release: the release is the next point. A plain click waits for the next click.
    if (o?.kind === 'place' && d0 && Math.hypot(x - o.x, y - o.y) > 6) {
      const dp = paneOf(d0.pane);
      const raw = dp && toPt(dp, x, y, true);
      if (!dp || !raw) return;
      const pts = [...d0.pts, level(snap(dp, raw, y), e.shiftKey, d0)];
      if (pts.length >= d0.tool.points) place(d0.tool, d0.pane, pts);
      else setDraft({ ...d0, pts, cur: pts.at(-1)! });
    }
  };

  const dblclick = (x: number, y: number): boolean => {
    if (tool) return false;
    const pane = paneAt(x, y);
    const hit = pane && hitTest(x, y, pane.ref.index);
    const d = hit && drawings.find((x) => x.id === hit.id);
    if (!d || !hasText(d.type) || lockAll || d.locked) return false;
    onEdit({ id: d.id, isNew: false });
    return true;
  };

  const key = (e: KeyboardEvent): boolean => {
    const d = draftRef.current;
    if (!d || d.tool.points >= 0 || (e.target instanceof Element && e.target.closest('input, textarea'))) return false;
    if (e.key === 'Enter') finishPath();
    else if (e.key === 'Backspace') setDraft(d.pts.length > 1 ? { ...d, pts: d.pts.slice(0, -1) } : null);
    else return false;
    return true;
  };

  const handlers = useRef({ down, move, up, dblclick, key });
  handlers.current = { down, move, up, dblclick, key };

  useEffect(() => {
    let swallow = false;
    const rel = (e: MouseEvent) => {
      const r = box.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (handlers.current.down(e, ...rel(e))) {
        swallow = true;
        e.stopPropagation();
      }
    };
    // the chart pans on mousedown / touchstart, which follow pointerdown: hold back the ones we used
    const onChartDown = (e: Event) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => handlers.current.move(e, ...rel(e));
    const onUp = (e: PointerEvent) => handlers.current.up(e, ...rel(e));
    const onDbl = (e: MouseEvent) => {
      if (handlers.current.dblclick(...rel(e))) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    box.addEventListener('pointerdown', onDown, true);
    box.addEventListener('mousedown', onChartDown, true);
    box.addEventListener('touchstart', onChartDown, { capture: true, passive: false });
    box.addEventListener('dblclick', onDbl, true);
    // Enter / Backspace while placing a path; capture, so the chart page's own keys don't also act on them
    const onKey = (e: KeyboardEvent) => {
      if (handlers.current.key(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    // on the window, so a drag that leaves the chart still ends
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      box.removeEventListener('pointerdown', onDown, true);
      box.removeEventListener('mousedown', onChartDown, true);
      box.removeEventListener('touchstart', onChartDown, true);
      box.removeEventListener('dblclick', onDbl, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      delete box.dataset.cursor;
    };
  }, [box]);

  useEffect(() => {
    if (tool) setCursor('crosshair');
    else if (box.dataset.cursor === 'crosshair') setCursor('');
  }, [tool]);

  if (!layout) return null;
  const L0 = layout.left;
  const R0 = layout.left + layout.width;
  const big = 3 * (layout.width + layout.timeTop);

  // ---------- shapes ----------

  interface Rendered {
    body: ReactNode;
    hits: ReactNode;
    handles: { x: number; y: number }[];
    // anchor prices and bars, for the axis labels when selected
    prices: number[];
    times: number[];
  }

  const render = (d: Drawing, pts: Pt[], isDraft: boolean): Rendered | null => {
    const st = styleOf(d);
    const vline = d.type === 'vline';
    const pane = paneOf(d.pane) ?? (vline ? layout.panes[0] : null);
    if (!pane || pts.some((q) => !Number.isFinite(q.L))) return null;
    const Y = yOf(pane);
    const P = pts.map((q) => ({ x: X(q.L), y: Y(q.p) }));
    if (P.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) return null;
    const color = colorValue(st.color, theme);
    const line = { stroke: color, strokeWidth: st.width, strokeDasharray: dashArray(st.dash, st.width), fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    const hit = (kind: 'stroke' | 'fill', extra: object = {}) =>
      ({ 'data-hit': kind, 'data-id': d.id, 'data-pane': vline ? '*' : String(pane.ref.index), className: kind === 'fill' ? 'dh dh-fill' : 'dh', ...extra }) as object;
    const price = (p: number) => pane.ref.series.priceFormatter().format(p);
    const base = { prices: pts.map((q) => q.p), times: pts.map((q) => q.L) };

    // not all points placed yet: show what there is
    const need = POINTS_NEEDED[d.type] ?? (d.type === 'brush' ? 2 : pts.length);
    if (isDraft && (pts.length < 2 || pts.length < need) && d.type !== 'brush') {
      return {
        body: (
          <>
            {pts.length > 1 && <polyline points={P.map((q) => `${q.x},${q.y}`).join(' ')} {...line} strokeDasharray="4 4" />}
            {P.map((q, i) => (
              <circle key={i} cx={q.x} cy={q.y} r={3} fill={color} />
            ))}
          </>
        ),
        hits: null,
        handles: [],
        ...base,
      };
    }

    switch (d.type) {
      case 'line':
      case 'arrow': {
        const [a, b] = P;
        const [x1, y1, x2, y2] = extend(a, b, st.ext, big);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const s = 7 + st.width * 2;
        const head = `${b.x},${b.y} ${b.x - s * Math.cos(ang - 0.45)},${b.y - s * Math.sin(ang - 0.45)} ${b.x - s * Math.cos(ang + 0.45)},${b.y - s * Math.sin(ang + 0.45)}`;
        return {
          body: (
            <>
              <line x1={x1} y1={y1} x2={x2} y2={y2} {...line} />
              {d.type === 'arrow' && (a.x !== b.x || a.y !== b.y) && <polygon points={head} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />}
            </>
          ),
          hits: <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit('stroke')} />,
          handles: [a, b],
          ...base,
        };
      }
      case 'hline': {
        const [a] = P;
        // with both sides off it would be a dot: treat it as a ray
        const left = st.ext[0];
        const right = st.ext[1] || !st.ext[0];
        const x1 = left ? L0 : a.x;
        const x2 = right ? R0 : a.x;
        return {
          body: <line x1={x1} y1={a.y} x2={x2} y2={a.y} {...line} />,
          hits: <line x1={x1} y1={a.y} x2={x2} y2={a.y} {...hit('stroke')} />,
          handles: [left && right ? { x: L0 + layout.width / 2, y: a.y } : a],
          ...base,
          times: left && right ? [] : base.times,
        };
      }
      case 'vline': {
        const x = P[0].x;
        return {
          body: <line x1={x} y1={0} x2={x} y2={layout.timeTop} {...line} />,
          hits: <line x1={x} y1={0} x2={x} y2={layout.timeTop} {...hit('stroke')} />,
          handles: [{ x, y: pane.top + pane.height / 2 }],
          prices: [],
          times: base.times,
        };
      }
      case 'channel': {
        const [A, B, C] = pts;
        const width = C.p - lineAt(A, B, C.L);
        const off = (q: Pt, k: number) => ({ x: X(q.L), y: Y(q.p + width * k) });
        const base1 = extend(P[0], P[1], st.ext, big);
        const top1 = extend(off(A, 1), off(B, 1), st.ext, big);
        const mid1 = extend(off(A, 0.5), off(B, 0.5), st.ext, big);
        const poly = `${base1[0]},${base1[1]} ${base1[2]},${base1[3]} ${top1[2]},${top1[3]} ${top1[0]},${top1[1]}`;
        const m = off({ L: (A.L + B.L) / 2, p: (A.p + B.p) / 2 }, 1);
        return {
          body: (
            <>
              {st.fill && <polygon points={poly} fill={tint(color, 10)} stroke="none" />}
              <line x1={base1[0]} y1={base1[1]} x2={base1[2]} y2={base1[3]} {...line} />
              <line x1={top1[0]} y1={top1[1]} x2={top1[2]} y2={top1[3]} {...line} />
              <line x1={mid1[0]} y1={mid1[1]} x2={mid1[2]} y2={mid1[3]} {...line} strokeWidth={1} strokeDasharray="5 5" opacity={0.7} />
            </>
          ),
          hits: (
            <>
              {st.fill && <polygon points={poly} {...hit('fill')} />}
              <line x1={base1[0]} y1={base1[1]} x2={base1[2]} y2={base1[3]} {...hit('stroke')} />
              <line x1={top1[0]} y1={top1[1]} x2={top1[2]} y2={top1[3]} {...hit('stroke')} />
            </>
          ),
          handles: [P[0], P[1], m],
          prices: [A.p, B.p, A.p + width, B.p + width],
          times: [A.L, B.L],
        };
      }
      case 'fib':
      case 'fibext': {
        const ext = d.type === 'fibext';
        const levels = ext ? FIB_EXTENSION : FIB_RETRACEMENT;
        const priceAt = (lv: number) => (ext ? fibExtPrice(pts[0].p, pts[1].p, pts[2].p, lv) : fibPrice(pts[0].p, pts[1].p, lv));
        const x1 = ext ? P[2].x : Math.min(P[0].x, P[1].x);
        const x2 = st.ext[1] ? R0 : ext ? P[2].x + Math.max(40, Math.abs(P[1].x - P[0].x)) : Math.max(P[0].x, P[1].x);
        const ys = levels.map((lv) => Y(priceAt(lv)));
        return {
          body: (
            <>
              {st.fill &&
                ys.slice(1).map((y, i) => (
                  <rect key={i} x={x1} y={Math.min(y, ys[i])} width={Math.max(0, x2 - x1)} height={Math.abs(y - ys[i])} fill={tint(color, i % 2 ? 6 : 11)} />
                ))}
              <polyline points={P.map((q) => `${q.x},${q.y}`).join(' ')} {...line} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
              {levels.map((lv, i) => (
                <g key={lv}>
                  <line x1={x1} y1={ys[i]} x2={x2} y2={ys[i]} {...line} strokeWidth={lv === 0.5 || lv === 0.618 ? st.width + 0.6 : st.width} />
                  <text className="draw-label" x={x1 + 4} y={ys[i] - 4} style={{ fill: color }}>
                    {lv} ({price(priceAt(lv))})
                  </text>
                </g>
              ))}
            </>
          ),
          hits: (
            <>
              <polyline points={P.map((q) => `${q.x},${q.y}`).join(' ')} {...hit('stroke')} />
              {ys.map((y, i) => (
                <line key={i} x1={x1} y1={y} x2={x2} y2={y} {...hit('stroke')} />
              ))}
            </>
          ),
          handles: P,
          prices: levels.map(priceAt),
          times: base.times,
        };
      }
      case 'rect':
      case 'ellipse': {
        const [a, b] = P;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        const fill = st.fill ? tint(color, 13) : 'none';
        const shape = (extra: object) =>
          d.type === 'rect' ? <rect x={x} y={y} width={w} height={h} {...extra} /> : <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...extra} />;
        return {
          body: shape({ ...line, fill }),
          hits: shape(hit(st.fill ? 'fill' : 'stroke')),
          handles: d.type === 'rect' ? [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }] : [a, b],
          ...base,
        };
      }
      case 'brush': {
        const path = `M${P.map((q) => `${q.x},${q.y}`).join('L')}`;
        return { body: <path d={path} {...line} />, hits: <path d={path} {...hit('stroke')} />, handles: [], prices: [], times: [] };
      }
      case 'measure': {
        const [a, b] = P;
        const change = pts[1].p - pts[0].p;
        const tone = change > 0 ? 'var(--up)' : change < 0 ? 'var(--down)' : 'var(--muted)';
        const nBars = Math.round(Math.abs(pts[1].L - pts[0].L));
        const days = Math.round(Math.abs(Date.parse(anchors.dateAt(pts[1].L)) - Date.parse(anchors.dateAt(pts[0].L))) / 86_400_000);
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        const above = y - 10 > pane.top + 30;
        return {
          body: (
            <>
              <rect x={x} y={y} width={w} height={h} fill={tint(tone, 15)} stroke="none" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={tone} strokeWidth={1.5} />
              <text className="draw-label" x={x + w / 2} y={above ? y - 22 : y + h + 16} textAnchor="middle" style={{ fill: tone }}>
                {change >= 0 ? '+' : ''}
                {price(change)} ({fmtPct((change / pts[0].p) * 100)})
              </text>
              <text className="draw-label muted" x={x + w / 2} y={above ? y - 7 : y + h + 31} textAnchor="middle">
                {nBars} {nBars === 1 ? 'bar' : 'bars'}, {days} {days === 1 ? 'day' : 'days'}
              </text>
            </>
          ),
          hits: <rect x={x} y={y} width={w} height={h} {...hit('fill')} />,
          handles: [a, b],
          ...base,
        };
      }
      case 'long':
      case 'short': {
        const [E, T, S] = pts;
        const side = d.type;
        const xl = X(E.L);
        const xr = X(T.L);
        const [yE, yT, yS] = [Y(E.p), Y(T.p), Y(S.p)];
        const stats = positionStats(E.p, T.p, S.p);
        const out = positionOutcome(bars, E.L, T.L, side, T.p, S.p);
        const box = (y1: number, y2: number, c: string, extra: object = {}) => (
          <rect x={Math.min(xl, xr)} y={Math.min(y1, y2)} width={Math.abs(xr - xl)} height={Math.abs(y2 - y1)} fill={tint(c, 16)} {...extra} />
        );
        const cx = (xl + xr) / 2;
        const label = (y: number, edge: number, text: string, c: string) => (
          // inside the box, near its outer edge
          <text className="draw-label" x={cx} y={edge < y ? edge + 15 : edge - 6} textAnchor="middle" style={{ fill: c }}>
            {text}
          </text>
        );
        return {
          body: (
            <>
              {box(yE, yT, 'var(--up)')}
              {box(yE, yS, 'var(--down)')}
              <line x1={xl} y1={yE} x2={xr} y2={yE} stroke="var(--text-2)" strokeWidth={1} />
              {label(yE, yT, `Target ${price(T.p)} (${fmtPct(stats.targetPct)})`, 'var(--up)')}
              {label(yE, yS, `Stop ${price(S.p)} (${fmtPct(stats.stopPct)})`, 'var(--down)')}
              <text className="draw-label" x={cx} y={yE - 5} textAnchor="middle">
                Entry {price(E.p)} · reward/risk {stats.ratio == null ? '—' : stats.ratio.toFixed(2)}
              </text>
              {out && (
                <>
                  <circle cx={X(out.at)} cy={out.hit === 'target' ? yT : yS} r={4} fill={out.hit === 'target' ? 'var(--up)' : 'var(--down)'} stroke="var(--surface)" strokeWidth={1.5} />
                  <text className="draw-label" x={cx} y={yE + 14} textAnchor="middle" style={{ fill: out.hit === 'target' ? 'var(--up)' : 'var(--down)' }}>
                    {out.hit === 'target' ? 'Reached the target' : 'Stopped out'} on {bars.t[out.at]}
                  </text>
                </>
              )}
            </>
          ),
          hits: (
            <>
              {box(yE, yT, 'transparent', hit('fill'))}
              {box(yE, yS, 'transparent', hit('fill'))}
            </>
          ),
          handles: [
            { x: xl, y: yE },
            { x: xl, y: yT },
            { x: xl, y: yS },
            { x: xr, y: yE },
          ],
          prices: [E.p, T.p, S.p],
          times: [E.L, T.L],
        };
      }
      case 'info': {
        const [a, b] = P;
        const [x1, y1, x2, y2] = extend(a, b, st.ext, big);
        const change = pts[1].p - pts[0].p;
        const nBars = Math.round(Math.abs(pts[1].L - pts[0].L));
        const right = b.x >= a.x;
        return {
          body: (
            <>
              <line x1={x1} y1={y1} x2={x2} y2={y2} {...line} />
              <text className="draw-label" x={b.x + (right ? 8 : -8)} y={b.y - 8} textAnchor={right ? 'start' : 'end'} style={{ fill: color }}>
                {change >= 0 ? '+' : ''}
                {price(change)} ({fmtPct((change / pts[0].p) * 100)}) · {nBars} {nBars === 1 ? 'bar' : 'bars'}
              </text>
            </>
          ),
          hits: <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit('stroke')} />,
          handles: [a, b],
          ...base,
        };
      }
      case 'cross': {
        const [a] = P;
        return {
          body: (
            <>
              <g clipPath={`url(#${uid}-p${pane.ref.index})`}>
                <line x1={L0} y1={a.y} x2={R0} y2={a.y} {...line} />
              </g>
              <line x1={a.x} y1={0} x2={a.x} y2={layout.timeTop} {...line} />
            </>
          ),
          hits: (
            <>
              <line x1={L0} y1={a.y} x2={R0} y2={a.y} {...hit('stroke')} />
              <line x1={a.x} y1={0} x2={a.x} y2={layout.timeTop} {...hit('stroke', { 'data-pane': '*' })} />
            </>
          ),
          handles: [a],
          ...base,
        };
      }
      case 'pitchfork': {
        const [p0, p1, p2] = P;
        const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const along = (s: { x: number; y: number }) => extend(s, { x: s.x + m.x - p0.x, y: s.y + m.y - p0.y }, [false, true], big);
        const med = extend(p0, m, [false, true], big);
        const t1 = along(p1);
        const t2 = along(p2);
        const poly = `${t1[0]},${t1[1]} ${t1[2]},${t1[3]} ${t2[2]},${t2[3]} ${t2[0]},${t2[1]}`;
        const seg = (q: number[], extra: object = {}) => <line x1={q[0]} y1={q[1]} x2={q[2]} y2={q[3]} {...extra} />;
        return {
          body: (
            <>
              {st.fill && <polygon points={poly} fill={tint(color, 9)} stroke="none" />}
              {seg(med, line)}
              {seg(t1, line)}
              {seg(t2, line)}
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} {...line} strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
            </>
          ),
          hits: (
            <>
              {seg(med, hit('stroke'))}
              {seg(t1, hit('stroke'))}
              {seg(t2, hit('stroke'))}
            </>
          ),
          handles: P,
          ...base,
        };
      }
      case 'fibtz': {
        const [A, B] = pts;
        const unit = B.L - A.L || 1;
        const zones = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
        const xs = zones.map((k) => X(A.L + k * unit));
        return {
          body: (
            <>
              <line x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} {...line} strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
              {xs.map((x, i) => (
                <g key={i}>
                  <line x1={x} y1={pane.top} x2={x} y2={pane.top + pane.height} {...line} />
                  <text className="draw-label" x={x + 4} y={pane.top + 14} style={{ fill: color }}>
                    {zones[i]}
                  </text>
                </g>
              ))}
            </>
          ),
          hits: xs.map((x, i) => <line key={i} x1={x} y1={pane.top} x2={x} y2={pane.top + pane.height} {...hit('stroke')} />),
          handles: P,
          prices: [],
          times: base.times,
        };
      }
      case 'circle': {
        const [c, e] = P;
        const r = Math.hypot(e.x - c.x, e.y - c.y);
        return {
          body: <circle cx={c.x} cy={c.y} r={r} {...line} fill={st.fill ? tint(color, 13) : 'none'} />,
          hits: <circle cx={c.x} cy={c.y} r={r} {...hit(st.fill ? 'fill' : 'stroke')} />,
          handles: P,
          ...base,
        };
      }
      case 'triangle': {
        const poly = P.map((q) => `${q.x},${q.y}`).join(' ');
        return {
          body: <polygon points={poly} {...line} fill={st.fill ? tint(color, 13) : 'none'} />,
          hits: <polygon points={poly} {...hit(st.fill ? 'fill' : 'stroke')} />,
          handles: P,
          ...base,
        };
      }
      case 'path': {
        const poly = P.map((q) => `${q.x},${q.y}`).join(' ');
        return { body: <polyline points={poly} {...line} />, hits: <polyline points={poly} {...hit('stroke')} />, handles: P, ...base };
      }
      case 'curve':
      case 'dcurve':
      case 'arc': {
        const path = d.type === 'curve' ? curvePath(P[0], P[1], P[2]) : d.type === 'dcurve' ? sCurvePath(P[0], P[1], P[2], P[3]) : arcPath(P[0], P[1], P[2]);
        return { body: <path d={path} {...line} />, hits: <path d={path} {...hit('stroke')} />, handles: P, ...base };
      }
      case 'callout': {
        const [a, b] = P;
        if (editing?.id === d.id || !d.text) {
          // still being typed: just the pointer, so you can see what it points at
          return { body: <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={1} strokeDasharray="4 4" />, hits: null, handles: [], prices: [], times: [] };
        }
        const lines = d.text.split('\n');
        const lh = st.size * 1.3;
        const w = Math.max(...lines.map((l) => l.length)) * st.size * 0.58 + 18;
        const h = lines.length * lh + 10;
        return {
          body: (
            <>
              <line x1={a.x} y1={a.y} x2={b.x + w / 2} y2={b.y + h / 2} stroke={color} strokeWidth={st.width} />
              <circle cx={a.x} cy={a.y} r={2.5} fill={color} />
              <rect x={b.x} y={b.y} width={w} height={h} rx={6} fill={`color-mix(in srgb, ${color} 14%, var(--surface))`} stroke={color} strokeWidth={st.width} />
              <text className="draw-text" x={b.x + 9} y={b.y + 4 + st.size} style={{ fill: 'var(--text)', fontSize: st.size }}>
                {lines.map((l, i) => (
                  <tspan key={i} x={b.x + 9} dy={i ? lh : 0}>
                    {l || ' '}
                  </tspan>
                ))}
              </text>
            </>
          ),
          hits: (
            <>
              <line x1={a.x} y1={a.y} x2={b.x + w / 2} y2={b.y + h / 2} {...hit('stroke')} />
              <rect x={b.x} y={b.y} width={w} height={h} {...hit('fill')} />
            </>
          ),
          handles: [a, b],
          ...base,
        };
      }
      case 'pricelabel': {
        const [a] = P;
        const txt = price(pts[0].p);
        const w = txt.length * 7.2 + 14;
        const x = a.x + 8;
        const y = a.y - 26;
        return {
          body: (
            <>
              <path d={`M${a.x},${a.y} L${x + 4},${y + 20} L${x + 14},${y + 20} Z`} fill={color} />
              <rect x={x} y={y} width={w} height={20} rx={4} fill={color} />
              <circle cx={a.x} cy={a.y} r={2.5} fill={color} />
              <text className="axis-label" x={x + w / 2} y={y + 14} textAnchor="middle">
                {txt}
              </text>
            </>
          ),
          hits: <rect x={x} y={y} width={w} height={20} {...hit('fill')} />,
          handles: [a],
          ...base,
        };
      }
      case 'markup':
      case 'markdown': {
        const [a] = P;
        const k = d.type === 'markup' ? 1 : -1; // the tip sits on the point; the shaft hangs below an up arrow
        const s = 9;
        const poly = [
          [a.x, a.y],
          [a.x - s, a.y + k * s],
          [a.x - s * 0.4, a.y + k * s],
          [a.x - s * 0.4, a.y + k * s * 2.3],
          [a.x + s * 0.4, a.y + k * s * 2.3],
          [a.x + s * 0.4, a.y + k * s],
          [a.x + s, a.y + k * s],
        ]
          .map((q) => q.join(','))
          .join(' ');
        return {
          body: <polygon points={poly} fill={color} stroke="var(--surface)" strokeWidth={1} strokeLinejoin="round" />,
          hits: <polygon points={poly} {...hit('fill')} />,
          handles: [],
          ...base,
        };
      }
      case 'text': {
        const lines = (d.text ?? '').split('\n');
        if (editing?.id === d.id || !d.text) return { body: null, hits: null, handles: [], prices: [], times: [] };
        const [a] = P;
        const lh = st.size * 1.3;
        const w = Math.max(...lines.map((l) => l.length)) * st.size * 0.58 + 8;
        return {
          body: (
            <text className="draw-text" x={a.x} y={a.y + st.size} style={{ fill: color, fontSize: st.size }}>
              {lines.map((l, i) => (
                <tspan key={i} x={a.x} dy={i ? lh : 0}>
                  {l || ' '}
                </tspan>
              ))}
            </text>
          ),
          hits: <rect x={a.x - 4} y={a.y - 2} width={w} height={lines.length * lh + 6} {...hit('fill')} />,
          handles: [],
          prices: [],
          times: [],
        };
      }
    }
  };

  // ---------- assemble ----------

  const shown = hideAll ? [] : drawings.map((d) => (preview?.id === d.id ? preview : d));
  const out: { d: Drawing; r: Rendered; draft: boolean }[] = [];
  for (const d of shown) {
    const r = render(d, ptsOf(d), false);
    if (r) out.push({ d, r, draft: false });
  }
  if (draft) {
    const pts = [...draft.pts, ...(draft.cur ? [draft.cur] : [])];
    const fake: Drawing = { id: '__draft', type: draft.tool.type, pane: draft.pane, pts: [], style: { ...loadStyleDefaults()[draft.tool.type], ...draft.tool.style } };
    const r = render(fake, pts, true);
    if (r) out.push({ d: fake, r, draft: true });
  }
  const active = out.filter(({ d, draft }) => draft || d.id === selected || (d.id === hover?.id && !op.current));
  const clipOf = (d: Drawing) => (d.type === 'vline' || d.type === 'cross' ? `${uid}-all` : `${uid}-p${paneOf(d.pane)?.ref.index ?? 0}`);

  // labels on the axes: horizontal lines always, the selected drawing's points while selected
  const axis: ReactNode[] = [];
  // a label that would overlap one already placed is skipped; the selected drawing's go first
  const placedY: number[] = [];
  const placedX: number[] = [];
  const isActiveId = (id: string) => active.some((a) => a.d.id === id);
  for (const { d, r } of [...out].sort((a, b) => Number(isActiveId(b.d.id)) - Number(isActiveId(a.d.id)))) {
    const isActive = isActiveId(d.id);
    if (!isActive && d.type !== 'hline' && d.type !== 'vline' && d.type !== 'cross') continue;
    const st = styleOf(d);
    const color = d.type === 'long' || d.type === 'short' || d.type === 'measure' ? 'var(--text-2)' : colorValue(st.color, theme);
    const pane = paneOf(d.pane) ?? layout.panes[0];
    const Y = yOf(pane);
    const prices = isActive || d.type === 'hline' || d.type === 'cross' ? r.prices : [];
    const times = isActive || d.type === 'vline' || d.type === 'cross' ? r.times : [];
    if (isActive && prices.length > 1 && d.type !== 'fib' && d.type !== 'fibext') {
      const ys = prices.map(Y);
      axis.push(<rect key={`${d.id}-pb`} x={R0} y={Math.min(...ys)} width={layout.axisW} height={Math.max(...ys) - Math.min(...ys)} fill={tint(color, 14)} />);
    }
    if (isActive && times.length > 1) {
      const xs = times.map(X);
      axis.push(<rect key={`${d.id}-tb`} x={Math.min(...xs)} y={layout.timeTop} width={Math.max(...xs) - Math.min(...xs)} height={layout.timeH} fill={tint(color, 14)} />);
    }
    prices.forEach((p, i) => {
      const y = Y(p);
      if (y < pane.top || y > pane.top + pane.height || placedY.some((q) => Math.abs(q - y) < 18)) return;
      placedY.push(y);
      axis.push(
        <g key={`${d.id}-p${i}`}>
          <rect x={R0} y={y - 9} width={layout.axisW} height={18} rx={2} fill={color} />
          <text className="axis-label" x={R0 + layout.axisW / 2} y={y + 4} textAnchor="middle">
            {pane.ref.series.priceFormatter().format(p)}
          </text>
        </g>,
      );
    });
    [...new Set(times)].forEach((L, i) => {
      const x = X(L);
      if (x < L0 || x > R0 || placedX.some((q) => Math.abs(q - x) < 82)) return;
      placedX.push(x);
      axis.push(
        <g key={`${d.id}-t${i}`}>
          <rect x={x - 40} y={layout.timeTop + 1} width={80} height={layout.timeH - 2} rx={2} fill={color} />
          <text className="axis-label" x={x} y={layout.timeTop + layout.timeH / 2 + 4} textAnchor="middle">
            {anchors.dateAt(L)}
          </text>
        </g>,
      );
    });
  }

  const editingDrawing = editing ? drawings.find((d) => d.id === editing.id) : undefined;
  const editPane = editingDrawing && paneOf(editingDrawing.pane);
  const editPt = editingDrawing && ptsOf(editingDrawing)[textPoint(editingDrawing)];
  const editPad = editingDrawing?.type === 'callout' ? 9 : 0;

  return (
    <>
      <svg ref={svgRef} className="draw-layer" width="100%" height="100%" aria-hidden>
        <defs>
          {layout.panes.map((p) => (
            <clipPath key={p.ref.index} id={`${uid}-p${p.ref.index}`}>
              <rect x={L0} y={p.top} width={layout.width} height={p.height} />
            </clipPath>
          ))}
          <clipPath id={`${uid}-all`}>
            <rect x={L0} y={0} width={layout.width} height={layout.timeTop} />
          </clipPath>
        </defs>
        {out.map(({ d, r }) => (
          <g key={d.id} clipPath={`url(#${clipOf(d)})`} opacity={d.id === selected || !selected ? 1 : 0.92}>
            {r.body}
            {r.hits}
          </g>
        ))}
        {axis}
        {active.map(({ d, r, draft: isDraft }) =>
          r.handles.map((h, i) => (
            <circle
              key={`${d.id}-h${i}`}
              className="draw-handle"
              cx={h.x}
              cy={h.y}
              r={isDraft ? 3.5 : 5}
              style={{ stroke: d.type === 'long' || d.type === 'short' || d.type === 'measure' ? 'var(--text-2)' : colorValue(styleOf(d).color, theme) }}
              {...(isDraft || lockAll || d.locked
                ? {}
                : { 'data-hit': 'fill', 'data-id': d.id, 'data-handle': i, 'data-pane': d.type === 'vline' ? '*' : String(paneOf(d.pane)?.ref.index ?? 0) })}
            />
          )),
        )}
      </svg>
      {editingDrawing && editPane && editPt && (
        <TextEditor
          key={editingDrawing.id}
          x={X(editPt.L) + editPad}
          y={yOf(editPane)(editPt.p) + editPad / 2}
          size={styleOf(editingDrawing).size}
          color={colorValue(styleOf(editingDrawing).color, theme)}
          initial={editingDrawing.text ?? ''}
          onDone={(text) => {
            const rest = drawings.filter((d) => d.id !== editingDrawing.id);
            const next = text.trim() ? drawings.map((d) => (d.id === editingDrawing.id ? { ...d, text } : d)) : rest;
            if (text !== (editingDrawing.text ?? '') || !text.trim()) onCommit(next, editing!.isNew);
            if (!text.trim()) onSelect(null);
            onEdit(null);
          }}
        />
      )}
    </>
  );
}

function TextEditor({ x, y, size, color, initial, onDone }: { x: number; y: number; size: number; color: string; initial: string; onDone: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (text: string) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  const rows = Math.max(1, initial.split('\n').length);
  return (
    <textarea
      ref={ref}
      className="draw-text-edit"
      style={{ left: x - 4, top: y - 3, fontSize: size, color }}
      defaultValue={initial}
      rows={rows}
      placeholder="Type, then Enter"
      aria-label="Text on the chart. Enter to finish, Shift+Enter for a new line, Esc to cancel."
      onInput={(e) => {
        const el = e.currentTarget;
        el.rows = Math.max(1, el.value.split('\n').length);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(initial);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

type XY = { x: number; y: number };

// a quadratic curve from a to b that passes through m halfway
function curvePath(a: XY, m: XY, b: XY) {
  const c = { x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 };
  return `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
}

// a cubic from a to b through q1 and q2, at a third and two thirds of the way
function sCurvePath(a: XY, q1: XY, q2: XY, b: XY) {
  const c1 = { x: (-5 * a.x + 18 * q1.x - 9 * q2.x + 2 * b.x) / 6, y: (-5 * a.y + 18 * q1.y - 9 * q2.y + 2 * b.y) / 6 };
  const c2 = { x: (2 * a.x - 9 * q1.x + 18 * q2.x - 5 * b.x) / 6, y: (2 * a.y - 9 * q1.y + 18 * q2.y - 5 * b.y) / 6 };
  return `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`;
}

// the arc of the circle through a, m and b that runs from a to b by way of m; a straight line if they line up
function arcPath(a: XY, m: XY, b: XY) {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-6) return `M${a.x},${a.y} L${m.x},${m.y} L${b.x},${b.y}`;
  const sq = (p: XY) => p.x * p.x + p.y * p.y;
  const cx = (sq(a) * (m.y - b.y) + sq(m) * (b.y - a.y) + sq(b) * (a.y - m.y)) / d;
  const cy = (sq(a) * (b.x - m.x) + sq(m) * (a.x - b.x) + sq(b) * (m.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const TAU = Math.PI * 2;
  const ang = (p: XY) => Math.atan2(p.y - cy, p.x - cx);
  const span = (from: number, to: number) => (((to - from) % TAU) + TAU) % TAU;
  // going the way angles grow (clockwise on screen, SVG's sweep 1), does the arc from a to b pass m?
  const ab = span(ang(a), ang(b));
  const sweep = span(ang(a), ang(m)) < ab ? 1 : 0;
  const large = (sweep ? ab : TAU - ab) > Math.PI ? 1 : 0;
  return `M${a.x},${a.y} A${r},${r} 0 ${large} ${sweep} ${b.x},${b.y}`;
}

// price on the line through a and b at bar L
function lineAt(a: Pt, b: Pt, L: number) {
  return b.L === a.L ? a.p : a.p + ((b.p - a.p) * (L - a.L)) / (b.L - a.L);
}

// the segment a-b, carried on past a and / or b far enough to leave the chart
function extend(a: { x: number; y: number }, b: { x: number; y: number }, ext: [boolean, boolean], big: number): [number, number, number, number] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return [a.x, a.y, b.x, b.y];
  const k = big / len;
  return [ext[0] ? a.x - dx * k : a.x, ext[0] ? a.y - dy * k : a.y, ext[1] ? b.x + dx * k : b.x, ext[1] ? b.y + dy * k : b.y];
}

