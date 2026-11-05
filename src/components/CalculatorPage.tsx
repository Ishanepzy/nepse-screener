import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bars } from '../../shared/types.ts';
import { atr, sma } from '../../shared/indicators.ts';
import { weeklyCloses } from '../../shared/analysis.ts';
import { buyCost, sellProceeds, sizePosition, type CostRates } from '../../shared/costs.ts';
import { api } from '../api.ts';
import { pageHash } from '../scan.ts';
import { NO_COSTS, loadRates, saveRates } from '../costsStore.ts';
import * as fmt from '../format.ts';
import { NumberField } from './NumberField.tsx';
import { RatesEditor } from './RatesEditor.tsx';
import { StockInput } from './StockInput.tsx';

const KEY = 'nepse.calculator.v1';

interface Saved {
  capital: number | null;
  riskPct: number | null;
  lot: number | null;
  withCosts: boolean;
}

function loadSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') return { capital: v.capital ?? 500_000, riskPct: v.riskPct ?? 1, lot: v.lot ?? 1, withCosts: v.withCosts !== false };
  } catch {
    /* defaults */
  }
  return { capital: 500_000, riskPct: 1, lot: 1, withCosts: true };
}

interface StopIdea {
  label: string;
  help: string;
  price: number;
}

/** Stop-loss ideas below the last close: recent low, volatility, and Weinstein's 30-week average. */
function stopIdeas(b: Bars): StopIdea[] {
  const n = b.c.length;
  const close = b.c[n - 1];
  const out: StopIdea[] = [];
  const low21 = Math.min(...b.l.slice(-21));
  out.push({ label: 'Below the 21-day low', help: 'Just under the lowest low of the last 21 sessions', price: Math.floor(low21 * 0.995 * 10) / 10 });
  const a = atr(b.h, b.l, b.c, 14)[n - 1];
  if (a > 0) out.push({ label: '2 × ATR', help: 'Two average daily ranges (ATR 14) below the close', price: Math.round((close - 2 * a) * 10) / 10 });
  const wk = weeklyCloses(b);
  const ma30 = sma(wk.c, 30).at(-1);
  if (ma30 && ma30 > 0) out.push({ label: '30-week average', help: "Weinstein's line: a weekly close below it ends Stage 2", price: Math.round(ma30 * 0.99 * 10) / 10 });
  return out.filter((x) => x.price > 0 && x.price < close);
}

/** Lowest sell price that gets back everything paid, fees on both sides included. */
function breakeven(qty: number, cost: number, rates: CostRates, entry: number): number {
  let lo = entry * 0.9;
  let hi = entry * 1.2;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (sellProceeds(qty, mid, cost, 0, rates, false).net >= cost) hi = mid;
    else lo = mid;
  }
  return hi;
}

interface Props {
  symbol: string | null;
  version: number;
  onOpenChart: (symbol: string) => void;
}

