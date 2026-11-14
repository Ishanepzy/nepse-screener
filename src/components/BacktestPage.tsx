import { useEffect, useMemo, useState } from 'react';
import type { Condition, Operand } from '../../shared/types.ts';
import type { BacktestResult, BacktestSettings, BacktestTrade, ExitReason } from '../../shared/backtest.ts';
import { PRESETS } from '../../shared/presets.ts';
import { api } from '../api.ts';
import { load, save } from '../storage.ts';
import { loadRates } from '../costsStore.ts';
import { useWatchlist } from '../watchlist.ts';
import * as fmt from '../format.ts';
import { ConditionRow } from './ConditionRow.tsx';
import { defaultOperand } from './OperandPicker.tsx';
import { NumberField } from './NumberField.tsx';
import { StockInput } from './StockInput.tsx';
import { EquityChart } from './EquityChart.tsx';

type Scope = 'all' | 'scan' | 'watchlist' | 'one';
interface Setup extends BacktestSettings {
  scope: Scope;
  symbol: string;
}

const KEY = 'nepse.backtest.v1';
const o = (id: string, params: number[] = [], line?: string): Operand => ({ id, params, line });

// the rules a backtest can start from: the quick scans that buy, and two the screener only has as filters
const RULES: { id: string; name: string; conditions: Condition[]; match: 'all' | 'any' }[] = [
  ...PRESETS.filter((p) => p.conditions.length && p.bias !== 'bear').map((p) => ({ id: p.id, name: p.name, conditions: p.conditions, match: p.match })),
  { id: 'bt-tt', name: 'Trend template: all 8 rules met', match: 'all', conditions: [{ left: o('tt', [], 'pass'), op: 'fired', right: o('value', [0]), within: 1, holds: true }] },
  {
    id: 'bt-csp',
    name: 'CAN SLIM, the price letters: N, S and L',
    match: 'all',
    conditions: (['n', 's', 'l'] as const).map((k): Condition => ({ left: o('cs', [], k), op: 'above', right: o('value', [0.5]), within: 1, holds: true })),
  },
  // results data reaches back about two years and holdings only a month, so this one has little history to test
  { id: 'bt-cs', name: 'CAN SLIM: 6 or more of the 7 letters (short history)', match: 'all', conditions: [{ left: o('cs', [], 'score'), op: 'above', right: o('value', [5.5]), within: 1, holds: true }] },
];

const DEFAULTS: Setup = {
  entry: { conditions: RULES.find((r) => r.id === 'ema20-50-up')?.conditions ?? RULES[0].conditions, match: 'all' },
  exitConditions: [],
  // O'Neil's rule: cut a loss at 7 to 8%
  stopPct: 8,
  targetPct: 25,
  trailPct: null,
  maxDays: null,
  from: null,
  to: null,
  capital: 1_000_000,
  positionPct: 10,
  maxPositions: 10,
  minHold: 2,
  fees: true,
  minTurnover: 1_000_000,
  scope: 'all',
  symbol: '',
};

const REASONS: Record<ExitReason, string> = {
  stop: 'Stop loss',
  trail: 'Trailing stop',
  target: 'Target',
  signal: 'Sell rule',
  time: 'Time limit',
  end: 'Still open at the end',
};

function loadSetup(): Setup {
  const v = load(KEY);
  return v && typeof v === 'object' ? { ...DEFAULTS, ...(v as Partial<Setup>) } : DEFAULTS;
}

interface Props {
  version: number;
  theme: 'light' | 'dark';
  // the screener's current scan, to test as it stands
  scanConditions: Condition[];
  scanMatch: 'all' | 'any';
  scanSymbols: string[];
  onOpenChart: (symbol: string, list: string[], conditions: Condition[]) => void;
}

