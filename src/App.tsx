import { useCallback, useEffect, useRef, useState } from 'react';
import type { Condition, Market, ScreenResponse } from '../shared/types.ts';
import { PRESETS } from '../shared/presets.ts';
import { api, type DataInfo, type OverviewItem } from './api.ts';
import {
  PAGES,
  chartFromHash,
  chartHash,
  legacyScanFromHash,
  loadCurrent,
  loadSaved,
  pageFromHash,
  pageHash,
  scanFromPreset,
  storeCurrent,
  storeSaved,
  type Page,
  type SavedScan,
  type Scan,
} from './scan.ts';
import { LIVE_POLL_MS, fetchLive, marketMayBeOpen, type LiveSnapshot } from './live.ts';
import { PresetStrip } from './components/PresetStrip.tsx';
import { ScanBuilder } from './components/ScanBuilder.tsx';
import { ResultsTable } from './components/ResultsTable.tsx';
import { ChartPage } from './components/ChartPage.tsx';
import { MarketBand } from './components/MarketBand.tsx';
import { LeadersPage } from './components/LeadersPage.tsx';
import { CalculatorPage } from './components/CalculatorPage.tsx';
import { JournalPage } from './components/JournalPage.tsx';
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
  const fromOldLink = legacyScanFromHash(location.hash);
  if (fromOldLink) return { scan: fromOldLink, preset: null };
  return loadCurrent() ?? { scan: scanFromPreset(PRESETS[0].id), preset: PRESETS[0].id };
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
  const [market, setMarket] = useState<Market | null>(null);
  const [page, setPage] = useState<{ page: Page; symbol: string | null }>(() => pageFromHash(location.hash) ?? { page: 'screener', symbol: null });
  /** Stock whose chart page is open, and the list it was opened from (for previous / next). */
  const [chart, setChart] = useState<string | null>(() => chartFromHash(location.hash));
  const [chartList, setChartList] = useState<string[]>([]);
  const chartPushed = useRef(false);
  const [saved, setSaved] = useState<SavedScan[]>(loadSaved);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [live, setLive] = useState<LiveSnapshot | null>(null);
  /** Bumped whenever live prices change the data, so everything built on it is fetched again. */
  const [version, setVersion] = useState(0);

  const setScan = (s: Scan) => setScanState({ scan: s, preset: null });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The scan is remembered in the browser; the URL only names the page or the open chart.
  useEffect(() => storeCurrent(scan, preset), [scan, preset]);
  useEffect(() => {
    // Old `#s=` scan links have been read; drop them from the address.
    if (legacyScanFromHash(location.hash)) history.replaceState(null, '', location.pathname + location.search + (chart ? chartHash(chart) : ''));
  }, []);
  useEffect(() => {
    // Back / forward, and links typed or pasted in.
    const onNav = () => {
      const c = chartFromHash(location.hash);
      setChart(c);
      if (!c) {
        chartPushed.current = false;
        setPage(pageFromHash(location.hash) ?? { page: 'screener', symbol: null });
      }
    };
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
    return () => {
      window.removeEventListener('popstate', onNav);
      window.removeEventListener('hashchange', onNav);
    };
  }, []);
  const goTo = useCallback((next: Page, symbol: string | null = null) => {
    history.pushState(null, '', pageHash(next, symbol) || location.pathname + location.search);
    chartPushed.current = false;
    setChart(null);
    setPage({ page: next, symbol });
    window.scrollTo(0, 0);
  }, []);
  const openChart = useCallback((symbol: string, list: string[]) => {
    setChartList(list);
    history.pushState(null, '', chartHash(symbol));
    chartPushed.current = true;
    setChart(symbol);
  }, []);
  const navigateChart = useCallback((symbol: string) => {
    history.replaceState(null, '', chartHash(symbol));
    setChart(symbol);
  }, []);
  const closeChart = useCallback(() => {
    if (chartPushed.current) history.back(); // popstate clears `chart`
    else {
      history.replaceState(null, '', pageHash(page.page, page.symbol) || location.pathname + location.search);
      setChart(null);
    }
  }, [page]);

  // Run the scan (debounced, so typing a period doesn't rescan on every keystroke). The sector and stage chips only
  // filter the table, so they're left out here and every chip's count stays available.
  const request = { conditions: scan.conditions, match: scan.match, universe: { ...scan.universe, sectors: [], stages: [] } };
  const screenKey = JSON.stringify(request);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .screen(request)
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
  }, [screenKey, version]); // screenKey covers everything in `scan` the screen depends on

  useEffect(() => {
    api.info().then(setInfo).catch(() => {});
    api.market().then(setMarket).catch(() => {});
    // Counting every preset is the heaviest job; let the first results paint before it starts.
    const t = setTimeout(() => api.overview().then(setOverview).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [version]);

  // Live prices: read the feed once on arrival (it may already hold a session the data file doesn't), then every
  // 30 seconds while the market may be open and this tab is visible.
  useEffect(() => {
    let stopped = false;
    let busy = false;
    let readOnce = false;
    const poll = async () => {
      if (busy || stopped || document.hidden || (readOnce && !marketMayBeOpen())) return;
      busy = true;
      try {
        const snap = await fetchLive();
        readOnce = true;
        if (snap && !stopped) {
          const changed = await api.applyLive(snap.date, snap.quotes);
          setLive(snap);
          if (changed) setVersion((v) => v + 1);
        }
      } catch {
        readOnce = true; // feed down or blocked: the daily data still works
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(poll, LIVE_POLL_MS);
    const onVisible = () => !document.hidden && void poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const pickPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    // The preset decides the trend template / RS / stage filters; price, turnover and sector choices stay.
    const universe = { ...scan.universe, trendTemplate: undefined, minRs: undefined, stages: [], ...p?.universe };
    setScanState({ scan: { ...scanFromPreset(id), universe }, preset: id });
  };

  const liveNow = live && live.date === info?.asOf && marketMayBeOpen();

  return (
    <div className="app">
      <header className="topbar">
        <a
          className="brand"
          href={location.pathname + location.search}
          onClick={(e) => {
            e.preventDefault();
            goTo('screener');
          }}
        >
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--brand-bg)" />
            <path d="M5 22l7-7 5 4 10-11" stroke="var(--up)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1>NEPSE Screener</h1>
        </a>
        <nav className="tabs" aria-label="Pages">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={pageHash(p.id) || '#'}
              className={page.page === p.id ? 'on' : ''}
              aria-current={page.page === p.id ? 'page' : undefined}
              title={p.title}
              onClick={(e) => {
                e.preventDefault();
                goTo(p.id);
              }}
            >
              {p.label}
            </a>
          ))}
        </nav>
        <div className="spacer" />
        <div className="data-status">
          {liveNow ? (
            <span className="live-badge" title="Prices from merolagani's live market feed, checked every 30 seconds">
              <i aria-hidden /> Live {live.time}
            </span>
          ) : (
            <span
              className="muted hide-sm"
              title={`Prices update automatically every weekday after the market closes.${info?.builtAt ? ` Last download: ${new Date(info.builtAt).toLocaleString()}` : ''}`}
            >
              {info?.asOf ? `Prices as of ${info.asOf}` : 'Loading data…'}
            </span>
          )}
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
        {page.page === 'screener' && (
          <>
            <MarketBand market={market} live={live && live.date === info?.asOf ? live : null} open={!!liveNow} />
            <PresetStrip active={preset} overview={overview} onPick={pickPreset} />
            <ScanBuilder
              scan={scan}
              onChange={setScan}
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
            <ResultsTable
              result={result}
              conditions={resultConditions}
              loading={loading}
              error={error}
              selected={chart}
              onSelect={openChart}
              sectors={scan.universe.sectors ?? []}
              onSectorsChange={(sectors) => setScan({ ...scan, universe: { ...scan.universe, sectors } })}
              stages={scan.universe.stages ?? []}
              onStagesChange={(stages) => setScan({ ...scan, universe: { ...scan.universe, stages } })}
            />
          </>
        )}
        {page.page === 'leaders' && <LeadersPage version={version} onOpenChart={openChart} />}
        {page.page === 'journal' && <JournalPage version={version} onOpenChart={openChart} />}
        {page.page === 'calculator' && <CalculatorPage symbol={page.symbol} version={version} onOpenChart={(s) => openChart(s, [])} />}
        <footer className="foot muted small">
          Prices from merolagani.com, adjusted for bonus and right shares{liveNow ? '; today’s prices from its live market feed' : ''}. Signals are
          computed on daily closes. Not investment advice.
          {info?.builtAt && <> Data file built {fmt.relTime(info.builtAt)}.</>}
        </footer>
      </main>

      {chart && (
        <ChartPage
          symbol={chart}
          conditions={page.page === 'screener' ? scan.conditions : []}
          theme={theme}
          list={chartList}
          version={version}
          onNavigate={navigateChart}
          onClose={closeChart}
          onSizePosition={(s) => goTo('calculator', s)}
        />
      )}
    </div>
  );
}
