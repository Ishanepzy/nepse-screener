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
  withTrendTemplate,
  type ChartIndicator,
} from '../chart/indicators.ts';
import { IndicatorMenu } from './IndicatorMenu.tsx';
import { RsBadge, StageBadge, TrendTemplateBadge } from './Badges.tsx';
import { StarButton } from './StarButton.tsx';
import { TREND_TEMPLATE, TREND_TEMPLATE_SHORT } from '../../shared/analysis.ts';
import { load, save } from '../storage.ts';

// colour-blind-safe order, checked on both backgrounds
const PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
// trend template averages 10 / 20 / 50 / 150 / 200 take these colours in order, skipping any another line already
// uses (the default EMA 20 / 50 are blue and orange). Red comes last: it reads as a falling candle.
const TT_MA_PREFERRED = [0, 1, 2, 4, 6, 3, 5, 7];
const RANGES = { '3M': 63, '6M': 125, '1Y': 250, '2Y': 500, All: 0 } as const;
type Range = keyof typeof RANGES;
const VOLUME_KEY = 'nepse.chart.volume';

interface Props {
  symbol: string;
  conditions: Condition[];
  // the screen behind this chart only lists stocks meeting the trend template, so show it
  trendTemplate?: boolean;
  theme: 'light' | 'dark';
  // the list this chart was opened from, for prev / next
  list: string[];
  // bumps when live prices arrive
  version: number;
  onNavigate: (symbol: string) => void;
  onClose: () => void;
  onSizePosition: (symbol: string) => void;
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

export function ChartPage({ symbol, conditions, trendTemplate = false, theme, list, version, onNavigate, onClose, onSizePosition }: Props) {
  const [data, setData] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('1Y');
  const [hover, setHover] = useState<number | null>(null);
  const [parts, setParts] = useState<Parts | null>(null);
  const [showVolume, setShowVolumeState] = useState(() => load(VOLUME_KEY) !== 0);
  const [showSignals, setShowSignals] = useState(true);
  const [tool, setTool] = useState<DrawingType | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // focus = fallback when the browser refuses full screen: hide the title row instead
  const [fullscreen, setFullscreen] = useState<'off' | 'native' | 'focus'>('off');
  const pageRef = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const indicatorSeries = useRef<ISeriesApi<SeriesType>[]>([]);
  // The chart that's actually alive. In the commit that swaps charts, effects still see the old one in state.
  const liveParts = useRef<Parts | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const dataRef = useRef(data);
  dataRef.current = data;
  const builtBars = useRef<ChartResponse['bars'] | null>(null);
  const condKey = JSON.stringify(conditions);

  // the saved list plus whatever the scan uses; scan-added ones aren't saved, or they would pile up
  const [indicators, setIndicatorsState] = useState<ChartIndicator[]>(loadIndicators);
  const transient = useRef(new Set<string>());
  useEffect(() => {
    setIndicatorsState((current) => {
      let merged = withScanIndicators(current, conditions);
      if (trendTemplate) merged = withTrendTemplate(merged);
      for (const i of merged) if (!current.includes(i)) transient.current.add(i.uid);
      return merged;
    });
  }, [condKey, trendTemplate]); // `conditions` is a new array on every render
  const setIndicators = (next: ChartIndicator[]) => {
    setIndicatorsState(next);
    saveIndicators(next.filter((i) => !transient.current.has(i.uid)));
  };
  const setShowVolume = (v: boolean) => {
    setShowVolumeState(v);
    save(VOLUME_KEY, v ? 1 : 0);
  };
  const maSlots = useMemo(() => {
    const taken = new Set(indicators.filter((x) => x.id !== 'ttma' && getDef(x.id).pane === 'price').map((x) => x.slot));
    const free = TT_MA_PREFERRED.filter((s) => !taken.has(s));
    return [...free, ...TT_MA_PREFERRED].slice(0, 5); // more lines than colours: repeat
  }, [indicators]);
  const colorOf = (ind: ChartIndicator, k = 0) => PALETTE[theme][ind.id === 'ttma' ? maSlots[k] : (ind.slot + k) % 8];
  // the trend template needs the RS rating on every bar, which the engine only works out on request
  const withRs = indicators.some((i) => i.id === 'tt');

  useEffect(() => {
    let off = false;
    setError(null);
    api
      .chart(symbol, conditions, withRs)
      .then((d) => {
        if (off) return;
        if (d.symbol !== dataRef.current?.symbol) setHover(null);
        setData(d);
      })
      .catch((e) => {
        if (off) return;
        setData(null); // not the previous stock's candles under this one's name
        setError(e.message);
      });
    return () => {
      off = true;
    };
  }, [symbol, condKey, version, withRs]);

  // drawings belong to the stock whose bars are on screen
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

  // no background scroll while the chart is open; track full screen
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

  // candles, volume and markers; rebuilt per stock and theme
  const shown = data?.symbol;
  useEffect(() => {
    const data = dataRef.current;
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
    const candles = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
    setBars(candles, null, data.bars);
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    setBars(null, volume, data.bars);
    builtBars.current = data.bars;
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const markers = createSeriesMarkers(candles, []);
    chart.subscribeCrosshairMove((p) => {
      const i = p.logical == null ? null : Math.round(p.logical);
      const n = dataRef.current?.bars.t.length ?? 0;
      setHover(i != null && i >= 0 && i < n ? i : null);
    });
    chart.subscribeClick(() => setSelected(null));
    applyRange(chart, data.bars.t.length, rangeRef.current);
    const next = { chart, candles, volume, markers };
    liveParts.current = next;
    setParts(next);
    return () => {
      liveParts.current = null;
      indicatorSeries.current = [];
      setParts(null);
      chart.remove();
    };
  }, [shown, theme]);

  const isLive = (p: Parts | null): p is Parts => !!p && p === liveParts.current;

  // New bars for the same stock = live prices. They only change today's bar or add it, so use update():
  // unlike setData it leaves the zoom alone. Anything bigger redraws in full.
  useEffect(() => {
    if (!isLive(parts) || !data || data.symbol !== shown || data.bars === builtBars.current) return;
    const old = builtBars.current;
    const b = data.bars;
    const n = b.t.length;
    builtBars.current = b;
    const lastBarOnly = old && n >= 2 && (n === old.t.length || n === old.t.length + 1) && old.t[n - 2] === b.t[n - 2];
    if (!lastBarOnly) return setBars(parts.candles, parts.volume, b);
    const i = n - 1;
    const css = getComputedStyle(document.documentElement);
    const color = css.getPropertyValue(b.c[i] >= b.o[i] ? '--up' : '--down').trim() + '55';
    parts.candles.update({ time: b.t[i], open: b.o[i], high: b.h[i], low: b.l[i], close: b.c[i] });
    parts.volume.update({ time: b.t[i], value: b.v[i], color });
  }, [parts, data]);

  useEffect(() => {
    if (isLive(parts) && data) applyRange(parts.chart, data.bars.t.length, range);
  }, [range]); // a new chart applies the current range itself

  useEffect(() => {
    if (isLive(parts)) parts.volume.applyOptions({ visible: showVolume });
  }, [parts, showVolume]);

  // indicator series: torn down and re-added whenever the list or the data changes
  // `data` is a new object on every live poll, but its bars only change when this stock traded
  const dataBars = data?.bars;
  const computed = useMemo(() => {
    const m = new Map<string, ReturnType<typeof computeIndicator>>();
    if (dataBars) for (const ind of indicators) m.set(ind.uid, computeIndicator(dataBars, ind));
    return m;
  }, [dataBars, dataBars?.rs, indicators]); // rs is added to the same bars when the trend template asks for it
  const levelKey = JSON.stringify(data?.levels ?? []);

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
  useEffect(() => {
    if (!isLive(parts) || !data) return;
    const { chart } = parts;
    // heights the user dragged the panes to, put back below if the pane count is unchanged
    const heights = chart.panes().map((p) => p.getStretchFactor());
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
        if (ln.event || ln.hidden) return; // events show as markers or colour, hidden lines are for scans
        const vals = lines[ln.key];
        let s: ISeriesApi<SeriesType>;
        if (ln.key === 'hist') {
          s = chart.addSeries(HistogramSeries, { ...scale, priceLineVisible: false, lastValueVisible: false }, pane);
          s.setData(bars.t.map((time, i) => (Number.isFinite(vals[i]) ? { time, value: vals[i], color: (vals[i] >= 0 ? up : down) + '88' } : { time })));
        } else if (ind.id === 'tt') {
          // rules met per day: green at 8, amber at 6-7, grey below
          s = chart.addSeries(
            HistogramSeries,
            { priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'price', precision: 0, minMove: 1 } },
            pane,
          );
          const amber = v('--neutral');
          const grey = v('--muted');
          s.setData(bars.t.map((time, i) => ({ time, value: vals[i], color: vals[i] === 8 ? up : vals[i] >= 6 ? amber + 'cc' : grey + '66' })));
        } else {
          const ratio = ind.id === 'ratio';
          const color =
            ind.id === 'adx' && ln.key !== 'adx'
                ? ln.key === 'pdi'
                  ? up
                  : down
                : colorOf(ind, ind.id === 'bb' || ratio ? 0 : k);
          // five averages on top of the candles: thin lines, or the price disappears under them
          const thin = ind.id === 'bb' || ind.id === 'ttma' || (ratio && ln.key !== 'value');
          s = chart.addSeries(
            LineSeries,
            {
              ...scale,
              color,
              lineWidth: thin ? 1 : 2,
              lineStyle: (ind.id === 'bb' && ln.key === 'middle') || (ratio && ln.key === 'ma') ? LineStyle.Dashed : LineStyle.Solid,
              lineType: ind.id === 'hh' || ind.id === 'll' ? LineType.WithSteps : LineType.Simple,
              // a price / index ratio is around 0.1 to 1, so the axis needs 4 decimals
              ...(ratio ? { priceFormat: { type: 'price' as const, precision: 4, minMove: 0.0001 } } : {}),
              priceLineVisible: false,
              // the ratio's axis shows the ratio only, not its average as well
              lastValueVisible: !(ratio && ln.key === 'ma'),
              crosshairMarkerRadius: 3,
            },
            pane,
          );
          s.setData(
            bars.t.map((time, i) => {
              const val = vals[i];
              if (!Number.isFinite(val)) return { time };
              // supertrend: green under price (support), red over it (resistance)
              if (ind.id === 'supertrend') return { time, value: val, color: bars.c[i] >= val ? up : down };
              // the ratio line turns gold where it closes at a new high
              if (ratio && ln.key === 'value' && lines.newhigh[i] > 0) return { time, value: val, color: v('--gold') };
              return { time, value: val };
            }),
          );
          if (ratio && ln.key === 'value') {
            // ...and each of those bars gets a dot, like the RS line on NepseAlpha
            const dots: SeriesMarker<Time>[] = [];
            lines.newhigh.forEach((x, i) => x > 0 && dots.push({ time: bars.t[i], position: 'inBar', shape: 'circle', color: v('--gold'), size: 0.6 }));
            createSeriesMarkers(s, dots);
          }
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
    const panes = chart.panes();
    const keep = heights.length === panes.length && panes.length > 1;
    panes.forEach((p, i) => p.setStretchFactor(keep ? heights[i] : i === 0 ? 3 : 1));
  }, [parts, computed, levelKey]);

  const toggleFullscreen = () => {
    if (fullscreen === 'native') void document.exitFullscreen();
    else if (fullscreen === 'focus') setFullscreen('off');
    else if (document.fullscreenEnabled && pageRef.current?.requestFullscreen) {
      // some embedded browsers neither grant nor refuse: a request still pending after a moment counts as refused
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
          <h2>
            {symbol} <StarButton symbol={symbol} />
          </h2>
          <span className="muted">{data ? `${data.name} · ${data.sector}` : ' '}</span>
        </div>
        {b && n > 1 && (
          <div className="quote">
            <span className="quote-price mono">{fmt.price(b.c[n - 1])}</span>
            <span className={`mono ${tone(lastChg)}`}>{fmt.points(n > 1 ? b.c[n - 1] - b.c[n - 2] : null)}</span>
            <span className={`pill ${tone(lastChg)}`}>{fmt.pct(lastChg)}</span>
            <span className="muted small hide-sm">{b.t[n - 1]}</span>
          </div>
        )}
        {data?.profile && data.symbol === symbol && (
          <div className="cp-badges hide-sm" aria-label="Strength">
            <span className="cp-badge">
              RS <RsBadge rs={data.profile.rs} />
            </span>
            <span className="cp-badge">
              Stage <StageBadge stage={data.profile.stage} weeks={data.profile.stageWeeks} />
            </span>
            <span className="cp-badge">
              Trend <TrendTemplateBadge tt={data.profile.tt} checks={data.profile.ttChecks} />
            </span>
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
        <button className="btn" onClick={() => onSizePosition(symbol)} title="How many shares to buy for the risk you choose">
          Position size
        </button>
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
                    {ind.id !== 'ttma' && <i className="swatch" style={{ background: colorOf(ind) }} aria-hidden />}
                    <span>{indicatorLabel(ind)}</span>
                    {lines && ind.id === 'tt' && <TrendTemplateLegend lines={lines} i={i} />}
                    {lines &&
                      ind.id === 'ttma' &&
                      ind.params.map((p, k) => (
                        <span key={k} className="lg-ma">
                          <i className="swatch" style={{ background: colorOf(ind, k) }} aria-hidden />
                          MA {p} <b>{fmt.value(Number.isFinite(lines[`ma${k + 1}`][i]) ? lines[`ma${k + 1}`][i] : null)}</b>
                        </span>
                      ))}
                    {lines &&
                      ind.id !== 'tt' &&
                      ind.id !== 'ttma' &&
                      ind.id !== 'ratio' && // the panel's own axis carries the numbers; the legend just names it
                      def.lines
                        .filter((ln) => !ln.event && !ln.hidden)
                        .map((ln) => (
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

function TrendTemplateLegend({ lines, i }: { lines: Record<string, number[]>; i: number }) {
  const score = lines.score[i];
  if (score === 8) return <b className="up">8/8</b>;
  const missing = TREND_TEMPLATE_SHORT.filter((_, r) => !lines[`r${r}`][i]);
  const full = TREND_TEMPLATE.filter((_, r) => !lines[`r${r}`][i]);
  return (
    <>
      <b>{score}/8</b>
      <span className="muted" title={`Not met:\n• ${full.join('\n• ')}`}>
        missing {missing.join(', ')}
      </span>
    </>
  );
}

function setBars(candles: ISeriesApi<'Candlestick'> | null, volume: ISeriesApi<'Histogram'> | null, bars: ChartResponse['bars']) {
  if (candles) candles.setData(bars.t.map((t, i) => ({ time: t, open: bars.o[i], high: bars.h[i], low: bars.l[i], close: bars.c[i] })));
  if (volume) {
    const css = getComputedStyle(document.documentElement);
    const up = css.getPropertyValue('--up').trim();
    const down = css.getPropertyValue('--down').trim();
    volume.setData(bars.t.map((t, i) => ({ time: t, value: bars.v[i], color: (bars.c[i] >= bars.o[i] ? up : down) + '55' })));
  }
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
          // picking a suggestion jumps straight there; typing waits for Enter
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
