import { useEffect, useMemo, useRef, useState } from 'react';
import { journalStats, parseJournal, replayJournal, type Trade } from '../../shared/journal.ts';
import type { CostRates } from '../../shared/costs.ts';
import { api } from '../api.ts';
import { NO_COSTS, loadRates, saveRates } from '../costsStore.ts';
import { nepalNow } from '../../shared/clock.ts';
import { load, onOtherTab, save } from '../storage.ts';
import * as fmt from '../format.ts';
import { NumberField } from './NumberField.tsx';
import { RatesEditor } from './RatesEditor.tsx';
import { StockInput } from './StockInput.tsx';

const KEY = 'nepse.journal.v1';
const OPTS_KEY = 'nepse.journal.options';

function loadTrades(): Trade[] {
  try {
    return parseJournal(load(KEY) ?? []);
  } catch {
    return [];
  }
}

const storeTrades = (trades: Trade[]) => save(KEY, { v: 1, trades });

function loadOptions(): { withCosts: boolean; withTax: boolean } {
  const v = load(OPTS_KEY) as { withCosts?: boolean; withTax?: boolean } | null;
  return { withCosts: v?.withCosts !== false, withTax: v?.withTax !== false };
}

interface Draft {
  id: string | null;
  date: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number | null;
  price: number | null;
  stop: number | null;
  target: number | null;
  setup: string;
  notes: string;
}

const emptyDraft = (): Draft => ({ id: null, date: nepalNow().date, symbol: '', side: 'buy', qty: null, price: null, stop: null, target: null, setup: '', notes: '' });

const tone = (x: number | null) => (x == null || Math.abs(x) < 0.005 ? '' : x > 0 ? 'up' : 'down');
const money = (x: number | null) => (x == null ? '—' : `${x < 0 ? '−' : ''}Rs ${fmt.int(Math.abs(x))}`);

interface Props {
  version: number;
  onOpenChart: (symbol: string, list: string[]) => void;
}

