import { Component, type ReactNode } from 'react';

// Last resort: without it a render error leaves a blank page. The reset button is there because the likeliest
// cause is something odd in a saved scan, and reloading alone would hit it again.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash card">
        <h2>Something broke</h2>
        <p className="muted">{error.message}</p>
        <div className="crash-actions">
          <button className="btn primary" onClick={() => location.reload()}>
            Reload
          </button>
          <button
            className="btn"
            title="Clears the scan being edited. Saved scans, watchlist and journal are kept."
            onClick={() => {
              try {
                localStorage.removeItem('nepse.currentScan');
              } catch {
                // nothing to clear then
              }
              location.href = location.pathname;
            }}
          >
            Reset the scan and reload
          </button>
        </div>
      </div>
    );
  }
}
