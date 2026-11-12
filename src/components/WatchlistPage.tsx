import { useEffect, useState } from 'react';
import type { ScreenResponse } from '../../shared/types.ts';
import type { Stage } from '../../shared/analysis.ts';
import { api } from '../api.ts';
import { useWatchlist, watchlist } from '../watchlist.ts';
import { ResultsTable } from './ResultsTable.tsx';
import { StockInput } from './StockInput.tsx';

interface Props {
  version: number;
  onOpenChart: (symbol: string, list: string[]) => void;
}

export function WatchlistPage({ version, onOpenChart }: Props) {
  const symbols = useWatchlist();
  const [result, setResult] = useState<ScreenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectors, setSectors] = useState<string[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);

  const key = symbols.join(',');
  useEffect(() => {
    let off = false;
    api
      .watch(symbols)
      .then((r) => !off && (setResult(r), setError(null)))
      .catch((e) => !off && setError(e.message));
    return () => {
      off = true;
    };
  }, [key, version]);

  return (
    <>
      <section className="card page-intro">
        <div className="page-intro-head">
          <div>
            <h2 className="section-title">Watchlist</h2>
            <p className="muted small">
              Star <span className="star-inline">☆</span> any stock in a table or on its chart to follow it here, with live prices during the session. Kept in this
              browser.
            </p>
          </div>
          <label className="field">
            <span>Add a stock</span>
            <StockInput
              key={symbols.length}
              value=""
              label="Add a stock to your watchlist"
              onPick={(s) => {
                if (s && !watchlist.has(s)) watchlist.toggle(s);
              }}
            />
          </label>
        </div>
      </section>
      {symbols.length === 0 ? (
        <section className="card notice muted">Nothing here yet. Star a stock in the screener, the leaders page or a chart, or add one above.</section>
      ) : (
        <ResultsTable
          result={result}
          conditions={[]}
          loading={false}
          error={error}
          selected={null}
          onSelect={onOpenChart}
          sectors={sectors}
          onSectorsChange={setSectors}
          stages={stages}
          onStagesChange={setStages}
          listLabel="on your watchlist"
        />
      )}
    </>
  );
}