export function JournalPage({ version, onOpenChart }: Props) {
  const [trades, setTradesState] = useState<Trade[]>(loadTrades);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [rates, setRatesState] = useState<CostRates>(loadRates);
  const [{ withCosts, withTax }, setOptions] = useState(loadOptions);
  const [prices, setPrices] = useState<Map<string, { close: number; date: string }>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.lastPrices().then(setPrices).catch(() => {});
  }, [version]);
  useEffect(() => {
    save(OPTS_KEY, { withCosts, withTax });
  }, [withCosts, withTax]);
  // entries added in another tab: pick them up, or the next save here would drop them
  useEffect(() => onOtherTab(KEY, () => setTradesState(loadTrades())), []);

  const setTrades = (next: Trade[]) => {
    setTradesState(next);
    if (!storeTrades(next)) setNotice("Couldn't save to this browser (storage is blocked or full). Export a backup so nothing is lost.");
  };
  const setRates = (r: CostRates) => {
    setRatesState(r);
    saveRates(r);
  };

  const result = useMemo(() => replayJournal(trades, withCosts ? rates : NO_COSTS, withCosts && withTax), [trades, rates, withCosts, withTax]);
  const stats = useMemo(() => journalStats(result.closed), [result]);
  const open = result.positions.map((p) => {
    const last = prices.get(p.symbol);
    const value = last ? last.close * p.qty : null;
    return { ...p, last, value, pnl: value == null ? null : value - p.cost, pnlPct: value == null ? null : ((value - p.cost) / p.cost) * 100 };
  });
  const unrealized = open.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const setups = [...new Set(trades.flatMap((t) => (t.setup ? [t.setup] : [])))].sort();
  const held = (symbol: string) => result.positions.find((p) => p.symbol === symbol)?.qty ?? 0;

  const valid = draft.symbol && draft.qty != null && draft.qty > 0 && draft.price != null && draft.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(draft.date);
  const addEntry = () => {
    if (!valid) return;
    const t: Trade = {
      id: draft.id ?? `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      date: draft.date,
      symbol: draft.symbol,
      side: draft.side,
      qty: draft.qty!,
      price: draft.price!,
      stop: draft.side === 'buy' && draft.stop != null ? draft.stop : undefined,
      target: draft.side === 'buy' && draft.target != null ? draft.target : undefined,
      setup: draft.setup.trim() || undefined,
      notes: draft.notes.trim() || undefined,
    };
    setTrades(draft.id ? trades.map((x) => (x.id === draft.id ? t : x)) : [...trades, t]);
    setDraft({ ...emptyDraft(), date: draft.date });
    setNotice(null);
  };

  const exportJson = () => download(`nepse-journal-${nepalNow().date}.json`, JSON.stringify({ v: 1, trades }, null, 1), 'application/json');
  const exportCsv = () => {
    const head = ['Date', 'Symbol', 'Side', 'Quantity', 'Price', 'Stop', 'Target', 'Setup', 'Notes'];
    const rows = [...trades].sort((a, b) => a.date.localeCompare(b.date)).map((t) => [t.date, t.symbol, t.side, t.qty, t.price, t.stop, t.target, t.setup, t.notes]);
    download(`nepse-journal-${nepalNow().date}.csv`, toCsv([head, ...rows]), 'text/csv');
  };
  const importJson = async (file: File) => {
    try {
      const incoming = parseJournal(JSON.parse(await file.text()));
      const ids = new Set(trades.map((t) => t.id));
      const fresh = incoming.filter((t) => !ids.has(t.id));
      setTrades([...trades, ...fresh]);
      setNotice(`Imported ${fresh.length} ${fresh.length === 1 ? 'entry' : 'entries'}${incoming.length > fresh.length ? ` (${incoming.length - fresh.length} already here)` : ''}.`);
    } catch (e) {
      setNotice(`Couldn't read that file: ${(e as Error).message}.`);
    }
  };

  return (
    <div className="journal">
      <section className="card page-intro">
        <div className="page-intro-head">
          <div>
            <h2 className="section-title">Trade journal</h2>
            <p className="muted small">
              Log each buy and sale; sales close your oldest shares first. Saved in this browser only: back it up to move it to another device.
            </p>
          </div>
          <div className="journal-actions">
            <button className="btn" onClick={exportJson} disabled={!trades.length} title="Download every entry as a file you can restore later">
              ⤓ Back up
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()} title="Add the entries from a backup file">
              ⤒ Restore
            </button>
            <button className="btn ghost" onClick={exportCsv} disabled={!trades.length}>
              CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importJson(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        <dl className="stat-cards">
          <div>
            <dt>Realized profit</dt>
            <dd className={tone(stats.realized)}>{money(stats.realized)}</dd>
          </div>
          <div>
            <dt title="Open positions at the latest close, before selling fees">Open profit</dt>
            <dd className={tone(unrealized)}>{open.length ? money(unrealized) : '—'}</dd>
          </div>
          <div>
            <dt>Win rate</dt>
            <dd>{stats.winRate == null ? '—' : `${stats.winRate.toFixed(0)}%`}</dd>
            <span className="muted small">
              {stats.wins} of {stats.trades} closed
            </span>
          </div>
          <div>
            <dt>Average win / loss</dt>
            <dd>
              <span className="up">{money(stats.avgWin)}</span> / <span className="down">{money(stats.avgLoss)}</span>
            </dd>
          </div>
          <div>
            <dt title="Total profit of winners ÷ total loss of losers. Above 1 means the system makes money.">Profit factor</dt>
            <dd>{stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}</dd>
          </div>
          <div>
            <dt title="Average result in units of the risk you planned (buy price − stop). Needs a stop on the buy.">Average R</dt>
            <dd className={tone(stats.avgR)}>{stats.avgR == null ? '—' : `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`}</dd>
          </div>
        </dl>
        {notice && <p className="notice small">{notice}</p>}
        {result.warnings.map((w) => (
          <p key={w} className="notice warn small">
            {w}
          </p>
        ))}
      </section>

      <section className="card" aria-label={draft.id ? 'Edit entry' : 'Add a trade'}>
        <h2 className="section-title">{draft.id ? 'Edit entry' : 'Add a trade'}</h2>
        <form
          className="form-grid trade-form"
          onSubmit={(e) => {
            e.preventDefault();
            addEntry();
          }}
        >
          <div className="seg" role="group" aria-label="Buy or sell">
            {(['buy', 'sell'] as const).map((s) => (
              <button type="button" key={s} className={draft.side === s ? 'on' : ''} aria-pressed={draft.side === s} onClick={() => setDraft({ ...draft, side: s })}>
                {s === 'buy' ? 'Buy' : 'Sell'}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Date</span>
            <input type="date" value={draft.date} max={nepalNow().date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </label>
          <label className="field">
            <span>Stock</span>
            <StockInput
              value={draft.symbol}
              label="Stock"
              onPick={(s) => setDraft((d) => ({ ...d, symbol: s, price: d.price ?? prices.get(s)?.close ?? null, qty: d.qty ?? (d.side === 'sell' ? held(s) || null : null) }))}
            />
          </label>
          <label className="field">
            <span>Shares</span>
            <NumberField value={draft.qty} onChange={(qty) => setDraft({ ...draft, qty })} label="Number of shares" width="7ch" />
            {draft.side === 'sell' && draft.symbol && <span className="muted small">holding {fmt.int(held(draft.symbol))}</span>}
          </label>
          <label className="field">
            <span>Price</span>
            <NumberField value={draft.price} onChange={(price) => setDraft({ ...draft, price })} label="Price per share" width="8ch" />
          </label>
          {draft.side === 'buy' && (
            <>
              <label className="field" title="Your planned exit if it goes wrong. Lets the journal measure results in R (multiples of the risk).">
                <span>Stop-loss</span>
                <NumberField value={draft.stop} onChange={(stop) => setDraft({ ...draft, stop })} label="Stop-loss" width="8ch" />
              </label>
              <label className="field">
                <span>Target</span>
                <NumberField value={draft.target} onChange={(target) => setDraft({ ...draft, target })} label="Target" width="8ch" />
              </label>
            </>
          )}
          <label className="field">
            <span>Setup</span>
            <input list="journal-setups" value={draft.setup} placeholder="e.g. Stage 2 breakout" maxLength={60} onChange={(e) => setDraft({ ...draft, setup: e.target.value })} />
            <datalist id="journal-setups">
              {setups.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="field wide">
            <span>Notes</span>
            <input value={draft.notes} placeholder="Why you took it, what you'd do differently" maxLength={500} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </label>
          <div className="form-actions">
            <button className="btn primary" type="submit" disabled={!valid}>
              {draft.id ? 'Save changes' : draft.side === 'buy' ? 'Add buy' : 'Add sale'}
            </button>
            {draft.id && (
              <button type="button" className="btn ghost" onClick={() => setDraft(emptyDraft())}>
                Cancel
              </button>
            )}
            {draft.qty != null && draft.price != null && <span className="muted small mono">= Rs {fmt.price(draft.qty * draft.price)} before fees</span>}
          </div>
        </form>
        <div className="journal-options">
          <label className="check">
            <input type="checkbox" checked={withCosts} onChange={(e) => setOptions({ withCosts: e.target.checked, withTax })} />
            Count broker commission, SEBON fee and DP charge
          </label>
          <label className="check">
            <input type="checkbox" checked={withCosts && withTax} disabled={!withCosts} onChange={(e) => setOptions({ withCosts, withTax: e.target.checked })} />
            Count capital gains tax
          </label>
          {withCosts && <RatesEditor rates={rates} onChange={setRates} />}
        </div>
      </section>

      <section className="card results" aria-label="Open positions">
        <div className="results-head">
          <h2 className="results-count">
            Open positions <span className="muted">· {open.length}</span>
          </h2>
        </div>
        {open.length === 0 ? (
          <p className="muted notice">No open positions.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="left">Symbol</th>
                  <th>Shares</th>
                  <th title="Per share, buy fees included">Avg cost</th>
                  <th>LTP</th>
                  <th className="hide-sm">Value</th>
                  <th title="At the latest close, before selling fees and tax">Profit</th>
                  <th className="hide-sm">Stop</th>
                  <th className="hide-sm">Held</th>
                </tr>
              </thead>
              <tbody>
                {open.map((p) => (
                  <tr key={p.symbol} tabIndex={0} onClick={() => onOpenChart(p.symbol, open.map((x) => x.symbol))}>
                    <td className="left">
                      <span className="sym">{p.symbol}</span>
                      {p.setup && <span className="co">{p.setup}</span>}
                    </td>
                    <td className="mono">{fmt.int(p.qty)}</td>
                    <td className="mono">{fmt.price(p.avgCost)}</td>
                    <td className="mono">{fmt.price(p.last?.close)}</td>
                    <td className="mono hide-sm">{p.value == null ? '—' : fmt.npr(p.value)}</td>
                    <td className={`mono ${tone(p.pnl)}`}>
                      {money(p.pnl)} <span className="small">{p.pnlPct == null ? '' : `(${fmt.pct(p.pnlPct)})`}</span>
                    </td>
                    <td className={`mono hide-sm ${p.stop != null && p.last && p.last.close < p.stop ? 'down' : ''}`} title={p.stop != null && p.last && p.last.close < p.stop ? 'Below your stop' : undefined}>
                      {p.stop == null ? '—' : fmt.price(p.stop)}
                    </td>
                    <td className="mono hide-sm">{dayCount(p.firstDate, p.last?.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card results" aria-label="Closed trades">
        <div className="results-head">
          <h2 className="results-count">
            Closed trades <span className="muted">· {result.closed.length}</span>
          </h2>
        </div>
        {result.closed.length === 0 ? (
          <p className="muted notice">Sales show up here with their profit after fees{withTax && withCosts ? ' and tax' : ''}.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="left">Symbol</th>
                  <th className="hide-sm">Bought</th>
                  <th>Sold</th>
                  <th className="hide-sm">Shares</th>
                  <th className="hide-sm">Buy → sell</th>
                  <th title={withCosts ? `After fees${withTax ? ' and capital gains tax' : ''}` : 'Before fees and tax'}>Profit</th>
                  <th title="Price move in units of the planned risk (buy − stop)">R</th>
                  <th className="hide-sm">Days</th>
                </tr>
              </thead>
              <tbody>
                {result.closed.map((c) => (
                  <tr key={c.id} className="static">
                    <td className="left">
                      <button className="link sym" onClick={() => onOpenChart(c.symbol, [])}>
                        {c.symbol}
                      </button>
                      {c.setup && <span className="co">{c.setup}</span>}
                    </td>
                    <td className="mono hide-sm">{c.buyDate}</td>
                    <td className="mono">{c.sellDate}</td>
                    <td className="mono hide-sm">{fmt.int(c.qty)}</td>
                    <td className="mono hide-sm">
                      {fmt.price(c.buyPrice)} → {fmt.price(c.sellPrice)}
                    </td>
                    <td className={`mono ${tone(c.pnl)}`}>
                      {money(c.pnl)} <span className="small">({fmt.pct(c.pnlPct)})</span>
                    </td>
                    <td className={`mono ${tone(c.r)}`}>{c.r == null ? '—' : `${c.r >= 0 ? '+' : ''}${c.r.toFixed(2)}`}</td>
                    <td className="mono hide-sm">{c.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {trades.length > 0 && (
        <details className="card log">
          <summary>
            All entries <span className="muted">· {trades.length}</span>
          </summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="left">Date</th>
                  <th className="left">Stock</th>
                  <th className="left">Side</th>
                  <th>Shares</th>
                  <th>Price</th>
                  <th className="hide-sm">Stop</th>
                  <th className="left hide-sm">Setup / notes</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {[...trades]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((t) => (
                    <tr key={t.id} className="static">
                      <td className="left mono">{t.date}</td>
                      <td className="left sym">{t.symbol}</td>
                      <td className={`left ${t.side === 'buy' ? 'up' : 'down'}`}>{t.side === 'buy' ? 'Buy' : 'Sell'}</td>
                      <td className="mono">{fmt.int(t.qty)}</td>
                      <td className="mono">{fmt.price(t.price)}</td>
                      <td className="mono hide-sm">{t.stop == null ? '—' : fmt.price(t.stop)}</td>
                      <td className="left hide-sm muted small">{[t.setup, t.notes].filter(Boolean).join(' · ')}</td>
                      <td className="row-actions">
                        <button
                          className="link"
                          onClick={() => {
                            setDraft({ ...emptyDraft(), ...t, stop: t.stop ?? null, target: t.target ?? null, setup: t.setup ?? '', notes: t.notes ?? '' });
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`Delete ${t.side} of ${t.symbol} on ${t.date}`}
                          title="Delete"
                          onClick={() => confirm(`Delete this ${t.side} of ${t.qty} ${t.symbol} on ${t.date}?`) && setTrades(trades.filter((x) => x.id !== t.id))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function dayCount(from: string, to: string | undefined): string {
  const end = to ? Date.parse(to) : Date.now();
  const d = Math.max(0, Math.round((end - Date.parse(from)) / 86_400_000));
  return `${d} d`;
}

function toCsv(rows: unknown[][]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
