import { useEffect, useState } from 'react';
import type { LeaderItem, LeadersResponse } from '../../shared/types.ts';
import { STAGE_NAMES, type Stage } from '../../shared/analysis.ts';
import { api } from '../api.ts';
import * as fmt from '../format.ts';
import { RsBadge, STAGE_HELP, StageBadge, TrendTemplateBadge } from './Badges.tsx';

const TURNOVER_OPTIONS = [
  { label: 'Any amount', value: 0 },
  { label: 'At least Rs 10 lakh', value: 1e6 },
  { label: 'At least Rs 50 lakh', value: 5e6 },
  { label: 'At least Rs 1 crore', value: 1e7 },
];
const TURNOVER_KEY = 'nepse.leaders.turnover';

const readTurnover = () => {
  try {
    const raw = localStorage.getItem(TURNOVER_KEY);
    const v = Number(raw);
    return raw != null && TURNOVER_OPTIONS.some((o) => o.value === v) ? v : 1e6;
  } catch {
    return 1e6;
  }
};

interface Props {
  version: number;
  onOpenChart: (symbol: string, list: string[]) => void;
}

const tone = (x: number | null) => (x == null || x === 0 ? '' : x > 0 ? 'up' : 'down');

export function LeadersPage({ version, onOpenChart }: Props) {
  const [data, setData] = useState<LeadersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minTurnover, setMinTurnover] = useState(readTurnover);

  useEffect(() => {
    let off = false;
    api
      .leaders(minTurnover || undefined)
      .then((d) => !off && (setData(d), setError(null)))
      .catch((e) => !off && setError(e.message));
    return () => {
      off = true;
    };
  }, [minTurnover, version]);

  if (error) return <div className="card notice error">Couldn't load the leaders: {error}</div>;
  if (!data) return <div className="card notice muted">Loading…</div>;
  const total = data.stages[1] + data.stages[2] + data.stages[3] + data.stages[4];
  const leaderList = data.stage2Leaders.map((x) => x.symbol);

  return (
    <>
      <section className="card page-intro">
        <div className="page-intro-head">
          <div>
            <h2 className="section-title">Leaders and laggards</h2>
            <p className="muted">
              Ranked by RS rating: how each stock's last 12 months (the latest 3 counted double) compare with every other company share, from 1 to 99.
              {data.asOf && ` Prices as of ${data.asOf}.`}
            </p>
          </div>
          <label className="field" title="Average value traded per day over the last 20 trading days. Thinly traded stocks can top a ranking on a few trades.">
            <span>Daily turnover</span>
            <select
              value={minTurnover}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMinTurnover(v);
                try {
                  localStorage.setItem(TURNOVER_KEY, String(v));
                } catch {
                  /* convenience only */
                }
              }}
            >
              {TURNOVER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="stage-mix" aria-label="How many stocks are in each Weinstein stage">
          <div className="stage-mix-label">
            <span className="filters-label" title={STAGE_HELP}>
              Market by stage <span className="info" aria-hidden>ⓘ</span>
            </span>
            <span className="muted small">{total} stocks</span>
          </div>
          <div className="stage-bar" role="img" aria-label={([1, 2, 3, 4] as Stage[]).map((s) => `Stage ${s}: ${data.stages[s]}`).join(', ')}>
            {([1, 2, 3, 4] as Stage[]).map((s) => (
              <span key={s} className={`s${s}`} style={{ flexGrow: data.stages[s] }} title={`Stage ${s} ${STAGE_NAMES[s]}: ${data.stages[s]}`} />
            ))}
          </div>
          <div className="stage-legend">
            {([1, 2, 3, 4] as Stage[]).map((s) => (
              <span key={s}>
                <i className={`dot s${s}`} aria-hidden /> {s} {STAGE_NAMES[s]} <b>{data.stages[s]}</b>
                <span className="muted"> ({total ? Math.round((data.stages[s] / total) * 100) : 0}%)</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="card results" aria-label="Stage 2 leaders">
        <div className="results-head">
          <div>
            <h2 className="results-count">
              Stage 2 leaders <span className="muted">· {data.stage2Leaders.length} stocks advancing with RS 80+</span>
            </h2>
            <p className="muted small">Above a rising 30-week average and stronger than at least 80% of the market. Fresh Stage 2 (few weeks) is earlier in the move.</p>
          </div>
        </div>
        {data.stage2Leaders.length === 0 ? (
          <p className="muted notice">No stock is in Stage 2 with an RS rating of 80+ right now.</p>
        ) : (
          <div className="table-scroll">
            <LeaderTable items={data.stage2Leaders} onOpen={(s) => onOpenChart(s, leaderList)} />
          </div>
        )}
      </section>

      <section className="card results" aria-label="Sectors: leaders and laggards">
        <div className="results-head">
          <div>
            <h2 className="results-count">
              Sectors <span className="muted">· strongest first, by median RS rating</span>
            </h2>
            <p className="muted small">Each sector's top RS stocks (leaders) and bottom ones (laggards). Strong stocks in strong sectors tend to keep leading.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="sector-table">
            <thead>
              <tr>
                <th className="left">Sector</th>
                <th title="Median RS rating of the sector's stocks">Median RS</th>
                <th className="hide-sm" title="Share of the sector's stocks in Stage 2">In Stage 2</th>
                <th className="hide-sm" title="Median 3-month return">3 months</th>
                <th className="left">Leaders</th>
                <th className="left">Laggards</th>
              </tr>
            </thead>
            <tbody>
              {data.sectors.map((s) => (
                <tr key={s.sector} className="static">
                  <td className="left">
                    <span className="sym">{s.sector}</span>
                    <span className="co">{s.count} stocks</span>
                  </td>
                  <td>
                    <span className="rs-meter" title={`Median RS ${s.medianRs}`}>
                      <span className="rs-track" aria-hidden>
                        <i style={{ width: `${s.medianRs}%` }} />
                      </span>
                      <b>{s.medianRs}</b>
                    </span>
                  </td>
                  <td className="mono hide-sm">{s.stage2Pct}%</td>
                  <td className={`mono hide-sm ${tone(s.ret3m)}`}>{fmt.pct(s.ret3m)}</td>
                  <td className="left">
                    <SymbolChips items={s.leaders} onOpen={onOpenChart} />
                  </td>
                  <td className="left">
                    <SymbolChips items={s.laggards} onOpen={onOpenChart} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function SymbolChips({ items, onOpen }: { items: LeaderItem[]; onOpen: (symbol: string, list: string[]) => void }) {
  if (!items.length) return <span className="muted">—</span>;
  const list = items.map((x) => x.symbol);
  return (
    <span className="sym-chips">
      {items.map((x) => (
        <button key={x.symbol} className="sym-chip" title={`${x.name}\nRS ${x.rs} · Stage ${x.stage ?? '—'} · 3 months ${fmt.pct(x.ret3m)}`} onClick={() => onOpen(x.symbol, list)}>
          {x.symbol} <RsBadge rs={x.rs} />
        </button>
      ))}
    </span>
  );
}

function LeaderTable({ items, onOpen }: { items: LeaderItem[]; onOpen: (symbol: string) => void }) {
  return (
    <table>
      <thead>
        <tr>
          <th className="left">Symbol</th>
          <th>LTP</th>
          <th className="hide-sm">Change</th>
          <th title="Relative strength rating, 1–99">RS</th>
          <th title={STAGE_HELP}>Stage</th>
          <th className="hide-sm" title="Trend template rules met, of 8">Trend</th>
          <th className="hide-sm">3 months</th>
          <th className="hide-sm" title="How far below the 52-week high">From high</th>
          <th className="left hide-sm">Sector</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.symbol} tabIndex={0} onClick={() => onOpen(r.symbol)} onKeyDown={(e) => e.key === 'Enter' && onOpen(r.symbol)}>
            <td className="left">
              <span className="sym">{r.symbol}</span>
              <span className="co" title={r.name}>
                {r.name}
              </span>
            </td>
            <td className="mono price">{fmt.price(r.close)}</td>
            <td className="hide-sm">
              <span className={`pill ${tone(r.changePct)}`}>{fmt.pct(r.changePct)}</span>
            </td>
            <td>
              <RsBadge rs={r.rs} />
            </td>
            <td>
              <StageBadge stage={r.stage} weeks={r.stageWeeks} />
            </td>
            <td className="hide-sm">
              <TrendTemplateBadge tt={r.tt} />
            </td>
            <td className={`mono hide-sm ${tone(r.ret3m)}`}>{fmt.pct(r.ret3m)}</td>
            <td className="mono hide-sm">{r.fromHigh == null ? '—' : r.fromHigh < 0.05 ? 'at high' : `−${r.fromHigh.toFixed(1)}%`}</td>
            <td className="left hide-sm muted">{r.sector}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
