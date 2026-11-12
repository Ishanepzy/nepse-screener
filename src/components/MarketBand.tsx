import type { Market } from '../../shared/types.ts';
import type { LiveSnapshot } from '../live.ts';
import * as fmt from '../format.ts';
import { Sparkline } from './Sparkline.tsx';

interface Props {
  market: Market | null;
  // day totals from the live feed, when it covers the latest session
  live: LiveSnapshot | null;
  open: boolean;
}

export function MarketBand({ market, live, open }: Props) {
  const ix = market?.index;
  const b = market?.breadth;
  const total = b ? b.up + b.down + b.flat : 0;
  const tone = (x: number) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  // the live feed has no index value, so during the session this is still the last close
  const staleIndex = ix && market?.asOf && ix.date < market.asOf;
  return (
    <section className="card market" aria-label="Market today">
      <div className="mkt-index">
        <span className="mkt-label">NEPSE index{staleIndex ? ` · ${ix.date} close` : ''}</span>
        {ix ? (
          <div className="mkt-value">
            <span className="big">{fmt.price(ix.close)}</span>
            <span className={`pill ${tone(ix.change)}`}>
              {ix.change > 0 ? '▲' : ix.change < 0 ? '▼' : ''} {fmt.price(Math.abs(ix.change))} ({fmt.pct(ix.changePct)})
            </span>
          </div>
        ) : (
          <span className="big muted">—</span>
        )}
      </div>
      {ix && <Sparkline values={ix.spark} width={180} height={44} />}
      <div className="mkt-breadth">
        <span className="mkt-label">
          {open && live ? `Breadth · live ${live.time}` : `Market breadth${market?.asOf ? ` · ${market.asOf}` : ''}`}
        </span>
        {b && total > 0 ? (
          <>
            <div className="breadth-bar" role="img" aria-label={`${b.up} advancing, ${b.down} declining, ${b.flat} unchanged`}>
              <span className="seg-up" style={{ flexGrow: b.up }} />
              <span className="seg-flat" style={{ flexGrow: b.flat }} />
              <span className="seg-down" style={{ flexGrow: b.down }} />
            </div>
            <div className="breadth-legend">
              <span className="up">▲ {b.up} advancing</span>
              <span className="muted">{b.flat} unchanged</span>
              <span className="down">▼ {b.down} declining</span>
            </div>
          </>
        ) : (
          <span className="muted">No session data yet</span>
        )}
      </div>
      {live && (
        <dl className="mkt-totals" title={`From merolagani's market summary, ${live.date} ${live.time}`}>
          <div>
            <dt>Turnover</dt>
            <dd>Rs {fmt.npr(live.turnover)}</dd>
          </div>
          <div>
            <dt>Shares traded</dt>
            <dd>{fmt.npr(live.shares)}</dd>
          </div>
          <div>
            <dt>Trades</dt>
            <dd>{fmt.int(live.trades)}</dd>
          </div>
          <div>
            <dt>Stocks traded</dt>
            <dd>{fmt.int(live.scrips)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
