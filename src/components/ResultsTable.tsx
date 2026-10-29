import { useMemo, useState } from 'react';
import type { Condition, ConditionHit, ScreenResponse, ScreenRow } from '../../shared/types.ts';
import { isCross, isUnary } from '../../shared/screener.ts';
import { operandLabel } from '../../shared/registry.ts';
import * as fmt from '../format.ts';
import { Sparkline } from './Sparkline.tsx';

type SortKey = 'symbol' | 'sector' | 'close' | 'changePct' | 'volume' | 'avgTurnover' | `hit${number}`;

interface Props {
  result: ScreenResponse | null;
  conditions: Condition[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  onSelect: (symbol: string) => void;
}

export function conditionLabel(c: Condition): string {
  const op = { crossAbove: '↗', crossBelow: '↘', above: '>', below: '<', rising: 'rising', falling: 'falling' }[c.op];
  if (isUnary(c.op)) return `${operandLabel(c.left)} ${op}`;
  const f = c.factor && c.factor !== 1 && c.right.id !== 'value' ? `${c.factor}×` : '';
  return `${operandLabel(c.left)} ${op} ${f}${operandLabel(c.right)}`;
}

function hitSortValue(h: ConditionHit, c: Condition): number {
  if (!h.pass) return Infinity;
  return isCross(c.op) ? (h.barsAgo ?? 999) : -(h.left ?? -Infinity);
}

function HitCell({ hit, cond }: { hit: ConditionHit; cond: Condition }) {
  if (!hit.pass) return <span className="muted">—</span>;
  const values = isUnary(cond.op) ? fmt.value(hit.left) : `${fmt.value(hit.left)} vs ${fmt.value(hit.right)}`;
  if (isCross(cond.op)) {
    return (
      <span title={`${hit.date} · ${values}`} className={`when ${hit.barsAgo === 0 ? 'fresh' : ''}`}>
        {hit.barsAgo === 0 ? 'Today' : fmt.ago(hit.barsAgo)}
      </span>
    );
  }
  return <span className="mono">{values}</span>;
}

const toneOf = (x: number | null) => (x == null || x === 0 ? '' : x > 0 ? 'up' : 'down');

function Skeleton() {
  return (
    <section className="card results" aria-busy="true" aria-label="Loading results">
      <div className="results-head">
        <span className="skel" style={{ width: 180, height: 22 }} />
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skel-row">
          <span className="skel" style={{ width: 90 }} />
          <span className="skel" style={{ width: 70 }} />
          <span className="skel" style={{ width: 60 }} />
          <span className="skel hide-sm" style={{ width: 104 }} />
          <span className="skel" style={{ width: 80 }} />
        </div>
      ))}
    </section>
  );
}