export function BacktestPage({ version, theme, scanConditions, scanMatch, scanSymbols, onOpenChart }: Props) {
  const watch = useWatchlist();
  const [setup, setSetupState] = useState<Setup>(loadSetup);
  const setSetup = (patch: Partial<Setup>) => {
    const next = { ...setup, ...patch };
    setSetupState(next);
    save(KEY, next);
  };
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the settings the result on screen came from
  const [ranWith, setRanWith] = useState<string>('');

  useEffect(() => {
    api.range().then(setRange).catch(() => {});
  }, [version]);

  const symbols = setup.scope === 'all' ? null : setup.scope === 'scan' ? scanSymbols : setup.scope === 'watchlist' ? watch : setup.symbol ? [setup.symbol] : [];
  const settingsKey = JSON.stringify({ ...setup, symbols });
  const run = () => {
    if (!setup.entry.conditions.length) return setError('Add at least one buy condition.');
    if (symbols && !symbols.length) return setError(setup.scope === 'one' ? 'Pick a stock.' : 'That list is empty.');
    setError(null);
    setRunning(true);
    // let "Running…" paint before the work starts: it can take a second or two over every stock
    setTimeout(() => {
      api
        .backtest({ ...setup, symbols, rates: setup.fees ? loadRates() : undefined })
        .then((r) => {
          setResult(r);
          setRanWith(settingsKey);
        })
        .catch((e) => setError(e.message))
        .finally(() => setRunning(false));
    }, 30);
  };

  const rule = RULES.find((r) => JSON.stringify(r.conditions) === JSON.stringify(setup.entry.conditions) && r.match === setup.entry.match);
  const setEntry = (conditions: Condition[], match = setup.entry.match) => setSetup({ entry: { conditions, match } });
  const newCondition = (): Condition => ({ left: defaultOperand('close'), op: 'above', right: o('ema', [50], 'value'), within: 1, holds: true });

  return (
    <div className="backtest">
      <section className="card page-intro">
        <h2 className="section-title">Backtest</h2>
        <p className="muted small">
          Test a buy rule on past prices with one account. A signal at a day’s close buys at the next day’s open; stops and targets sell during the day; a
          sell rule sells at the next open. NEPSE fees and capital gains tax come off every trade, using your rates from the position size page.
        </p>

        <div className="bt-block">
          <div className="bt-label">Buy when</div>
          <div className="match-line">
            <select className="bt-rule" aria-label="Start from a rule" value={rule?.id ?? ''} onChange={(e) => {
              const r = RULES.find((x) => x.id === e.target.value);
              if (r) setEntry(r.conditions, r.match);
            }}>
              {!rule && <option value="">Your own rule</option>}
              {RULES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <button className="btn" disabled={!scanConditions.length} title={scanConditions.length ? 'Use the conditions of the scan on the screener page' : 'The screener has no conditions right now'} onClick={() => setEntry(scanConditions, scanMatch)}>
              Use the screener’s scan
            </button>
            <div className="seg" role="group" aria-label="How buy conditions combine">
              {(['all', 'any'] as const).map((m) => (
                <button key={m} className={setup.entry.match === m ? 'on' : ''} aria-pressed={setup.entry.match === m} onClick={() => setEntry(setup.entry.conditions, m)}>
                  {m}
                </button>
              ))}
            </div>
            <span className="muted small">of these</span>
          </div>
          <div className="conds">
            {setup.entry.conditions.map((c, i) => (
              <ConditionRow
                key={i}
                index={i}
                cond={c}
                onChange={(nc) => setEntry(setup.entry.conditions.map((x, j) => (j === i ? nc : x)))}
                onRemove={() => setEntry(setup.entry.conditions.filter((_, j) => j !== i))}
              />
            ))}
            <button className="btn add" disabled={setup.entry.conditions.length >= 8} onClick={() => setEntry([...setup.entry.conditions, newCondition()])}>
              + Add buy condition
            </button>
          </div>
        </div>

        <div className="bt-block">
          <div className="bt-label">Sell when</div>
          <div className="bt-fields">
            <Pct label="Stop loss" help="Sell if the price falls this far below the buy price" value={setup.stopPct} onChange={(stopPct) => setSetup({ stopPct })} />
            <Pct label="Target" help="Sell if the price rises this far above the buy price" value={setup.targetPct} onChange={(targetPct) => setSetup({ targetPct })} />
            <Pct label="Trailing stop" help="Sell if the price falls this far below its highest close since the buy" value={setup.trailPct} onChange={(trailPct) => setSetup({ trailPct })} />
            <label className="field" title="Sell at the close after this many sessions, whatever the price">
              <span>Time limit</span>
              <NumberField label="Time limit, sessions" value={setup.maxDays} placeholder="none" width="6ch" onChange={(maxDays) => setSetup({ maxDays })} />
              <span className="muted small">sessions</span>
            </label>
          </div>
          <div className="conds">
            {setup.exitConditions.map((c, i) => (
              <ConditionRow
                key={i}
                index={i}
                cond={c}
                onChange={(nc) => setSetup({ exitConditions: setup.exitConditions.map((x, j) => (j === i ? nc : x)) })}
                onRemove={() => setSetup({ exitConditions: setup.exitConditions.filter((_, j) => j !== i) })}
              />
            ))}
            <button
              className="btn add"
              disabled={setup.exitConditions.length >= 6}
              title="Also sell at the next open when any of these is true at a close"
              onClick={() => setSetup({ exitConditions: [...setup.exitConditions, { left: defaultOperand('close'), op: 'crossBelow', right: o('ema', [50], 'value'), within: 1, holds: true }] })}
            >
              + Add sell rule
            </button>
          </div>
        </div>

        <div className="bt-block">
          <div className="bt-label">Stocks</div>
          <div className="match-line">
            <div className="seg" role="group" aria-label="Which stocks">
              {(
                [
                  ['all', 'All company shares'],
                  ['scan', `Screener (${scanSymbols.length})`],
                  ['watchlist', `Watchlist (${watch.length})`],
                  ['one', 'One stock'],
                ] as [Scope, string][]
              ).map(([s, label]) => (
                <button key={s} className={setup.scope === s ? 'on' : ''} aria-pressed={setup.scope === s} onClick={() => setSetup({ scope: s })}>
                  {label}
                </button>
              ))}
            </div>
            {setup.scope === 'one' && <StockInput label="Stock to test" value={setup.symbol} onPick={(symbol) => setSetup({ symbol })} />}
          </div>
        </div>

        <div className="bt-block">
          <div className="bt-label">Account</div>
          <div className="bt-fields">
            <label className="field">
              <span>Starting capital Rs</span>
              <NumberField label="Starting capital" value={setup.capital} width="10ch" onChange={(v) => v != null && v >= 1000 && setSetup({ capital: v })} />
            </label>
            <label className="field" title="Each new position gets this share of the account's value at the time">
              <span>Each position</span>
              <NumberField label="Each position, % of the account" value={setup.positionPct} width="4ch" onChange={(v) => v != null && v > 0 && v <= 100 && setSetup({ positionPct: v })} />
              <span className="muted small">%</span>
            </label>
            <label className="field">
              <span>At most</span>
              <NumberField label="Most positions at once" value={setup.maxPositions} width="3ch" onChange={(v) => v != null && v >= 1 && setSetup({ maxPositions: Math.round(v) })} />
              <span className="muted small">at once</span>
            </label>
            <label className="field" title="Skip a signal when the stock trades less than this a day, on average over 20 sessions. Thin stocks can't be bought at the open price in size.">
              <span>Trades at least Rs</span>
              <NumberField label="Average daily turnover at least" value={setup.minTurnover / 1e5} width="5ch" onChange={(v) => v != null && setSetup({ minTurnover: v * 1e5 })} />
              <span className="muted small">lakh a day</span>
            </label>
            <label className="field" title="Shares settle T+2: sessions after buying before they can be sold. Stops can't fire before then.">
              <span>Sell from</span>
              <NumberField label="Sessions after buying before selling" value={setup.minHold} width="2ch" onChange={(v) => v != null && v >= 1 && setSetup({ minHold: Math.round(v) })} />
              <span className="muted small">sessions after buying</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={setup.fees} onChange={(e) => setSetup({ fees: e.target.checked })} />
              Fees and tax
            </label>
          </div>
        </div>

        <div className="bt-block">
          <div className="bt-label">Period</div>
          <div className="bt-fields">
            <label className="field">
              <span>From</span>
              <input type="date" aria-label="From" value={setup.from ?? range?.from ?? ''} min={range?.from} max={range?.to} onChange={(e) => setSetup({ from: e.target.value || null })} />
            </label>
            <label className="field">
              <span>To</span>
              <input type="date" aria-label="To" value={setup.to ?? range?.to ?? ''} min={range?.from} max={range?.to} onChange={(e) => setSetup({ to: e.target.value || null })} />
            </label>
            {(setup.from || setup.to) && (
              <button className="link" onClick={() => setSetup({ from: null, to: null })}>
                All the data
              </button>
            )}
            <span className="muted small">Indicators need history to start: a 200-day average gives no signal in the first 200 sessions.</span>
          </div>
        </div>

        <div className="bt-run">
          <button className="btn primary" onClick={run} disabled={running}>
            {running ? 'Running…' : 'Run backtest'}
          </button>
          {result && ranWith !== settingsKey && !running && <span className="muted small">Settings changed since this result.</span>}
          {error && <span className="notice error small">{error}</span>}
        </div>
      </section>

      {result && <Results r={result} theme={theme} onOpen={(s) => onOpenChart(s, [...new Set(result.trades.map((t) => t.symbol))], setup.entry.conditions)} />}
    </div>
  );
}

function Pct({ label, help, value, onChange }: { label: string; help: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="field" title={help}>
      <span>{label}</span>
      <NumberField label={`${label}, %`} value={value} placeholder="none" width="4ch" onChange={(v) => onChange(v && v > 0 ? v : null)} />
      <span className="muted small">%</span>
    </label>
  );
}

type SortKey = 'entryDate' | 'symbol' | 'ret' | 'pnl' | 'days' | 'reason';

function Results({ r, theme, onOpen }: { r: BacktestResult; theme: 'light' | 'dark'; onOpen: (symbol: string) => void }) {
  const s = r.stats;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'entryDate', dir: -1 });
  const trades = useMemo(() => {
    const val = (t: BacktestTrade) => t[sort.key];
    return [...r.trades].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  }, [r, sort]);
  const tone = (x: number | null) => (x == null || x === 0 ? '' : x > 0 ? 'up' : 'down');
  const pct = (x: number | null, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(d)}%`);
  const head = (key: SortKey, label: string, cls = '') => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort(sort.key === key ? { key, dir: (-sort.dir) as 1 | -1 } : { key, dir: key === 'symbol' || key === 'reason' ? 1 : -1 })}>
        {label}
        <span className="sort-ind">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
  const beat = s.benchmarkReturn != null ? s.totalReturn - s.benchmarkReturn : null;

  return (
    <>
      <section className="card bt-results" aria-label="Backtest result">
        <h2 className="section-title">
          {r.from} to {r.to}
          <span className="muted small"> · {r.stocks} {r.stocks === 1 ? 'stock' : 'stocks'} tested</span>
        </h2>
        <dl className="stat-cards">
          <div>
            <dt>Return</dt>
            <dd className={tone(s.totalReturn)}>{pct(s.totalReturn)}</dd>
            <span className="muted small">{s.cagr == null ? 'Rs ' + fmt.npr(s.finalEquity) : `${pct(s.cagr)} a year · Rs ${fmt.npr(s.finalEquity)}`}</span>
          </div>
          <div>
            <dt title="Buying the NEPSE index on the first day and holding it">NEPSE over the same days</dt>
            <dd className={tone(s.benchmarkReturn)}>{pct(s.benchmarkReturn)}</dd>
            {beat != null && <span className={`small ${tone(beat)}`}>{beat >= 0 ? 'beat it by' : 'trailed it by'} {Math.abs(beat).toFixed(1)} points</span>}
          </div>
          <div>
            <dt title="The biggest fall of the account from a high">Worst drawdown</dt>
            <dd className="down">{s.maxDrawdown.toFixed(1)}%</dd>
          </div>
          <div>
            <dt>Trades</dt>
            <dd>{s.trades}</dd>
            <span className="muted small">
              {r.signals} signals{r.missed ? `, ${r.missed} never bought (no slot or cash)` : ''}
            </span>
          </div>
          <div>
            <dt>Win rate</dt>
            <dd>{s.winRate == null ? '—' : `${s.winRate.toFixed(0)}%`}</dd>
            <span className="muted small">
              <span className="up">{pct(s.avgWin)}</span> / <span className="down">{pct(s.avgLoss)}</span> average
            </span>
          </div>
          <div>
            <dt title="Money won by winners ÷ money lost by losers. Above 1 makes money.">Profit factor</dt>
            <dd>{s.profitFactor == null ? '—' : s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2)}</dd>
            <span className="muted small">{pct(s.avgTrade, 2)} a trade</span>
          </div>
          <div>
            <dt>Held</dt>
            <dd>{s.avgDays == null ? '—' : `${Math.round(s.avgDays)} sessions`}</dd>
            <span className="muted small">invested {s.exposure.toFixed(0)}% of the time</span>
          </div>
        </dl>
        <EquityChart equity={r.equity} benchmark={r.benchmark} theme={theme} />
        {s.trades > 0 && (
          <div className="bt-reasons">
            {(Object.keys(REASONS) as ExitReason[])
              .filter((k) => s.byReason[k])
              .map((k) => (
                <span key={k} className="chip static">
                  {REASONS[k]} <span className="chip-count">{s.byReason[k]!.n}</span>
                  <span className={`small ${tone(s.byReason[k]!.pnl)}`}>Rs {fmt.npr(s.byReason[k]!.pnl)}</span>
                </span>
              ))}
          </div>
        )}
        <p className="muted small bt-caveat">
          The past doesn’t repeat exactly. These figures assume every buy filled at the open price, ignore the 10% daily price limit, and cover only
          stocks still listed today: ones that were delisted or merged away aren’t in the data, which flatters results a little.
        </p>
      </section>

      {trades.length > 0 && (
        <section className="card results" aria-label="Trades">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {head('symbol', 'Stock', 'left')}
                  {head('entryDate', 'Bought', 'left')}
                  <th className="hide-sm">Price</th>
                  <th className="left">Sold</th>
                  <th className="hide-sm">Price</th>
                  {head('days', 'Sessions', 'hide-sm')}
                  {head('ret', 'Return')}
                  {head('pnl', 'Profit Rs', 'hide-sm')}
                  {head('reason', 'Why sold', 'left')}
                </tr>
              </thead>
              <tbody>
                {trades.map((t, k) => (
                  <tr key={k} onClick={() => onOpen(t.symbol)} title="Open the chart, with the buy signals marked">
                    <td className="left sym">{t.symbol}</td>
                    <td className="left mono">{t.entryDate}</td>
                    <td className="mono hide-sm">{fmt.price(t.entryPrice)}</td>
                    <td className="left mono">{t.exitDate}</td>
                    <td className="mono hide-sm">{fmt.price(t.exitPrice)}</td>
                    <td className="mono hide-sm">{t.days}</td>
                    <td className={`mono ${tone(t.ret)}`}>{pct(t.ret)}</td>
                    <td className={`mono hide-sm ${tone(t.pnl)}`}>{fmt.npr(t.pnl)}</td>
                    <td className="left small">{REASONS[t.reason]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
