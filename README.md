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

## Deploy to GitHub Pages

1. Create a **public** repository named `nepse-screener` on GitHub and push this project to its `main`
   branch. Free Pages needs a public repo.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Open the **Actions** tab, pick **Build and deploy**, and press **Run workflow**. The first run downloads
   everything, so it takes a few minutes. Tick *Re-scan every listed symbol* if you like.
4. The site goes live at `https://<your-username>.github.io/nepse-screener/`.

After that, `.github/workflows/deploy.yml` runs by itself at 09:40 and 12:10 UTC (15:25 and 17:55 Nepal
time), Monday to Friday, and on every push to `main`. A failed run leaves the previous version online.
GitHub can start scheduled runs late when it's busy. On public repos it also pauses scheduled workflows after
60 days without any commits, and emails you when it does; re-enable it from the Actions tab.

The build uses relative paths, so the same `dist/` also works on Netlify, Cloudflare Pages, Vercel or any
static host.

## How a scan works

A scan is a list of conditions joined by **All** or **Any**. Each condition compares two sides:

| Comparison          | Passes when                                                                       |
| ------------------- | --------------------------------------------------------------------------------- |
| crosses above       | left went from ≤ right to > right within the last N bars (optionally still above) |
| crosses below       | the mirror image                                                                  |
| is above / below    | left > right (or <) on each of the last N bars                                    |
| is rising / falling | left went up (or down) on each of the last N bars                                 |

Either side can be Close/Open/High/Low, EMA, SMA, WMA, Supertrend, Bollinger (upper/middle/lower),
N-day High/Low (excluding today, so `Close crosses above 250-day High` is a breakout), Volume,
Avg Volume, RSI, MACD (line/signal/histogram), Stochastic (%K/%D), ADX (+DI/-DI), ATR, % change, or a
fixed number. The `k×` button multiplies the right side, e.g. `Volume is above 2 × Avg Vol(20)` or
`Close is above 0.95 × 52W High`.

Indicator formulas follow TradingView's built-ins (Wilder smoothing for RSI/ATR/ADX, population
standard deviation for Bollinger Bands, TradingView's Supertrend), so values line up with charts traders
already use.

The universe filters skip suspended scrips (no trade in 10 days), and by default exclude mutual funds,
debentures, bonds and promoter shares. You can narrow by sector, price range and average daily turnover.

Scans live in the URL, so a bookmark or a pasted link reopens the same scan. **My scans** saves named
scans in the browser. Click any row for a chart with the scan's indicators and markers at past signals.

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
src/        React UI: market band, preset scans, condition builder, results table, chart drawer
.github/    the daily build-and-deploy workflow
```

Not investment advice. Signals are computed on daily closes and are only as good as the source data.
