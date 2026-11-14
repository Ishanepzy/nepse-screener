import { useEffect, useRef } from 'react';
import { AreaSeries, ColorType, LineSeries, LineStyle, createChart, type Time } from 'lightweight-charts';

interface Props {
  equity: { t: string[]; v: number[] };
  benchmark: { t: string[]; v: number[] } | null;
  theme: 'light' | 'dark';
}

// The account against NEPSE, with the drawdown underneath.
export function EquityChart({ equity, benchmark, theme }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current || !equity.t.length) return;
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const chart = createChart(box.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: v('--surface') },
        textColor: v('--muted'),
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 12,
        attributionLogo: true,
        panes: { separatorColor: v('--border') },
      },
      grid: { vertLines: { visible: false }, horzLines: { color: v('--grid') } },
      rightPriceScale: { borderColor: v('--border') },
      // the chart takes its size a frame after it's made; keep the whole period in view when it does
      timeScale: { borderColor: v('--border'), lockVisibleTimeRangeOnResize: true },
      handleScroll: false,
      handleScale: false,
    });
    const money = { type: 'price' as const, precision: 0, minMove: 1 };
    if (benchmark) {
      const nepse = chart.addSeries(LineSeries, { color: v('--muted'), lineWidth: 1, lineStyle: LineStyle.Dashed, priceFormat: money, title: 'NEPSE', lastValueVisible: false, priceLineVisible: false });
      nepse.setData(benchmark.t.map((time, i) => ({ time: time as Time, value: benchmark.v[i] })));
    }
    const acct = chart.addSeries(LineSeries, { color: v('--accent'), lineWidth: 2, priceFormat: money, title: 'Strategy', priceLineVisible: false });
    acct.setData(equity.t.map((time, i) => ({ time: time as Time, value: equity.v[i] })));
    let peak = -Infinity;
    const dd = chart.addSeries(
      AreaSeries,
      { lineColor: v('--down'), topColor: v('--down') + '10', bottomColor: v('--down') + '55', lineWidth: 1, priceFormat: { type: 'percent', precision: 1 }, priceLineVisible: false, title: 'Drawdown' },
      1,
    );
    dd.setData(
      equity.t.map((time, i) => {
        peak = Math.max(peak, equity.v[i]);
        return { time: time as Time, value: ((equity.v[i] - peak) / peak) * 100 };
      }),
    );
    chart.panes()[0].setStretchFactor(3);
    chart.panes()[1].setStretchFactor(1);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [equity, benchmark, theme]);
  return <div className="bt-chart" ref={box} role="img" aria-label="Account value against NEPSE, with the drawdown below" />;
}