export function ResultsTable({ result, conditions, loading, error, selected, onSelect }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  const rows = useMemo(() => {
    const list = [...(result?.rows ?? [])];
    if (!sort) return list;
    const val = (r: ScreenRow): number | string => {
      if (sort.key.startsWith('hit')) {
        const i = Number(sort.key.slice(3));
        return conditions[i] && r.hits[i] ? hitSortValue(r.hits[i], conditions[i]) : Infinity;
      }
      const v = r[sort.key as keyof ScreenRow];
      return typeof v === 'number' || typeof v === 'string' ? v : -Infinity;
    };
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [result, sort, conditions]);

  const header = (key: SortKey, label: string, cls = '', title?: string) => {
    const on = sort?.key === key;
    // Numbers sort high-to-low first; text and "bars ago" low-to-high.
    const firstDir: 1 | -1 = ['symbol', 'sector'].includes(key) || key.startsWith('hit') ? 1 : -1;
    return (
      <th key={key} className={cls} aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'} title={title}>
        <button onClick={() => setSort(on ? (sort!.dir === firstDir ? { key, dir: (-firstDir) as 1 | -1 } : null) : { key, dir: firstDir })}>
          {label}
          <span className="sort-ind">{on ? (sort!.dir === 1 ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    );
  };

  if (error) return <div className="card notice error">Couldn't run the scan: {error}</div>;
  if (!result) return loading ? <Skeleton /> : <div className="card notice muted">No data yet. Click Refresh to download prices.</div>;

  return (
    <section className={`card results ${loading ? 'stale' : ''}`} aria-label="Matching companies">
      <div className="results-head">
        <div>
          <h2 className="results-count">
            {result.rows.length} {result.rows.length === 1 ? 'company' : 'companies'}
            <span className="muted"> match, of {result.scanned} scanned</span>
          </h2>
          {conditions.length > 0 && (
            <div className="cond-chips">
              {conditions.map((c, i) => (
                <span key={i} className="cond-chip">
                  {conditions.length > 1 && <b>C{i + 1}</b>} {conditionLabel(c)}
                  {isCross(c.op) && <span className="muted"> · last {c.within ?? 1}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="spacer" />
        <button className="btn" disabled={!rows.length} onClick={() => downloadCsv(rows, conditions, result.asOf)}>
          ⤓ Export CSV
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="muted notice">No company meets {conditions.length > 1 ? 'these conditions' : 'this condition'} right now.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {header('symbol', 'Symbol', 'left')}
                {header('close', 'LTP')}
                {header('changePct', 'Change', 'hide-sm')}
                <th className="hide-sm spark-col" title="Closing price, last 60 sessions">
                  3 months
                </th>
                {conditions.map((c, i) => header(`hit${i}`, conditions.length > 1 ? `C${i + 1}` : 'Signal', 'hit-col', conditionLabel(c)))}
                {header('sector', 'Sector', 'left hide-sm')}
                {header('volume', 'Volume', 'hide-sm')}
                {header('avgTurnover', 'Avg turnover', 'hide-sm', 'Average daily turnover, last 20 sessions (NPR)')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.symbol}
                  className={selected === r.symbol ? 'sel' : ''}
                  tabIndex={0}
                  onClick={() => onSelect(r.symbol)}
                  onKeyDown={(e) => e.key === 'Enter' && onSelect(r.symbol)}
                >
                  <td className="left">
                    <span className="sym">{r.symbol}</span>
                    <span className="co" title={r.name}>
                      {r.name}
                    </span>
                  </td>
                  <td className="mono price">
                    {fmt.price(r.close)}
                    <span className={`show-sm small-chg ${toneOf(r.changePct)}`}>{fmt.pct(r.changePct)}</span>
                  </td>
                  <td className="hide-sm">
                    <span className={`pill ${toneOf(r.changePct)}`}>{fmt.pct(r.changePct)}</span>
                  </td>
                  <td className="hide-sm spark-col">
                    <Sparkline values={r.spark} />
                  </td>
                  {conditions.map((c, i) => (
                    <td key={i} className="hit-col">
                      {r.hits[i] && <HitCell hit={r.hits[i]} cond={c} />}
                    </td>
                  ))}
                  <td className="left hide-sm muted">{r.sector}</td>
                  <td className="mono hide-sm">{fmt.int(r.volume)}</td>
                  <td className="mono hide-sm">{fmt.npr(r.avgTurnover)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function downloadCsv(rows: ScreenRow[], conditions: Condition[], asOf: string | null) {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Symbol', 'Company', 'Sector', 'Date', 'Close', 'Change %', 'Volume', 'Avg turnover 20D', ...conditions.map(conditionLabel)];
  const lines = rows.map((r) => [
    r.symbol,
    r.name,
    r.sector,
    r.date,
    r.close,
    r.changePct?.toFixed(2),
    r.volume,
    r.avgTurnover,
    ...r.hits.map((h, i) => (!h.pass ? '' : isCross(conditions[i].op) ? `${h.date} (${fmt.ago(h.barsAgo)})` : `${h.left ?? ''}`)),
  ]);
  const csv = [head, ...lines].map((l) => l.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `nepse-scan-${asOf ?? 'latest'}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
