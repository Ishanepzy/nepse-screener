import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
} from 'lightweight-charts';
import type { ChartResponse, Condition } from '../../shared/types.ts';
import { getDef } from '../../shared/registry.ts';
import { api } from '../api.ts';
import * as fmt from '../format.ts';
import { DrawingLayer } from '../chart/DrawingLayer.tsx';
import { TOOLS, loadDrawings, saveDrawings, type Drawing, type DrawingType } from '../chart/drawings.ts';
import {
  GUIDES,
  computeIndicator,
  indicatorKey,
  indicatorLabel,
  loadIndicators,
  saveIndicators,
  withScanIndicators,
  type ChartIndicator,
} from '../chart/indicators.ts';
import { IndicatorMenu } from './IndicatorMenu.tsx';

// Colour-blind-safe categorical order (validated per surface); an indicator keeps its slot for life.
const PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
const RANGES = { '3M': 63, '6M': 125, '1Y': 250, '2Y': 500, All: 0 } as const;
type Range = keyof typeof RANGES;
const VOLUME_KEY = 'nepse.chart.volume';

interface Props {
  symbol: string;
  conditions: Condition[];
  theme: 'light' | 'dark';
  /** The results list this chart was opened from, for previous / next. */
  list: string[];
  onNavigate: (symbol: string) => void;
  onClose: () => void;
}

interface Parts {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  markers: ISeriesMarkersPluginApi<Time>;
}

function applyRange(chart: IChartApi, n: number, r: Range) {
  const bars = RANGES[r];
  if (!bars || bars >= n) chart.timeScale().fitContent();
  else chart.timeScale().setVisibleLogicalRange({ from: n - bars, to: n + 3 });
}

const readFlag = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const writeFlag = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* convenience only */
  }
};

