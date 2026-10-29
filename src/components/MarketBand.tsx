import type { Market } from '../../shared/types.ts';
import * as fmt from '../format.ts';
import { Sparkline } from './Sparkline.tsx';

export function MarketBand({ market }: { market: Market | null }) {
  const ix = market?.index;
  const b = market?.breadth;
  const total = b ? b.up + b.down + b.flat : 0;
  const tone = (x: number) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  return (
    <section className="card market" aria-label="Market today">
      <div className="mkt-index">
        <span className="mkt-label">NEPSE index</span>
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
        <span className="mkt-label">Market breadth{market?.asOf ? ` · ${market.asOf}` : ''}</span>
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
    </section>
  );
}
