import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
} from 'lightweight-charts';
import type { ChartResponse, Condition } from '../../shared/types.ts';
import { api } from '../api.ts';
import * as fmt from '../format.ts';

// Colour-blind-safe categorical order (validated per surface); slots are assigned in order, never cycled past 8.
const PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
const RANGES = { '3M': 63, '6M': 125, '1Y': 250, '2Y': 500, All: 0 } as const;
type Range = keyof typeof RANGES;

interface Props {
  symbol: string;
  conditions: Condition[];
  theme: 'light' | 'dark';
  onClose: () => void;
}

function applyRange(chart: IChartApi, n: number, r: Range) {
  const bars = RANGES[r];
  if (!bars || bars >= n) chart.timeScale().fitContent();
  else chart.timeScale().setVisibleLogicalRange({ from: n - bars, to: n + 2 });
}

export function ChartPanel({ symbol, conditions, theme, onClose }: Props) {
  const [data, setData] = useState<ChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('1Y');
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const condKey = JSON.stringify(conditions);

  useEffect(() => {
    const ac = new AbortController();
    setError(null);
    api
      .chart(symbol, conditions, [])
      .then((d) => {
        if (ac.signal.aborted) return;
        setData(d);
        setHover(null);
      })
      .catch((e) => !ac.signal.aborted && setError(e.message));
    return () => ac.abort();
  }, [symbol, condKey]); // condKey stands in for `conditions`, which is a new array on every edit

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const colors = useMemo(() => {
    const m = new Map<string, string>();
    data?.series.forEach((s, i) => m.set(s.key, PALETTE[theme][Math.min(i, 7)]));
    return m;
  }, [data, theme]);

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
        panes: { separatorColor: v('--border'), separatorHoverColor: v('--border'), enableResize: true },
      },
      grid: { vertLines: { color: v('--grid') }, horzLines: { color: v('--grid') } },
      rightPriceScale: { borderColor: v('--border') },
      timeScale: { borderColor: v('--border'), rightOffset: 2 },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const { bars } = data;
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
    });
    candles.setData(bars.t.map((t, i) => ({ time: t, open: bars.o[i], high: bars.h[i], low: bars.l[i], close: bars.c[i] })));
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.24 } });

    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    volume.setData(bars.t.map((t, i) => ({ time: t, value: bars.v[i], color: (bars.c[i] >= bars.o[i] ? up : down) + '55' })));
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const oscPanes = new Map<string, number>();
    const firstInGroup = new Map<string, ISeriesApi<SeriesType>>();
    for (const s of data.series) {
      const color = colors.get(s.key)!;
      let pane = 0;
      if (s.pane === 'osc') {
        if (!oscPanes.has(s.group)) oscPanes.set(s.group, oscPanes.size + 1);
        pane = oscPanes.get(s.group)!;
      }
      const isHist = s.key.endsWith(':hist');
      const points = bars.t.map((t, i) => {
        const value = s.values[i];
        if (value == null) return { time: t };
        return isHist ? { time: t, value, color: (value >= 0 ? up : down) + '99' } : { time: t, value };
      });
      const common = { lastValueVisible: true, priceLineVisible: false, title: '', ...(s.pane === 'volume' ? { priceScaleId: 'vol' } : {}) };
      const series = isHist
        ? chart.addSeries(HistogramSeries, common, pane)
        : chart.addSeries(LineSeries, { ...common, color, lineWidth: 2, crosshairMarkerRadius: 3 }, pane);
      series.setData(points);
      if (!firstInGroup.has(s.group)) firstInGroup.set(s.group, series);
    }
    for (const lv of data.levels) {
      firstInGroup.get(lv.group)?.createPriceLine({ price: lv.value, color: v('--muted'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
    }
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3.2 : 1));

    createSeriesMarkers(
      candles,
      data.markers.map((m) => ({
        time: m.date,
        position: m.dir === 'up' ? 'belowBar' : 'aboveBar',
        color: m.dir === 'up' ? up : down,
        shape: m.dir === 'up' ? 'arrowUp' : 'arrowDown',
        text: m.text,
      })),
    );

    chart.subscribeCrosshairMove((p) => {
      const i = p.logical == null ? null : Math.round(p.logical);
      setHover(i != null && i >= 0 && i < bars.t.length ? i : null);
    });

    chartRef.current = chart;
    applyRange(chart, bars.t.length, rangeRef.current);
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [data, theme, colors]);

  useEffect(() => {
    if (chartRef.current && data) applyRange(chartRef.current, data.bars.t.length, range);
  }, [range, data]);

  const n = data?.bars.t.length ?? 0;
  const i = hover ?? n - 1;
  const b = data?.bars;
  const prevClose = b && i > 0 ? b.c[i - 1] : null;
  const chg = b && prevClose ? ((b.c[i] - prevClose) / prevClose) * 100 : null;
  const lastChg = b && n > 1 ? ((b.c[n - 1] - b.c[n - 2]) / b.c[n - 2]) * 100 : 0;

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${symbol} chart`}>
        <header className="drawer-head">
          <div className="title">
            <h2>{symbol}</h2>
            <span className="muted">
              {data?.name}
              {data && ` · ${data.sector}`}
            </span>
          </div>
          {b && n > 1 && (
            <div className="quote">
              <span className="quote-price mono">{fmt.price(b.c[n - 1])}</span>
              <span className={`pill ${lastChg > 0 ? 'up' : lastChg < 0 ? 'down' : ''}`}>{fmt.pct(lastChg)}</span>
            </div>
          )}
          <div className="seg" role="group" aria-label="Range">
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <button key={r} className={range === r ? 'on' : ''} aria-pressed={range === r} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
          <a className="btn ghost hide-sm" href={`https://merolagani.com/CompanyDetail.aspx?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noreferrer">
            merolagani ↗
          </a>
          <button className="icon-btn big" aria-label="Close chart" onClick={onClose}>
            ×
          </button>
        </header>
        {b && n > 0 && (
          <div className="legend mono">
            <span>{b.t[i]}</span>
            <span>O {fmt.price(b.o[i])}</span>
            <span>H {fmt.price(b.h[i])}</span>
            <span>L {fmt.price(b.l[i])}</span>
            <span>
              C <b>{fmt.price(b.c[i])}</b>
            </span>
            <span className={chg == null ? '' : chg > 0 ? 'up' : chg < 0 ? 'down' : ''}>{fmt.pct(chg)}</span>
            <span>Vol {fmt.int(b.v[i])}</span>
            {data!.series.map((s) => (
              <span key={s.key} className="lg-item">
                <i className="swatch" style={{ background: colors.get(s.key) }} aria-hidden />
                {s.label} <b>{fmt.value(s.values[i])}</b>
              </span>
            ))}
          </div>
        )}
        {error && <p className="notice error">{error}</p>}
        <div className="chart-box" ref={box} />
      </aside>
    </div>
  );
}