export function ChartPage({ symbol, conditions, theme, list, onNavigate, onClose }: Props) {
  const [data, setData] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('1Y');
  const [hover, setHover] = useState<number | null>(null);
  const [parts, setParts] = useState<Parts | null>(null);
  const [showVolume, setShowVolumeState] = useState(() => readFlag(VOLUME_KEY, true));
  const [showSignals, setShowSignals] = useState(true);
  const [tool, setTool] = useState<DrawingType | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  /** native = browser full screen; focus = fallback where the browser refuses it: hide the title row instead. */
  const [fullscreen, setFullscreen] = useState<'off' | 'native' | 'focus'>('off');
  const pageRef = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const indicatorSeries = useRef<ISeriesApi<SeriesType>[]>([]);
  /** The live chart. Effects compare against it: in the commit that swaps charts they still see the old, removed one. */
  const liveParts = useRef<Parts | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const condKey = JSON.stringify(conditions);

  // Indicators: the saved list plus whatever the scan uses. Scan-added ones aren't saved, so they don't pile up.
  const [indicators, setIndicatorsState] = useState<ChartIndicator[]>(loadIndicators);
  const transient = useRef(new Set<string>());
  useEffect(() => {
    setIndicatorsState((current) => {
      const merged = withScanIndicators(current, conditions);
      for (const i of merged) if (!current.includes(i)) transient.current.add(i.uid);
      return merged;
    });
  }, [condKey]); // condKey stands in for conditions, a new array on every render
  const setIndicators = (next: ChartIndicator[]) => {
    setIndicatorsState(next);
    saveIndicators(next.filter((i) => !transient.current.has(i.uid)));
  };
  const setShowVolume = (v: boolean) => {
    setShowVolumeState(v);
    writeFlag(VOLUME_KEY, v);
  };
  const colorOf = (ind: ChartIndicator, k = 0) => PALETTE[theme][(ind.slot + k) % 8];

  useEffect(() => {
    let off = false;
    setError(null);
    api
      .chart(symbol, conditions, [])
      .then((d) => {
        if (off) return;
        setData(d);
        setHover(null);
      })
      .catch((e) => !off && setError(e.message));
    return () => {
      off = true;
    };
  }, [symbol, condKey]);

  // Drawings belong to the stock whose bars are on screen.
  const shownSymbol = data?.symbol;
  useEffect(() => {
    if (!shownSymbol) return;
    setDrawings(loadDrawings(shownSymbol));
    setSelected(null);
    setTool(null);
  }, [shownSymbol]);
  const updateDrawings = (next: Drawing[]) => {
    setDrawings(next);
    if (shownSymbol) saveDrawings(shownSymbol, next);
  };

  // Page-level behaviour: no background scroll, fullscreen state, keyboard shortcuts.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onFs = () => setFullscreen(document.fullscreenElement === pageRef.current ? 'native' : 'off');
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, []);

  const idx = list.indexOf(symbol);
  const prevSym = idx > 0 ? list[idx - 1] : null;
  const nextSym = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, select, textarea')) return;
      if (e.key === 'Escape') {
        if (tool) setTool(null);
        else if (selected) setSelected(null);
        else if (fullscreen === 'focus') setFullscreen('off');
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        updateDrawings(drawings.filter((d) => d.id !== selected));
        setSelected(null);
      } else if (e.key === 'ArrowLeft' && prevSym) {
        e.preventDefault();
        onNavigate(prevSym);
      } else if (e.key === 'ArrowRight' && nextSym) {
        e.preventDefault();
        onNavigate(nextSym);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- the chart: candles, volume and signal markers; rebuilt per stock and theme ----
  useEffect(() => {
    if (!data || !box.current) return;
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const up = v('--up');
    const down = v('--down');
    const chart = createChart(box.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: v('--surface') },
        textColor: v('--muted'),
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 13,
        attributionLogo: true,
        panes: { separatorColor: v('--border'), separatorHoverColor: v('--accent-soft'), enableResize: true },
      },
      grid: { vertLines: { color: v('--grid') }, horzLines: { color: v('--grid') } },
      rightPriceScale: { borderColor: v('--border') },
      timeScale: { borderColor: v('--border'), rightOffset: 6 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const { bars } = data;
    const candles = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
    candles.setData(bars.t.map((t, i) => ({ time: t, open: bars.o[i], high: bars.h[i], low: bars.l[i], close: bars.c[i] })));
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    volume.setData(bars.t.map((t, i) => ({ time: t, value: bars.v[i], color: (bars.c[i] >= bars.o[i] ? up : down) + '55' })));
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const markers = createSeriesMarkers(candles, []);
    chart.subscribeCrosshairMove((p) => {
      const i = p.logical == null ? null : Math.round(p.logical);
      setHover(i != null && i >= 0 && i < bars.t.length ? i : null);
    });
    chart.subscribeClick(() => setSelected(null));
    applyRange(chart, bars.t.length, rangeRef.current);
    const next = { chart, candles, volume, markers };
    liveParts.current = next;
    setParts(next);
    return () => {
      liveParts.current = null;
      indicatorSeries.current = [];
      setParts(null);
      chart.remove();
    };
  }, [data, theme]);

  const isLive = (p: Parts | null): p is Parts => !!p && p === liveParts.current;

  useEffect(() => {
    if (isLive(parts) && data) applyRange(parts.chart, data.bars.t.length, range);
  }, [range]); // only when the user picks a range; a new chart applies the current one itself

  useEffect(() => {
    if (isLive(parts)) parts.volume.applyOptions({ visible: showVolume });
  }, [parts, showVolume]);

  useEffect(() => {
    if (!isLive(parts) || !data) return;
    const css = getComputedStyle(document.documentElement);
    const list: SeriesMarker<Time>[] = showSignals
      ? data.markers.map((m) => ({
          time: m.date,
          position: m.dir === 'up' ? 'belowBar' : 'aboveBar',
          color: css.getPropertyValue(m.dir === 'up' ? '--up' : '--down').trim(),
          shape: m.dir === 'up' ? 'arrowUp' : 'arrowDown',
          text: m.text,
        }))
      : [];
    parts.markers.setMarkers(list);
  }, [parts, data, showSignals]);

  // ---- indicators: torn down and re-added whenever the list changes (the zoom is kept) ----
  const computed = useMemo(() => {
    const m = new Map<string, ReturnType<typeof computeIndicator>>();
    if (data) for (const ind of indicators) m.set(ind.uid, computeIndicator(data.bars, ind));
    return m;
  }, [data, indicators]);
  useEffect(() => {
    if (!isLive(parts) || !data) return;
    const { chart } = parts;
    for (const s of indicatorSeries.current) chart.removeSeries(s);
    indicatorSeries.current = [];
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);

    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const up = v('--up');
    const down = v('--down');
    const { bars } = data;
    let osc = 0;
    for (const ind of indicators) {
      const def = getDef(ind.id);
      const lines = computed.get(ind.uid);
      if (!lines) continue;
      const pane = def.pane === 'osc' ? ++osc : 0;
      const scale = def.pane === 'volume' ? { priceScaleId: 'vol' } : {};
      let first: ISeriesApi<SeriesType> | null = null;
      def.lines.forEach((ln, k) => {
        const vals = lines[ln.key];
        let s: ISeriesApi<SeriesType>;
        if (ln.key === 'hist') {
          s = chart.addSeries(HistogramSeries, { ...scale, priceLineVisible: false, lastValueVisible: false }, pane);
          s.setData(bars.t.map((time, i) => (Number.isFinite(vals[i]) ? { time, value: vals[i], color: (vals[i] >= 0 ? up : down) + '88' } : { time })));
        } else {
          const color = ind.id === 'adx' && ln.key !== 'adx' ? (ln.key === 'pdi' ? up : down) : colorOf(ind, ind.id === 'bb' ? 0 : k);
          s = chart.addSeries(
            LineSeries,
            {
              ...scale,
              color,
              lineWidth: ind.id === 'bb' ? 1 : 2,
              lineStyle: ind.id === 'bb' && ln.key === 'middle' ? LineStyle.Dashed : LineStyle.Solid,
              lineType: ind.id === 'hh' || ind.id === 'll' ? LineType.WithSteps : LineType.Simple,
              priceLineVisible: false,
              lastValueVisible: true,
              crosshairMarkerRadius: 3,
            },
            pane,
          );
          s.setData(
            bars.t.map((time, i) => {
              const val = vals[i];
              if (!Number.isFinite(val)) return { time };
              // Supertrend reads as support (green, under price) or resistance (red, over price).
              return ind.id === 'supertrend' ? { time, value: val, color: bars.c[i] >= val ? up : down } : { time, value: val };
            }),
          );
        }
        first ??= s;
        indicatorSeries.current.push(s);
      });
      for (const g of GUIDES[ind.id] ?? []) {
        first!.createPriceLine({ price: g, color: v('--muted'), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
      }
      for (const lv of data.levels) {
        if (lv.group === indicatorKey(ind)) first!.createPriceLine({ price: lv.value, color: v('--accent'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'scan' });
      }
    }
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
  }, [parts, computed]); // computed changes whenever data or the indicator list does

  const toggleFullscreen = () => {
    if (fullscreen === 'native') void document.exitFullscreen();
    else if (fullscreen === 'focus') setFullscreen('off');
    else if (document.fullscreenEnabled && pageRef.current?.requestFullscreen) {
      // Some embedded browsers neither grant nor refuse; treat a request still pending after a moment as refused.
      let settled = false;
      pageRef.current.requestFullscreen().then(
        () => (settled = true),
        () => {
          settled = true;
          setFullscreen('focus');
        },
      );
      setTimeout(() => {
        if (!settled && document.fullscreenElement !== pageRef.current) setFullscreen('focus');
      }, 1200);
    } else setFullscreen('focus');
  };

  const n = data?.bars.t.length ?? 0;
  const i = hover ?? n - 1;
  const b = data?.bars;
  const chg = b && i > 0 ? ((b.c[i] - b.c[i - 1]) / b.c[i - 1]) * 100 : null;
  const lastChg = b && n > 1 ? ((b.c[n - 1] - b.c[n - 2]) / b.c[n - 2]) * 100 : 0;
  const tone = (x: number | null) => (x == null || x === 0 ? '' : x > 0 ? 'up' : 'down');
  const activeTool = TOOLS.find((t) => t.type === tool);

  return (
    <div className={`chart-page ${fullscreen === 'focus' ? 'focus' : ''}`} ref={pageRef} role="dialog" aria-label={`${symbol} chart`}>
      <header className="cp-head">
        <button className="btn ghost" onClick={onClose} title="Back to the results (browser Back works too)">
          ← Back
        </button>
        <div className="cp-title">
          <h2>{symbol}</h2>
          <span className="muted">{data ? `${data.name} · ${data.sector}` : ' '}</span>
        </div>
        {b && n > 1 && (
          <div className="quote">
            <span className="quote-price mono">{fmt.price(b.c[n - 1])}</span>
            <span className={`pill ${tone(lastChg)}`}>{fmt.pct(lastChg)}</span>
            <span className="muted small hide-sm">{b.t[n - 1]}</span>
          </div>
        )}
        <div className="spacer" />
        {idx >= 0 && list.length > 1 && (
          <div className="cp-nav" title="Step through your results (← → keys)">
            <button className="icon-btn" disabled={!prevSym} aria-label="Previous stock" onClick={() => prevSym && onNavigate(prevSym)}>
              ‹
            </button>
            <span className="small muted mono">
              {idx + 1} / {list.length}
            </span>
            <button className="icon-btn" disabled={!nextSym} aria-label="Next stock" onClick={() => nextSym && onNavigate(nextSym)}>
              ›
            </button>
          </div>
        )}
        <SymbolSearch onPick={onNavigate} />
      </header>

      <div className="cp-toolbar">
        <div className="seg" role="group" aria-label="Time range">
          {(Object.keys(RANGES) as Range[]).map((r) => (
            <button key={r} className={range === r ? 'on' : ''} aria-pressed={range === r} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
        <IndicatorMenu indicators={indicators} onChange={setIndicators} colorOf={colorOf} showVolume={showVolume} onShowVolume={setShowVolume} />
        {!!data?.markers.length && (
          <label className="check" title="Arrows where your scan's crosses happened in the past">
            <input type="checkbox" checked={showSignals} onChange={(e) => setShowSignals(e.target.checked)} />
            Show scan signals
          </label>
        )}
        <div className="spacer" />
        <a className="btn ghost hide-sm" href={`https://merolagani.com/CompanyDetail.aspx?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noreferrer">
          merolagani ↗
        </a>
        <button className="btn" onClick={toggleFullscreen} title={fullscreen !== 'off' ? 'Exit full screen (Esc)' : 'Full screen'}>
          {fullscreen !== 'off' ? '⤡ Exit full screen' : '⤢ Full screen'}
        </button>
      </div>

      <div className="cp-body">
        <div className="cp-tools" role="toolbar" aria-label="Drawing tools">
          <ToolButton label="Select and move (Esc)" active={!tool} onClick={() => setTool(null)} icon="cursor" />
          {TOOLS.map((t) => (
            <ToolButton key={t.type} label={`${t.label}: ${t.help}`} active={tool === t.type} onClick={() => setTool(tool === t.type ? null : t.type)} icon={t.type} />
          ))}
          <span className="tool-sep" />
          <ToolButton
            label="Delete the selected drawing (Delete key)"
            disabled={!selected}
            onClick={() => {
              updateDrawings(drawings.filter((d) => d.id !== selected));
              setSelected(null);
            }}
            icon="delete"
          />
          <ToolButton
            label="Remove all drawings on this chart"
            disabled={!drawings.length}
            onClick={() => {
              if (confirm(`Remove all ${drawings.length} drawings on ${symbol}?`)) {
                updateDrawings([]);
                setSelected(null);
              }
            }}
            icon="clear"
          />
        </div>

        <div className="cp-chart">
          <div className="chart-box" ref={box} />
          {parts && data && (
            <DrawingLayer
              chart={parts.chart}
              series={parts.candles}
              dates={data.bars.t}
              drawings={drawings}
              onChange={updateDrawings}
              tool={tool}
              onToolDone={() => setTool(null)}
              selected={selected}
              onSelect={setSelected}
            />
          )}
          {b && n > 0 && (
            <div className="cp-legend mono">
              <div className="lg-row">
                <span>{b.t[i]}</span>
                <span>O {fmt.price(b.o[i])}</span>
                <span>H {fmt.price(b.h[i])}</span>
                <span>L {fmt.price(b.l[i])}</span>
                <span>
                  C <b>{fmt.price(b.c[i])}</b>
                </span>
                <span className={tone(chg)}>{fmt.pct(chg)}</span>
                {showVolume && <span>Vol {fmt.int(b.v[i])}</span>}
              </div>
              {indicators.map((ind) => {
                const lines = computed.get(ind.uid);
                const def = getDef(ind.id);
                return (
                  <div key={ind.uid} className="lg-row lg-ind">
                    <i className="swatch" style={{ background: colorOf(ind) }} aria-hidden />
                    <span>{indicatorLabel(ind)}</span>
                    {lines &&
                      def.lines.map((ln) => (
                        <b key={ln.key} title={ln.label}>
                          {fmt.value(Number.isFinite(lines[ln.key][i]) ? lines[ln.key][i] : null)}
                        </b>
                      ))}
                    <button className="lg-remove" aria-label={`Remove ${indicatorLabel(ind)}`} title="Remove from chart" onClick={() => setIndicators(indicators.filter((x) => x.uid !== ind.uid))}>
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {activeTool && (
            <div className="tool-hint" role="status">
              <b>{activeTool.label}:</b> {activeTool.help}. Press Esc to cancel.
            </div>
          )}
          {error && <p className="notice error cp-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function SymbolSearch({ onPick }: { onPick: (symbol: string) => void }) {
  const [all, setAll] = useState<{ symbol: string; name: string }[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    api.symbols().then(setAll).catch(() => {});
  }, []);
  const pick = (value: string) => {
    const s = value.trim().toUpperCase();
    if (all.some((x) => x.symbol === s)) {
      onPick(s);
      setQ('');
    }
  };
  return (
    <form
      className="cp-search"
      onSubmit={(e) => {
        e.preventDefault();
        pick(q);
      }}
    >
      <input
        list="nepse-symbols"
        placeholder="Go to a stock…"
        aria-label="Open another stock's chart"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          // Picking from the suggestion list jumps straight there; typing waits for Enter.
          const ev = e.nativeEvent as InputEvent;
          if (!(ev instanceof InputEvent) || ev.inputType === 'insertReplacementText') pick(e.target.value);
        }}
      />
      <datalist id="nepse-symbols">
        {all.map((x) => (
          <option key={x.symbol} value={x.symbol}>
            {x.name}
          </option>
        ))}
      </datalist>
    </form>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  cursor: <path d="M5 3l11 6.5-4.6 1.2L9.5 15z" fill="currentColor" stroke="none" />,
  trend: (
    <>
      <path d="M4 15L15 4" />
      <circle cx="4" cy="15" r="1.8" />
      <circle cx="15" cy="4" r="1.8" />
    </>
  ),
  ray: (
    <>
      <path d="M3 15L16 4" />
      <circle cx="3.5" cy="14.5" r="1.8" />
      <path d="M12 4h4v4" />
    </>
  ),
  hline: (
    <>
      <path d="M2 10h15" />
      <circle cx="9.5" cy="10" r="1.8" />
    </>
  ),
  rect: <rect x="3.5" y="5" width="12" height="9" rx="1" />,
  fib: <path d="M3 4h13M3 8h13M3 11h13M3 15h13" />,
  measure: (
    <>
      <path d="M9.5 3v13M6.5 6l3-3 3 3M6.5 13l3 3 3-3" />
    </>
  ),
  delete: <path d="M5 5l9 9M14 5l-9 9" />,
  clear: <path d="M4 6h11M8 6V4h3v2M6 6l1 10h5l1-10" />,
};

function ToolButton({ label, active, disabled, onClick, icon }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; icon: string }) {
  return (
    <button className={`tool ${active ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}>
      <svg width="19" height="19" viewBox="0 0 19 19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ICONS[icon]}
      </svg>
    </button>
  );
}
