import { useEffect, useMemo, useState } from 'react';
import type { Condition, ConditionHit, ScreenResponse, ScreenRow } from '../../shared/types.ts';
import { STAGE_NAMES, type Stage } from '../../shared/analysis.ts';
import { hasWhen, isUnary } from '../../shared/screener.ts';
import { operandLabel } from '../../shared/registry.ts';
import { api } from '../api.ts';
import * as fmt from '../format.ts';
import { Sparkline } from './Sparkline.tsx';
import { RsBadge, STAGE_HELP, StageBadge, TrendTemplateBadge } from './Badges.tsx';
import { StarButton } from './StarButton.tsx';

type SortKey = 'symbol' | 'sector' | 'close' | 'change' | 'changePct' | 'volume' | 'avgTurnover' | 'rs' | 'stage' | 'tt' | `hit${number}`;

interface Props {
  result: ScreenResponse | null;
  conditions: Condition[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  // list = the current table order, so the chart can step prev / next
  onSelect: (symbol: string, list: string[]) => void;
  sectors: string[];
  onSectorsChange: (sectors: string[]) => void;
  stages: Stage[];
  onStagesChange: (stages: Stage[]) => void;
  // wording after the count when there are no conditions
  listLabel?: string;
}

const OP_WORDS = { crossAbove: 'crosses above', crossBelow: 'crosses below', above: 'above', below: 'below', rising: 'rising', falling: 'falling', fired: 'happened' };

export function conditionLabel(c: Condition): string {
  if (isUnary(c.op)) return `${operandLabel(c.left)} ${OP_WORDS[c.op]}`;
  const f = c.factor && c.factor !== 1 && c.right.id !== 'value' ? `${c.factor} × ` : '';
  return `${operandLabel(c.left)} ${OP_WORDS[c.op]} ${f}${operandLabel(c.right)}`;
}

function hitSortValue(h: ConditionHit, c: Condition): number {
  if (!h.pass) return Infinity;
  return hasWhen(c.op) ? (h.barsAgo ?? 999) : -(h.left ?? -Infinity);
}

function HitCell({ hit, cond }: { hit: ConditionHit; cond: Condition }) {
  if (!hit.pass) return <span className="muted">—</span>;
  const values = isUnary(cond.op) ? fmt.value(hit.left) : `${fmt.value(hit.left)} vs ${fmt.value(hit.right)}`;
  if (hasWhen(cond.op)) {
    return (
      <span title={cond.op === 'fired' ? hit.date : `${hit.date} · ${values}`} className={`when ${hit.barsAgo === 0 ? 'fresh' : ''}`}>
        {hit.barsAgo === 0 ? 'Today' : fmt.ago(hit.barsAgo)}
      </span>
    );
  }
  return <span className="mono">{values}</span>;
}

const toneOf = (x: number | null) => (x == null || x === 0 ? '' : x > 0 ? 'up' : 'down');
const STAGES: Stage[] = [1, 2, 3, 4];

function ChipCount({ count, total, of }: { count: number; total: number; of?: string }) {
  const pct = total ? (count / total) * 100 : 0;
  return (
    <span className="chip-count" title={of ? `${count} of the ${total} ${of} stocks checked` : `${count} of ${total}`}>
      {count}
      <span className="chip-pct">{count && pct < 1 ? '<1' : Math.round(pct)}%</span>
    </span>
  );
}

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

export function ResultsTable({
  result,
  conditions,
  loading,
  error,
  selected,
  onSelect,
  sectors,
  onSectorsChange,
  stages,
  onStagesChange,
  listLabel = 'listed',
}: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [query, setQuery] = useState('');
  const [allSymbols, setAllSymbols] = useState<{ symbol: string; name: string }[]>([]);
  useEffect(() => {
    if (query && !allSymbols.length) api.symbols().then(setAllSymbols).catch(() => {});
  }, [query, allSymbols.length]);

  const q = query.trim().toLowerCase();
  const matchesQuery = (r: { symbol: string; name: string }) => !q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);

