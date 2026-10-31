# NEPSE Screener

Filter NEPSE-listed companies by technical signals: EMA/SMA crosses, price vs moving average, RSI, MACD,
Supertrend, Bollinger Bands, ADX, Stochastic, volume spikes, 52-week breakouts, and any combination of them.

The site is fully static. A scheduled GitHub Action downloads end-of-day prices every weekday, packs them into
one data file (`data/snapshot.json`, about 2.4 MB gzipped), and publishes the site to GitHub Pages. Screening
and charts run in the visitor's browser, so there is no server to host or keep alive.

## Run it locally

Needs Node 23.6+ (the data script is TypeScript run directly by Node).

```bash
npm install
npm run data         # download prices into data/ and write public/data/snapshot.json (~1 min first time)
npm run dev          # http://localhost:5173
```

`npm run data -- --offline` rebuilds the data file from the local cache without downloading, and
`npm run data -- --discover` re-scans every listed symbol for new listings. `npm run build` produces the
static site in `dist/`, and `npm run preview` serves it. `npm test` runs the indicator, screener and
data-format tests. `npm run type-check` type-checks everything.

## How a scan works

A scan is a list of conditions joined by **All** or **Any**. Each condition compares two sides:

| Comparison          | Passes when                                                                       |
| ------------------- | --------------------------------------------------------------------------------- |
| crosses above       | left went from ≤ right to > right within the last N bars (optionally still above) |
| crosses below       | the mirror image                                                                  |
| is above / below    | left > right (or <) on each of the last N bars                                    |
| is rising / falling | left went up (or down) on each of the last N bars                                 |

Either side can be Close/Open/High/Low, EMA, SMA, WMA, Supertrend, Bollinger (upper/middle/lower),
Highest high / Lowest low of the previous N days (so `Close crosses above Highest high 250 days` is a
52-week breakout), Volume, Avg Volume, RSI, MACD (line/signal/histogram), Stochastic (%K/%D), ADX
(+DI/-DI), ATR, % change, or a fixed number. **+ multiplier** compares against a multiple of the right side,
e.g. `Volume is above 2 times Avg Volume` or `Close is above 0.95 times Highest high`. Every condition also
shows a plain-English sentence of what it checks.

Indicator formulas follow TradingView's built-ins (Wilder smoothing for RSI/ATR/ADX, population
standard deviation for Bollinger Bands, TradingView's Supertrend), so values line up with charts traders
already use.

The universe filters skip suspended scrips (no trade in 10 days), and by default exclude mutual funds,
debentures, bonds and promoter shares. You can narrow by sector, price range and average daily turnover.

Your current scan is remembered in the browser between visits, and **Saved scans** keeps named ones. The sector chips above the results narrow the list without re-running the scan.

## Chart page

Click any result to open its chart. The address becomes a short `#/chart/NABIL`, so Back returns to the
list. From there:

- **Indicators**: add any moving average, Bollinger Bands, Supertrend, highest high / lowest low, average
  volume, RSI, MACD, Stochastic, ADX, ATR or % change, edit their settings, or remove them (also from the
  legend's ×). Your list is remembered; the scan's own indicators are added on top while you look.
- **Drawing tools**: trend line, ray, horizontal line, rectangle, Fibonacci retracement and a measure tool
  (price change, % and days). Click to select, drag to move, Delete to remove. Drawings are saved per stock in
  the browser.
- **Full screen**, the time-range buttons, arrows at the scan's past signals, a search box to jump to any
  stock, and ‹ › (or the ← → keys) to step through the results.

## Data

Daily bars come from merolagani.com's public chart endpoint, adjusted for bonus and right shares. The
company list and each session's traded symbols come from its search and market summary endpoints, and each
company's sector from its company page (looked up once, then cached).

The download keeps a cache in `data/` (restored between Action runs with `actions/cache`). Each run
re-downloads full history rather than appending, because a bonus issue re-adjusts every past price. Symbols
that haven't traded for 60 days stop being refreshed, and once a week the whole symbol list is re-checked.

The published file keeps the last four years per symbol: long enough for EMA(200) to settle, so signals match
what the full history gives. Prices are rounded to the paisa and delta-encoded to keep the file small.

## Layout

```
shared/     indicator math, indicator registry, condition evaluation, presets, the engine the UI calls,
            and the data-file format
pipeline/   merolagani client, cache + refresh, and build-data.ts which writes public/data/snapshot.json
src/        React UI: market band, preset scans, condition builder, results table, chart page (src/chart/:
            indicators and drawing tools)
.github/    the daily build-and-deploy workflow
```

Not investment advice. Signals are computed on daily closes and are only as good as the source data.
