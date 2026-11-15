import { useState } from 'react';
import type { ReplayAccount, ReplaySession, ReplayStats } from '../replay.ts';
import * as fmt from '../format.ts';
import { NumberField } from './NumberField.tsx';

export const STEPS = [
  { bars: 1, label: '1 day' },
  { bars: 5, label: '1 week' },
  { bars: 21, label: '1 month' },
];

interface Props {
  symbol: string;
  session: ReplaySession;
  account: ReplayAccount;
  stats: ReplayStats;
  // the close of the day shown: what an order fills at
  price: number;
  maxBuy: number;
  canBack: boolean;
  // why stepping back stops here, when it does
  backHint: string | null;
  atEnd: boolean;
  playing: boolean;
  speed: number;
  step: number;
  // the dates a new start can be picked from
  firstDate: string;
  lastDate: string;
  onStep: (dir: 1 | -1) => void;
  onPlay: () => void;
  onSpeed: (barsPerSecond: number) => void;
  onStepSize: (bars: number) => void;
  onOrder: (side: 'buy' | 'sell', shares: number) => void;
  onUndo: () => void;
  onRestart: (start: string, balance: number, fees: boolean) => void;
}

// whole lakh-style figures (Rs 1,00,000): an account reads better in full than as 1.00 L
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const money = (x: number) => `${x < 0 ? '−' : ''}Rs ${inr.format(Math.abs(x))}`;
const tone = (x: number | null | undefined) => (x == null || x === 0 ? '' : x > 0 ? 'up' : 'down');
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

