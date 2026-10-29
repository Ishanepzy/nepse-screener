import { useCallback, useEffect, useState } from 'react';
import type { Condition, Market, ScreenResponse } from '../shared/types.ts';
import { PRESETS } from '../shared/presets.ts';
import { api, type DataInfo, type OverviewItem, type SectorCount } from './api.ts';
import { loadSaved, scanFromHash, scanFromPreset, scanToHash, storeSaved, type SavedScan, type Scan } from './scan.ts';
import { PresetStrip } from './components/PresetStrip.tsx';
import { ScanBuilder } from './components/ScanBuilder.tsx';
import { ResultsTable } from './components/ResultsTable.tsx';
import { ChartPanel } from './components/ChartPanel.tsx';
import { MarketBand } from './components/MarketBand.tsx';
import * as fmt from './format.ts';

type Theme = 'light' | 'dark';
const THEME_KEY = 'nepse.theme';

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* storage blocked */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialScan(): { scan: Scan; preset: string | null } {
  const fromUrl = scanFromHash(location.hash);
  if (fromUrl) return { scan: fromUrl, preset: null };
  return { scan: scanFromPreset(PRESETS[0].id), preset: PRESETS[0].id };
}

export function App() {
  const [{ scan, preset }, setScanState] = useState(initialScan);
  const [result, setResult] = useState<ScreenResponse | null>(null);
  /** The conditions `result` was computed for; the editor may be ahead of it while a scan is pending. */
  const [resultConditions, setResultConditions] = useState<Condition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<DataInfo | null>(null);
  const [overview, setOverview] = useState<OverviewItem[]>([]);
  const [sectors, setSectors] = useState<SectorCount[]>([]);
  const [market, setMarket] = useState<Market | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedScan[]>(loadSaved);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  const setScan = (s: Scan) => setScanState({ scan: s, preset: null });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Keep the URL in sync so the scan can be bookmarked or shared; follow back/forward and pasted links.
  useEffect(() => {
    const hash = scanToHash(scan);
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }, [scan]);
  useEffect(() => {
    const onHash = () => {
      const s = scanFromHash(location.hash);
      if (s) setScanState({ scan: s, preset: null });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Run the scan (debounced, so typing a period doesn't rescan on every keystroke).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .screen({ conditions: scan.conditions, match: scan.match, universe: scan.universe })
        .then((r) => {
          if (cancelled) return;
          setResult(r);
          setResultConditions(scan.conditions);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [scan]);

  useEffect(() => {
    api.info().then(setInfo).catch(() => {});
    api.market().then(setMarket).catch(() => {});
    api.sectors().then(setSectors).catch(() => {});
    // Counting every preset is the heaviest job; let the first results paint before it starts.
    const t = setTimeout(() => api.overview().then(setOverview).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, []);

  const closeChart = useCallback(() => setSelected(null), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--brand-bg)" />
            <path d="M5 22l7-7 5 4 10-11" stroke="var(--up)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <h1>NEPSE Screener</h1>
            <span className="tagline hide-sm">Technical signals across every listed company</span>
          </div>
        </div>
        <div className="spacer" />
        <div className="data-status">
          <span
            className="muted hide-sm"
            title={`Prices update automatically every weekday after the market closes.${info?.builtAt ? ` Last download: ${new Date(info.builtAt).toLocaleString()}` : ''}`}
          >
            {info?.builtAt ? `Updated ${fmt.relTime(info.builtAt)}` : 'Loading data…'}
          </span>
          <button
            className="icon-btn"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title="Toggle theme"
            onClick={() => {
              const t = theme === 'dark' ? 'light' : 'dark';
              setTheme(t);
              try {
                localStorage.setItem(THEME_KEY, t);
              } catch {
                /* ignore */
              }
            }}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main>
        <MarketBand market={market} />
        <PresetStrip active={preset} overview={overview} onPick={(id) => setScanState({ scan: { ...scanFromPreset(id), universe: scan.universe }, preset: id })} />
        <ScanBuilder
          scan={scan}
          onChange={setScan}
          sectors={sectors}
          saved={saved}
          onSave={(name) => {
            const next = [...saved.filter((s) => s.name !== name), { name, scan }];
            setSaved(next);
            storeSaved(next);
          }}
          onLoadSaved={(s) => setScan(structuredClone(s.scan))}
          onDeleteSaved={(name) => {
            const next = saved.filter((s) => s.name !== name);
            setSaved(next);
            storeSaved(next);
          }}
        />
        <ResultsTable result={result} conditions={resultConditions} loading={loading} error={error} selected={selected} onSelect={setSelected} />
        <footer className="foot muted small">
          Prices from merolagani.com, adjusted for bonus and right shares. Signals are computed on daily closes. Not investment advice.
        </footer>
      </main>

      {selected && <ChartPanel symbol={selected} conditions={scan.conditions} theme={theme} onClose={closeChart} />}
    </div>
  );
}