export function CalculatorPage({ symbol: initialSymbol, version, onOpenChart }: Props) {
  const saved = useMemo(loadSaved, []);
  const [capital, setCapital] = useState<number | null>(saved.capital);
  const [riskPct, setRiskPct] = useState<number | null>(saved.riskPct);
  const [lot, setLot] = useState<number | null>(saved.lot);
  const [withCosts, setWithCosts] = useState(saved.withCosts);
  const [rates, setRatesState] = useState<CostRates>(loadRates);
  const [symbol, setSymbol] = useState(initialSymbol ?? '');
  const [bars, setBars] = useState<Bars | null>(null);
  const [entry, setEntry] = useState<number | null>(null);
  const [stop, setStop] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ capital, riskPct, lot, withCosts }));
    } catch {
      /* convenience only */
    }
  }, [capital, riskPct, lot, withCosts]);
  const setRates = (r: CostRates) => {
    setRatesState(r);
    saveRates(r);
  };

  useEffect(() => {
    if (initialSymbol) setSymbol(initialSymbol);
  }, [initialSymbol]);

  // Picking a stock fills the entry with its last close and offers stop-loss ideas.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!symbol) {
      setBars(null);
      return;
    }
    let off = false;
    api
      .chart(symbol, [], [])
      .then((d) => {
        if (off) return;
        setBars(d.bars);
        // A new stock resets the trade; live price updates for the same stock leave what was typed alone.
        if (loadedFor.current !== symbol) {
          loadedFor.current = symbol;
          setEntry(d.bars.c.at(-1)!);
          setStop(null);
          setTarget(null);
        }
      })
      .catch(() => !off && setBars(null));
    return () => {
      off = true;
    };
  }, [symbol, version]);

  const r = withCosts ? rates : NO_COSTS;
  const maxRisk = capital != null && riskPct != null ? (capital * riskPct) / 100 : 0;
  const ready = capital != null && capital > 0 && entry != null && entry > 0 && stop != null;
  const plan = ready ? sizePosition(capital!, maxRisk, entry!, stop!, lot ?? 1, r) : null;
  const perShare = entry != null && stop != null ? entry - stop : null;
  const ideas = bars ? stopIdeas(bars) : [];
  const last = bars?.c.at(-1);

  let problem: string | null = null;
  if (entry != null && stop != null && stop >= entry) problem = 'The stop-loss must be below the entry price.';
  else if (plan && plan.shares === 0 && ready) problem = 'The risk you allow is smaller than the fees and the move to the stop for even one lot. Raise the risk or move the stop closer.';

  const targets =
    plan && plan.shares > 0 && perShare && perShare > 0
      ? [
          ...[1, 2, 3].map((k) => ({ label: `${k}R`, price: entry! + k * perShare })),
          ...(target != null && target > entry! ? [{ label: 'Your target', price: target }] : []),
        ].map((t) => {
          const out = sellProceeds(plan.shares, t.price, plan.cost, 0, r, true);
          const profit = out.net - plan.cost;
          return { ...t, profit, rMultiple: profit / plan.riskAtStop, pct: ((t.price - entry!) / entry!) * 100 };
        })
      : [];

  return (
    <div className="calc">
      <section className="card calc-inputs" aria-label="Your trade">
        <h2 className="section-title">Position size</h2>
        <p className="muted small">How many shares to buy so that, if the stop-loss is hit, you lose no more than the share of your capital you choose.</p>

        <div className="form-grid">
          <label className="field">
            <span>Trading capital</span>
            <span className="param-word">Rs</span>
            <NumberField value={capital} onChange={setCapital} label="Trading capital (Rs)" width="11ch" />
          </label>
          <label className="field">
            <span>Risk per trade</span>
            <NumberField value={riskPct} onChange={setRiskPct} label="Risk per trade (% of capital)" width="4ch" />
            <span className="param-word">% {maxRisk > 0 && <span className="muted">= Rs {fmt.int(maxRisk)}</span>}</span>
          </label>
          <label className="field">
            <span>Stock (optional)</span>
            <StockInput
              value={symbol}
              label="Stock"
              onPick={(s) => {
                setSymbol(s);
                history.replaceState(null, '', pageHash('calculator', s));
              }}
            />
            {symbol && last != null && (
              <button className="link" onClick={() => onOpenChart(symbol)}>
                chart ↗
              </button>
            )}
          </label>
          <label className="field">
            <span>Entry price</span>
            <NumberField value={entry} onChange={setEntry} label="Entry price" width="8ch" />
            {last != null && entry !== last && (
              <button className="link" onClick={() => setEntry(last)}>
                use last close {fmt.price(last)}
              </button>
            )}
          </label>
          <label className="field">
            <span>Stop-loss</span>
            <NumberField value={stop} onChange={setStop} label="Stop-loss price" width="8ch" />
            {perShare != null && entry ? <span className="muted">{((perShare / entry) * 100).toFixed(1)}% below entry</span> : null}
          </label>
          {ideas.length > 0 && (
            <div className="stop-ideas">
              <span className="filters-label">Stop ideas</span>
              {ideas.map((x) => (
                <button key={x.label} className={`chip ${stop === x.price ? 'on' : ''}`} title={x.help} onClick={() => setStop(x.price)}>
                  {x.label} <b className="mono">{fmt.price(x.price)}</b>
                  {entry ? <span className="chip-count">−{(((entry - x.price) / entry) * 100).toFixed(1)}%</span> : null}
                </button>
              ))}
            </div>
          )}
          <label className="field">
            <span>Target (optional)</span>
            <NumberField value={target} onChange={setTarget} label="Target price" width="8ch" />
          </label>
          <label className="field" title="Order quantity rounds down to a multiple of this">
            <span>Round down to multiples of</span>
            <NumberField value={lot} onChange={setLot} label="Lot size" width="4ch" min={1} />
            <span className="param-word">shares</span>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={withCosts} onChange={(e) => setWithCosts(e.target.checked)} />
          Include broker commission, SEBON fee, DP charge and capital gains tax
        </label>
        {withCosts && <RatesEditor rates={rates} onChange={setRates} />}
      </section>

      <section className="card calc-result" aria-label="Result" aria-live="polite">
        {problem ? (
          <p className="notice error">{problem}</p>
        ) : !plan ? (
          <p className="muted notice">Enter your capital, an entry price and a stop-loss.</p>
        ) : (
          <>
            <div className="calc-headline">
              <span className="muted">Buy</span>
              <span className="big mono">{fmt.int(plan.shares)}</span>
              <span className="muted">shares{symbol ? ` of ${symbol}` : ''}</span>
            </div>
            {plan.limit === 'capital' && <p className="small warn">Capped by your capital: the risk allows more shares than you can pay for.</p>}
            <dl className="calc-stats">
              <div>
                <dt>Cost{withCosts ? ', fees included' : ''}</dt>
                <dd>
                  Rs {fmt.price(plan.cost)} <span className="muted">· {((plan.cost / capital!) * 100).toFixed(1)}% of capital</span>
                </dd>
              </div>
              <div>
                <dt>Loss if the stop is hit</dt>
                <dd className="down">
                  Rs {fmt.price(plan.riskAtStop)} <span className="muted">· {((plan.riskAtStop / capital!) * 100).toFixed(2)}% of capital</span>
                </dd>
              </div>
              <div>
                <dt>Risk per share</dt>
                <dd>Rs {fmt.price(perShare)}</dd>
              </div>
              {withCosts && (
                <>
                  <div>
                    <dt>Fees on the buy</dt>
                    <dd>Rs {fmt.price(plan.cost - buyCost(plan.shares, entry!, NO_COSTS).total)}</dd>
                  </div>
                  <div>
                    <dt>Break-even sell price</dt>
                    <dd>{fmt.price(breakeven(plan.shares, plan.cost, r, entry!))}</dd>
                  </div>
                </>
              )}
            </dl>
            {targets.length > 0 && (
              <div className="table-scroll">
              <table className="calc-targets">
                <thead>
                  <tr>
                    <th className="left" title="R = your risk. 2R means a gain twice the loss you'd take at the stop.">
                      Sell at
                    </th>
                    <th>Price</th>
                    <th>Move</th>
                    <th title={withCosts ? 'After fees on both sides and capital gains tax (held under a year)' : 'Before fees and tax'}>Profit</th>
                    <th title="Profit as a multiple of the loss at the stop">× risk</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={t.label} className="static">
                      <td className="left">{t.label}</td>
                      <td className="mono">{fmt.price(t.price)}</td>
                      <td className="mono up">+{t.pct.toFixed(1)}%</td>
                      <td className="mono up">Rs {fmt.int(t.profit)}</td>
                      <td className="mono">{t.rMultiple.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
            <p className="muted small">
              {withCosts
                ? 'Profit is after commission, SEBON fee and DP charge on both sides, and capital gains tax at the under-a-year rate.'
                : 'Fees and tax left out.'}{' '}
              A stop-loss is a plan, not a guarantee: a stock can open below it.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
