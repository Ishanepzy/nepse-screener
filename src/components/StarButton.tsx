import { useWatchlist, watchlist } from '../watchlist.ts';

export function StarButton({ symbol }: { symbol: string }) {
  const on = useWatchlist().includes(symbol);
  return (
    <button
      className={`star ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={on ? `Remove ${symbol} from your watchlist` : `Add ${symbol} to your watchlist`}
      title={on ? 'On your watchlist (click to remove)' : 'Add to your watchlist'}
      onClick={(e) => {
        e.stopPropagation();
        watchlist.toggle(symbol);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {on ? '★' : '☆'}
    </button>
  );
}