  // each chip row counts what the other filter leaves, so a chip's number is what picking it will show
  const pickedSectors = useMemo(() => new Set(sectors), [sectors]);
  const pickedStages = useMemo(() => new Set<Stage | null>(stages), [stages]);
  const inSector = (r: ScreenRow) => pickedSectors.size === 0 || pickedSectors.has(r.sector);
  const inStage = (r: ScreenRow) => pickedStages.size === 0 || pickedStages.has(r.stage);
  const all = result?.rows ?? [];
  const sectorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of all) if (inStage(r)) m.set(r.sector, (m.get(r.sector) ?? 0) + 1);
    // a picked sector with no match in this scan still gets its chip, or there'd be no way to unpick it
    for (const s of sectors) if (!m.has(s)) m.set(s, 0);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [result, pickedStages, sectors]);
  const stageCounts = useMemo(() => {
    const m = new Map<Stage | null, number>();
    for (const r of all) if (inSector(r)) m.set(r.stage, (m.get(r.stage) ?? 0) + 1);
    return m;
  }, [result, pickedSectors]);
  // stage %: share of what the sector chips leave. Sector %: share of that sector's own stocks.
  const stageTotal = [...stageCounts.values()].reduce((n, c) => n + c, 0);

  const rows = useMemo(() => {
    const list = all.filter((r) => inSector(r) && inStage(r) && matchesQuery(r));
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
  }, [result, sort, conditions, pickedSectors, pickedStages, q]);

  const header = (key: SortKey, label: string, cls = '', title?: string) => {
    const on = sort?.key === key;
    // numbers sort high-to-low first; text, stage and "bars ago" low-to-high
    const firstDir: 1 | -1 = ['symbol', 'sector', 'stage'].includes(key) || key.startsWith('hit') ? 1 : -1;
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
  if (!result) return loading ? <Skeleton /> : <div className="card notice muted">No data yet.</div>;
  const narrowed = rows.length !== result.rows.length;
  const elsewhere = q && rows.length === 0 ? allSymbols.filter(matchesQuery).slice(0, 6) : [];

  return (
    <section className={`card results ${loading ? 'stale' : ''}`} aria-label="Matching companies">
      <div className="results-head">
        <div>
          <h2 className="results-count">
            {rows.length} {rows.length === 1 ? 'company' : 'companies'}
            <span className="muted">
              {narrowed
                ? ` shown of ${result.rows.length} ${conditions.length ? 'matches' : listLabel}`
                : conditions.length
                  ? ` match, out of ${result.scanned} checked`
                  : ` ${listLabel}`}
            </span>
          </h2>
          {conditions.length > 0 && (
            <div className="cond-chips">
              {conditions.map((c, i) => (
                <span key={i} className="cond-chip">
                  {conditions.length > 1 && <b>C{i + 1}</b>} {conditionLabel(c)}
                  {hasWhen(c.op) && <span className="muted"> · within {c.within ?? 1} {(c.within ?? 1) === 1 ? 'day' : 'days'}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="spacer" />
        <input
          className="search"
          type="search"
          placeholder="Search symbol or name"
          aria-label="Search these results by symbol or company name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn" disabled={!rows.length} onClick={() => downloadCsv(rows, conditions, result.asOf)}>
          ⤓ Export CSV
        </button>
      </div>
      {(all.length > 1 || stages.length > 0) && (
        <div className="sector-chips" role="group" aria-label="Filter by Weinstein stage">
          <span className="filters-label" title={STAGE_HELP}>
            Stage <span className="info" aria-hidden>ⓘ</span>
          </span>
          <button className={`chip ${stages.length === 0 ? 'on' : ''}`} aria-pressed={stages.length === 0} onClick={() => onStagesChange([])}>
            All
          </button>
          {STAGES.map((s) => {
            const on = stages.includes(s);
            return (
              <button
                key={s}
                className={`chip stage-chip s${s} ${on ? 'on' : ''}`}
                aria-pressed={on}
                title={STAGE_HELP}
                onClick={() => onStagesChange(on ? stages.filter((x) => x !== s) : [...stages, s].sort())}
              >
                {s} · {STAGE_NAMES[s]} <ChipCount count={stageCounts.get(s) ?? 0} total={stageTotal} />
              </button>
            );
          })}
        </div>
      )}
      {(sectorCounts.length > 1 || sectors.length > 0) && (
        <div className="sector-chips" role="group" aria-label="Filter by sector">
          <span className="filters-label">Sector</span>
          <button className={`chip ${sectors.length === 0 ? 'on' : ''}`} aria-pressed={sectors.length === 0} onClick={() => onSectorsChange([])}>
            All
          </button>
          {sectorCounts.map(([name, count]) => {
            const on = sectors.includes(name);
            return (
              <button
                key={name}
                className={`chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                title={on ? 'Click to remove this sector' : 'Show this sector (pick several to combine them)'}
                onClick={() => onSectorsChange(on ? sectors.filter((s) => s !== name) : [...sectors, name])}
              >
                {name} <ChipCount count={count} total={result.sectorSizes[name] ?? count} of={name} />
              </button>
            );
          })}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="muted notice">
          {q ? (
            <>
              Nothing here matches “{query.trim()}”.
              {elsewhere.length > 0 && (
                <span className="elsewhere">
                  {' '}
                  Open a chart instead:{' '}
                  {elsewhere.map((s) => (
                    <button key={s.symbol} className="chip" title={s.name} onClick={() => onSelect(s.symbol, [])}>
                      {s.symbol}
                    </button>
                  ))}
                </span>
              )}
            </>
          ) : result.rows.length > 0 ? (
            'No matches with the chosen stage and sector.'
          ) : conditions.length ? (
            `No company meets ${conditions.length > 1 ? 'these conditions' : 'this condition'} right now.`
          ) : (
            'No company passes these filters right now.'
          )}
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="star-col" aria-label="Watchlist" />
                {header('symbol', 'Symbol', 'left')}
                {header('close', 'LTP', '', 'Last traded price')}
                {header('change', 'Pts', 'hide-sm', 'Change from the previous close, in rupees')}
                {header('changePct', 'Change', 'hide-sm', 'Change from the previous close, in %')}
                <th className="hide-sm spark-col" title="Closing price, last 60 sessions">
                  3 months
                </th>
                {conditions.map((c, i) => header(`hit${i}`, conditions.length > 1 ? `C${i + 1}` : 'Signal', 'hit-col', conditionLabel(c)))}
                {header('rs', 'RS', 'hide-sm', 'Relative strength rating, 1–99: how the last 12 months rank against every other company share')}
                {header('stage', 'Stage', 'hide-sm', STAGE_HELP)}
                {header('tt', 'Trend', 'hide-sm', "Mark Minervini's trend template: how many of its 8 rules the stock meets")}
                {header('sector', 'Sector', 'left hide-sm')}
                {header('avgTurnover', 'Avg turnover', 'hide-sm', 'Average daily turnover, last 20 sessions (NPR)')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                // during a session a stock with no trade yet still shows the change of its last trading day
                const old = !!result.asOf && r.date < result.asOf;
                const oldTip = old ? `No trade yet today. Change on ${r.date}, its last trading day.` : undefined;
                return (
                <tr
                  key={r.symbol}
                  className={selected === r.symbol ? 'sel' : ''}
                  tabIndex={0}
                  onClick={() => onSelect(r.symbol, rows.map((x) => x.symbol))}
                  onKeyDown={(e) => e.key === 'Enter' && onSelect(r.symbol, rows.map((x) => x.symbol))}
                >
                  <td className="star-col">
                    <StarButton symbol={r.symbol} />
                  </td>
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
                  <td className={`mono hide-sm ${toneOf(r.change)} ${old ? 'old-chg' : ''}`} title={oldTip}>
                    {fmt.points(r.change)}
                  </td>
                  <td className={`hide-sm ${old ? 'old-chg' : ''}`} title={oldTip}>
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
                  <td className="hide-sm">
                    <RsBadge rs={r.rs} />
                  </td>
                  <td className="hide-sm">
                    <StageBadge stage={r.stage} weeks={r.stageWeeks} />
                  </td>
                  <td className="hide-sm">
                    <TrendTemplateBadge tt={r.tt} checks={r.ttChecks} />
                  </td>
                  <td className="left hide-sm muted">{r.sector}</td>
                  <td className="mono hide-sm">{fmt.npr(r.avgTurnover)}</td>
                </tr>
                );
              })}
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
  const head = [
    'Symbol',
    'Company',
    'Sector',
    'Date',
    'Close',
    'Change',
    'Change %',
    'Volume',
    'Avg turnover 20D',
    'RS rating',
    'Stage',
    'Weeks in stage',
    'Trend template (of 8)',
    '% below 52W high',
    ...conditions.map(conditionLabel),
  ];
  const lines = rows.map((r) => [
    r.symbol,
    r.name,
    r.sector,
    r.date,
    r.close,
    r.change,
    r.changePct?.toFixed(2),
    r.volume,
    r.avgTurnover,
    r.rs,
    r.stage,
    r.stage ? r.stageWeeks : '',
    r.tt,
    r.fromHigh?.toFixed(1),
    ...r.hits.map((h, i) => (!h.pass ? '' : hasWhen(conditions[i].op) ? `${h.date} (${fmt.ago(h.barsAgo)})` : `${h.left ?? ''}`)),
  ]);
  const csv = [head, ...lines].map((l) => l.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `nepse-scan-${asOf ?? 'latest'}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
