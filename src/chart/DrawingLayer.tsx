// SVG overlay on the price panel that renders and edits drawings. It follows the chart by re-reading the
// price/time mapping every animation frame and re-rendering only when that mapping changes (pan, zoom, resize,
// price-scale drag).
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts';
import { Anchors, FIB_LEVELS, TOOLS, newId, type Anchor, type Drawing, type DrawingType } from './drawings.ts';
import * as fmt from '../format.ts';

interface Props {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  dates: string[];
  drawings: Drawing[];
  onChange: (drawings: Drawing[]) => void;
  /** Active drawing tool, or null for select / move. */
  tool: DrawingType | null;
  onToolDone: () => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

interface Pt {
  L: number;
  p: number;
}

type Drag = { id: string; mode: 'move' | 'a' | 'b'; start: Pt; orig: Drawing };

export function DrawingLayer({ chart, series, dates, drawings, onChange, tool, onToolDone, selected, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const [draft, setDraft] = useState<{ type: DrawingType; a: Pt; b: Pt; down: { x: number; y: number } } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Drawing | null>(null);
  const anchors = useMemo(() => new Anchors(dates), [dates]);

  // Follow pans / zooms / resizes.
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      try {
        const ts = chart.timeScale();
        const s = chart.paneSize(0);
        const sig = `${s.width}|${s.height}|${ts.logicalToCoordinate(0 as Logical)}|${ts.logicalToCoordinate(10 as Logical)}|${series.priceToCoordinate(100)}|${series.priceToCoordinate(1000)}`;
        if (sig !== last) {
          last = sig;
          redraw();
        }
      } catch {
        return; // chart was removed
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [chart, series]);

  // A tool switched off mid-draw drops the half-made drawing.
  useEffect(() => {
    if (!tool) setDraft(null);
  }, [tool]);

  let size = { width: 0, height: 0 };
  try {
    size = chart.paneSize(0);
  } catch {
    return null;
  }
  const ts = chart.timeScale();
  const x = (L: number) => ts.logicalToCoordinate(L as Logical) ?? NaN;
  const y = (p: number) => series.priceToCoordinate(p) ?? NaN;

  const pointAt = (clientX: number, clientY: number): Pt | null => {
    const r = svgRef.current!.getBoundingClientRect();
    const L = ts.coordinateToLogical(clientX - r.left);
    const p = series.coordinateToPrice(clientY - r.top);
    return L == null || p == null ? null : { L: Math.round(L), p: Number(p) };
  };
  const toAnchor = (pt: Pt): Anchor => anchors.fromLogical(pt.L, Math.round(pt.p * 100) / 100);
  const showCrosshair = (pt: Pt) => {
    const d = dates[pt.L];
    if (d) chart.setCrosshairPosition(pt.p, d, series);
  };

  const commit = (type: DrawingType, a: Pt, b?: Pt) => {
    const d: Drawing = { id: newId(), type, a: toAnchor(a), ...(b ? { b: toAnchor(b) } : {}) };
    onChange([...drawings, d]);
    onSelect(d.id);
    setDraft(null);
    onToolDone();
  };

  // ---- drawing with a tool: click-click or press-drag-release ----
  const onToolDown = (e: React.PointerEvent) => {
    if (!tool || e.button !== 0) return;
    const pt = pointAt(e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    if (TOOLS.find((t) => t.type === tool)!.points === 1) return commit(tool, pt);
    if (draft) return commit(draft.type, draft.a, pt);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDraft({ type: tool, a: pt, b: pt, down: { x: e.clientX, y: e.clientY } });
  };
  const onToolMove = (e: React.PointerEvent) => {
    const pt = pointAt(e.clientX, e.clientY);
    if (!pt) return;
    showCrosshair(pt);
    if (draft) setDraft({ ...draft, b: pt });
  };
  const onToolUp = (e: React.PointerEvent) => {
    if (!draft) return;
    const moved = Math.hypot(e.clientX - draft.down.x, e.clientY - draft.down.y) > 6;
    if (moved) {
      const pt = pointAt(e.clientX, e.clientY);
      if (pt) commit(draft.type, draft.a, pt);
    }
  };

  // ---- selecting / moving existing drawings ----
  const startDrag = (e: React.PointerEvent, d: Drawing, mode: Drag['mode']) => {
    if (tool || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const pt = pointAt(e.clientX, e.clientY);
    onSelect(d.id);
    if (pt) setDrag({ id: d.id, mode, start: pt, orig: d });
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const pt = pointAt(e.clientX, e.clientY);
      if (!pt) return;
      const { orig, start, mode } = drag;
      const shift = (a: Anchor): Anchor => {
        const L = anchors.toLogical(a);
        return L == null ? a : anchors.fromLogical(L + pt.L - start.L, Math.round((a.p + pt.p - start.p) * 100) / 100);
      };
      if (mode === 'move') setPreview({ ...orig, a: shift(orig.a), ...(orig.b ? { b: shift(orig.b) } : {}) });
      else setPreview({ ...orig, [mode]: toAnchor(pt) });
    };
    const up = () => {
      setPreview((p) => {
        if (p) onChange(drawings.map((d) => (d.id === p.id ? p : d)));
        return null;
      });
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // Keyed on `drag` alone: the handlers use this render's drawings and mapping, which can't change mid-drag.
  }, [drag]);

  const W = size.width;
  const H = size.height;
  const shown = drawings.map((d) => (preview?.id === d.id ? preview : d));
  if (draft) shown.push({ id: '__draft', type: draft.type, a: toAnchor(draft.a), b: toAnchor(draft.b) });

  return (
    <svg
      ref={svgRef}
      className={`draw-layer ${tool ? 'drawing' : ''}`}
      width={W}
      height={H}
      style={{ pointerEvents: tool ? 'all' : 'none' }}
      onPointerDown={onToolDown}
      onPointerMove={tool ? onToolMove : undefined}
      onPointerUp={onToolUp}
      onPointerLeave={() => tool && chart.clearCrosshairPosition()}
    >
      {shown.map((d) => {
        const La = anchors.toLogical(d.a);
        const Lb = d.b ? anchors.toLogical(d.b) : La;
        if (La == null || Lb == null) return null;
        const g = { ax: x(La), ay: y(d.a.p), bx: x(Lb), by: y(d.b?.p ?? d.a.p) };
        if ([g.ax, g.ay, g.bx, g.by].some(Number.isNaN)) return null;
        const isSel = d.id === selected || d.id === '__draft';
        return (
          <g key={d.id} className={`drawing ${isSel ? 'sel' : ''}`}>
            <Shape d={d} g={g} W={W} La={La} Lb={Lb} onPointerDown={(e) => startDrag(e, d, 'move')} />
            {isSel && d.id !== '__draft' && (
              <>
                <circle className="handle" cx={d.type === 'hline' ? W - 40 : g.ax} cy={g.ay} r={6} onPointerDown={(e) => startDrag(e, d, d.type === 'hline' ? 'move' : 'a')} />
                {d.b && <circle className="handle" cx={g.bx} cy={g.by} r={6} onPointerDown={(e) => startDrag(e, d, 'b')} />}
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

interface ShapeProps {
  d: Drawing;
  g: { ax: number; ay: number; bx: number; by: number };
  W: number;
  La: number;
  Lb: number;
  onPointerDown: (e: React.PointerEvent) => void;
}

function Label({ x, y, text, anchor = 'start', tone }: { x: number; y: number; text: string; anchor?: 'start' | 'end' | 'middle'; tone?: string }) {
  return (
    <text className={`draw-label ${tone ?? ''}`} x={x} y={y} textAnchor={anchor}>
      {text}
    </text>
  );
}

function Shape({ d, g, W, La, Lb, onPointerDown }: ShapeProps) {
  const { ax, ay, bx, by } = g;
  switch (d.type) {
    case 'trend':
    case 'ray': {
      let ex = bx;
      let ey = by;
      if (d.type === 'ray' && (bx !== ax || by !== ay)) {
        const k = 4000 / Math.max(1, Math.hypot(bx - ax, by - ay));
        ex = ax + (bx - ax) * k;
        ey = ay + (by - ay) * k;
      }
      return (
        <>
          <line className="draw-line" x1={ax} y1={ay} x2={ex} y2={ey} />
          <line className="draw-hit" x1={ax} y1={ay} x2={ex} y2={ey} onPointerDown={onPointerDown} />
        </>
      );
    }
    case 'hline':
      return (
        <>
          <line className="draw-line" x1={0} y1={ay} x2={W} y2={ay} />
          <line className="draw-hit" x1={0} y1={ay} x2={W} y2={ay} onPointerDown={onPointerDown} />
          <Label x={W - 6} y={ay - 6} text={fmt.price(d.a.p)} anchor="end" />
        </>
      );
    case 'rect': {
      const rx = Math.min(ax, bx);
      const ry = Math.min(ay, by);
      return <rect className="draw-rect" x={rx} y={ry} width={Math.abs(bx - ax)} height={Math.abs(by - ay)} onPointerDown={onPointerDown} />;
    }
    case 'fib': {
      const pa = d.a.p;
      const pb = d.b!.p;
      const x1 = Math.min(ax, bx);
      const x2 = Math.max(ax, bx);
      return (
        <>
          <line className="draw-line faint" x1={ax} y1={ay} x2={bx} y2={by} />
          {FIB_LEVELS.map((lv) => {
            // Like TradingView: the first click is level 1, the second is level 0.
            const price = pb + (pa - pb) * lv;
            const ly = ay + (by - ay) * (1 - lv);
            return (
              <g key={lv}>
                <line className={`draw-line fib ${lv === 0.618 || lv === 0.5 ? 'key' : ''}`} x1={x1} y1={ly} x2={x2} y2={ly} />
                <Label x={x1 + 4} y={ly - 4} text={`${lv} (${fmt.price(price)})`} />
              </g>
            );
          })}
          <rect className="draw-hit-area" x={x1} y={Math.min(ay, by)} width={x2 - x1} height={Math.abs(by - ay)} onPointerDown={onPointerDown} />
        </>
      );
    }
    case 'measure': {
      const change = d.b!.p - d.a.p;
      const pct = (change / d.a.p) * 100;
      const tone = change > 0 ? 'up' : change < 0 ? 'down' : '';
      const bars = Math.round(Lb - La);
      return (
        <>
          <rect className={`draw-measure ${tone}`} x={Math.min(ax, bx)} y={Math.min(ay, by)} width={Math.abs(bx - ax)} height={Math.abs(by - ay)} onPointerDown={onPointerDown} />
          <line className={`draw-line ${tone}`} x1={ax} y1={ay} x2={bx} y2={by} />
          <Label
            x={(ax + bx) / 2}
            y={Math.min(ay, by) - 8}
            anchor="middle"
            tone={tone}
            text={`${change >= 0 ? '+' : ''}${fmt.price(change)} (${fmt.pct(pct)}) · ${Math.abs(bars)} ${Math.abs(bars) === 1 ? 'day' : 'days'}`}
          />
        </>
      );
    }
  }
}