export function ReplayPanel(p: Props) {
  const { session, account: a, stats: s } = p;
  const [tab, setTab] = useState<'trades' | 'analytics'>('trades');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [shares, setShares] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [start, setStart] = useState(session.start);
  const [balance, setBalance] = useState<number | null>(session.balance);
  const [fees, setFees] = useState(session.fees);

  const max = side === 'buy' ? p.maxBuy : a.shares;
  const order = () => {
    if (!shares || shares < 1 || !Number.isInteger(shares)) return setError('Enter a whole number of shares.');
    if (shares > max) return setError(side === 'buy' ? `Cash covers ${fmt.int(p.maxBuy)} shares at most.` : `You hold ${fmt.int(a.shares)} shares.`);
    setError(null);
    p.onOrder(side, shares);
    setShares(null);
  };
  const restart = () => {
    if (!balance || balance < 1000) return setError('Starting balance: Rs 1,000 or more.');
    if (session.fills.length && !confirm('Start over? This clears the orders in this session.')) return;
    setError(null);
    setSettings(false);
    p.onRestart(start, balance, fees);
  };

  return (
    <section className="rp" aria-label="Backtest">
      <div className="rp-main">
        <dl className="rp-account">
          <div>
            <dt>Starting balance</dt>
            <dd>{money(session.balance)}</dd>
          </div>
          <div>
            <dt>Equity</dt>
            <dd className={tone(a.equity - session.balance)}>{money(a.equity)}</dd>
          </div>
          <div>
            <dt>Realized</dt>
            <dd className={tone(a.realized)}>{money(a.realized)}</dd>
          </div>
          <div>
            <dt>Unrealized</dt>
            <dd className={tone(a.unrealized)}>{a.shares ? money(a.unrealized) : '—'}</dd>
          </div>
          <div>
            <dt>Holding</dt>
            <dd>{a.shares ? `${fmt.int(a.shares)} @ ${fmt.price(a.avgCost)}` : '—'}</dd>
          </div>
          <div>
            <dt>Cash</dt>
            <dd>{money(a.cash)}</dd>
          </div>
        </dl>
        <div className="seg rp-tabs" role="tablist" aria-label="Trades or analytics">
          {(['trades', 'analytics'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'trades' ? `Trades${session.fills.length ? ` (${session.fills.length})` : ''}` : 'Analytics'}
            </button>
          ))}
        </div>
        {tab === 'trades' ? (
          session.fills.length ? (
            <div className="table-scroll rp-table">
              <table>
                <thead>
                  <tr>
                    <th className="left">Date</th>
                    <th className="left">Side</th>
                    <th>Shares</th>
                    <th>Price</th>
                    <th className="hide-sm">Amount</th>
                    <th>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {session.fills
                    .map((f, i) => ({ f, pnl: a.fillPnl[i] }))
                    .reverse()
                    .map(({ f, pnl }, k) => (
                      <tr key={k} className="static">
                        <td className="left mono">{f.date}</td>
                        <td className={`left ${f.side === 'buy' ? 'up' : 'down'}`}>{f.side === 'buy' ? 'Buy' : 'Sell'}</td>
                        <td className="mono">{fmt.int(f.shares)}</td>
                        <td className="mono">{fmt.price(f.price)}</td>
                        <td className="mono hide-sm">{inr.format(f.shares * f.price)}</td>
                        <td className={`mono ${tone(pnl)}`}>{pnl == null ? '' : inr.format(pnl)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small rp-empty">No orders yet. Step forward through the chart and buy or sell from the panel on the right.</p>
          )
        ) : (
          <dl className="rp-stats">
            <div>
              <dt>Net profit</dt>
              <dd className={tone(s.netPnl)}>
                {money(s.netPnl)} <span className="small">({s.netPct >= 0 ? '+' : ''}{s.netPct.toFixed(1)}%)</span>
              </dd>
            </div>
            <div>
              <dt>Win rate</dt>
              <dd>{s.winRate == null ? '—' : `${s.winRate.toFixed(0)}%`}</dd>
            </div>
            <div>
              <dt title="Each sale counts as one trade">Trades</dt>
              <dd>{s.trades}</dd>
            </div>
            <div>
              <dt title="Money won by winning sales ÷ money lost by losing ones">Profit factor</dt>
              <dd>{s.profitFactor == null ? '—' : s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Average win / loss</dt>
              <dd>
                <span className="up">{s.avgWin == null ? '—' : inr.format(s.avgWin)}</span> / <span className="down">{s.avgLoss == null ? '—' : inr.format(s.avgLoss)}</span>
              </dd>
            </div>
            <div>
              <dt>Max drawdown</dt>
              <dd className={s.maxDrawdown < 0 ? 'down' : ''}>{s.maxDrawdown.toFixed(1)}%</dd>
            </div>
            <div>
              <dt>Average profit</dt>
              <dd className={tone(s.avgPnl)}>{s.avgPnl == null ? '—' : money(s.avgPnl)}</dd>
            </div>
            <div>
              <dt>Average hold</dt>
              <dd>{s.avgDays == null ? '—' : `${s.avgDays.toFixed(1)} days`}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="rp-side">
        <div className="rp-clock">
          <div>
            <span className="muted small">Day shown</span>
            <b className="mono">
              {session.at} <span className="muted">{weekday(session.at)}</span>
            </b>
          </div>
          <select aria-label="Step size" value={p.step} onChange={(e) => p.onStepSize(Number(e.target.value))}>
            {STEPS.map((x) => (
              <option key={x.bars} value={x.bars}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <div className="rp-controls">
          <button className="icon-btn" aria-label="Step back (←)" title={p.backHint ?? 'Step back (←)'} disabled={!p.canBack || p.playing} onClick={() => p.onStep(-1)}>
            ⏮
          </button>
          <button className="icon-btn rp-play" aria-label={p.playing ? 'Pause (space)' : 'Play (space)'} title={p.playing ? 'Pause (space)' : 'Play (space)'} disabled={p.atEnd} onClick={p.onPlay}>
            {p.playing ? '⏸' : '▶'}
          </button>
          <button className="icon-btn" aria-label="Step forward (→)" title="Step forward (→)" disabled={p.atEnd || p.playing} onClick={() => p.onStep(1)}>
            ⏭
          </button>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={p.speed}
            aria-label="Play speed, days a second"
            title={`${p.speed} ${p.speed === 1 ? 'day' : 'days'} a second`}
            onChange={(e) => p.onSpeed(Number(e.target.value))}
          />
        </div>
        {p.atEnd && <p className="small muted rp-note">You’ve reached the latest day in the data.</p>}

        <div className="rp-ticket">
          <div className="seg rp-side-pick" role="group" aria-label="Buy or sell">
            <button className={side === 'buy' ? 'on buy' : ''} aria-pressed={side === 'buy'} onClick={() => (setSide('buy'), setError(null))}>
              Buy
            </button>
            <button className={side === 'sell' ? 'on sell' : ''} aria-pressed={side === 'sell'} onClick={() => (setSide('sell'), setError(null))}>
              Sell
            </button>
          </div>
          <label className="field">
            <span>Shares</span>
            <NumberField label="Shares" value={shares} width="8ch" onChange={(v) => (setShares(v), setError(null))} />
            <button className="link small" type="button" disabled={!max} onClick={() => setShares(max)}>
              Max {fmt.int(max)}
            </button>
          </label>
          <button className={`btn primary rp-confirm ${side}`} disabled={!max} onClick={order}>
            {side === 'buy' ? 'Buy' : 'Sell'} {shares ? fmt.int(shares) : ''} {p.symbol} @ {fmt.price(p.price)}
          </button>
          {error && <p className="small down">{error}</p>}
          <div className="rp-links">
            <button className="link small" disabled={!session.fills.length} onClick={p.onUndo} title="Remove the last order">
              Undo last order
            </button>
            <button className="link small" onClick={() => setSettings(!settings)} aria-expanded={settings}>
              Start over…
            </button>
          </div>
          {settings && (
            <div className="rp-settings">
              <label className="field">
                <span>Start from</span>
                <input type="date" value={start} min={p.firstDate} max={p.lastDate} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="field">
                <span>Balance Rs</span>
                <NumberField label="Starting balance" value={balance} width="9ch" onChange={setBalance} />
              </label>
              <label className="check">
                <input type="checkbox" checked={fees} onChange={(e) => setFees(e.target.checked)} />
                Fees and tax
              </label>
              <button className="btn" onClick={restart}>
                Start over
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
