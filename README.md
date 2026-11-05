# NEPSE Screener

Filter NEPSE-listed companies by technical signals: EMA/SMA crosses, price vs moving average, RSI, MACD,
Supertrend, Bollinger Bands, ADX, Stochastic, volume spikes, 52-week and 21-day breakouts, and any combination of
them. Every stock also carries an RS rating, its Weinstein stage and a trend template score. Alongside the screener:
a Leaders page, a position-size calculator and a trade journal.

The site is fully static. A scheduled GitHub Action downloads end-of-day prices every weekday, packs them into
one data file (`data/snapshot.json`, about 2.4 MB gzipped), and publishes the site to GitHub Pages. Screening
and charts run in the visitor's browser, so there is no server to host or keep alive. During market hours the page
also reads merolagani's live market summary every 30 seconds and re-runs everything on today's prices (see
[Live prices](#live-prices)).

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
| happened            | an event (e.g. a breakout's follow-through) occurred within the last N bars       |

Either side can be Close/Open/High/Low, EMA, SMA, WMA, Supertrend, Bollinger (upper/middle/lower), Breakout,
Highest high / Lowest low of the previous N days (so `Close crosses above Highest high 250 days` is a
52-week breakout), Volume, Avg Volume, RSI, MACD (line/signal/histogram), Stochastic (%K/%D), ADX
(+DI/-DI), ATR, % change, or a fixed number. **+ multiplier** compares against a multiple of the right side,
e.g. `Volume is above 2 times Avg Volume` or `Close is above 0.95 times Highest high`. Every condition also
shows a plain-English sentence of what it checks.

Indicator formulas follow TradingView's built-ins (Wilder smoothing for RSI/ATR/ADX, population
standard deviation for Bollinger Bands, TradingView's Supertrend), so values line up with charts traders
already use.

A scan with no conditions lists every stock that passes the filters (the **All stocks** quick scan), strongest RS
rating first. The filters skip suspended scrips (no trade in 10 days), and by default exclude mutual funds,
debentures, bonds and promoter shares. You can also require the trend template, a minimum RS rating, a price range
and a minimum average daily turnover. The stage and sector chips and the search box above the results narrow the
list without re-running the scan.

Your current scan is remembered in the browser between visits, and **Saved scans** keeps named ones.

## Strength: RS rating, stages, trend template

- **RS rating (1–99)**: a weighted 12-month return (the latest 3 months count 40%, the 3 quarters before 20% each),
  ranked against every company share that's still trading. 80 means stronger than 80% of them.
- **Weinstein stage**: from the 30-week average of weekly closes and its 4-week slope (flat = moved less than 0.5%).
  Stage 2 (advancing) = close above a rising average, Stage 4 (declining) = close below a falling one. Otherwise
  it's Stage 3 (topping) after an advance or Stage 1 (basing) after a decline. Weeks run Sunday to Saturday. The
  table shows how many weeks the stock has been in its stage. This is a rule-based reading of Weinstein's method,
  not his judgement.
- **Trend template**: Mark Minervini's 8 rules: price above the 150- and 200-day averages, 150 above 200, the
  200-day rising for a month, 50 above 150 and 200, price above the 50-day, at least 30% above the 52-week low,
  within 25% of the 52-week high, RS rating 70+. The table shows how many are met; hover for the missing ones.

The **Trend template** and **Stage 2 leaders** (Stage 2 with RS 80+) quick scans list those stocks.

## Breakout indicator

`Breakout (21)` draws the highest high of the previous 21 days as a grey step line, and judges on closes:

- A close above the line starts a breakout and the line turns green.
- It stays green until a close falls back below the level it broke. Each new 21-day high while it holds moves
  that level up to the one just broken.
- The first later close above the breakout day's high is the follow-through, marked **B** on the chart.

In scans: `Breakout · Breakout happened`, `Breakout · Follow-through happened` and `Breakout · Holding happened`,
used by the **21-day breakout** and **Breakout follow-through** quick scans.

## Leaders page

How many stocks sit in each stage, the Stage 2 leaders (RS 80+), and each sector ranked by median RS with its top
three (leaders) and bottom three (laggards). A turnover filter keeps thinly traded stocks out of the ranking.

## Position size

Capital, risk per trade (% of capital), entry and stop-loss give the number of shares whose loss at the stop,
**fees included**, stays within that risk, capped by the capital. Pick a stock to fill the entry with its last
close and get stop ideas (below the 21-day low, 2 × ATR, the 30-week average). It also shows the break-even price
and the profit at 1R, 2R, 3R and your own target after fees and capital gains tax. Open it from any chart with
**Position size**.

Fees default to SEBON's 2024 schedule: broker commission 0.36% (up to Rs 50,000), 0.33% (to 5 lakh), 0.31%
(to 20 lakh), 0.27% (to 1 crore), 0.24% (above), on the whole order; SEBON fee 0.015%; DP charge Rs 25 per sale;
capital gains tax 7.5% (held a year or less) or 5%. They're editable, and remembered in the browser, because rates
change and some brokers differ.

## Trade journal

Log buys and sales; a sale closes the oldest shares first. Open positions are valued at the latest close.
Closed trades show profit after fees and tax (both optional), and an R multiple when the buy had a stop. The
summary has win rate, average win and loss, profit factor and average R. Entries live in this browser only:
**Back up** downloads them as a file and **Restore** adds a file's entries back (on this or another device).

## Live prices

merolagani's market summary feed allows any site to read it, so the page polls it every 30 seconds from 10:30 to
15:15 Nepal time, Sunday to Friday, while the tab is visible, and once on every visit. Each stock that traded
gets today's open/high/low/last price and volume as its latest bar, and the scans, ranks, leaders and an open
chart update in place. The top bar shows **Live** with the feed's time, and the market band adds the day's
turnover, shares, trades and stocks traded. Outside market hours the same read picks up the closing prices
before the nightly data file does.

The feed has no index value, so the NEPSE index shows its last close during the session. merolagani's push
channel (SignalR) refuses other sites, which is why this polls.

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
- The stock's RS rating, stage and trend template score in the header, and **Position size** to size a trade.

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
shared/     indicator math, indicator registry, condition evaluation, presets, stage / RS / trend template
            (analysis.ts), fees (costs.ts), journal maths, the engine the UI calls, and the data-file format
pipeline/   merolagani client, cache + refresh, and build-data.ts which writes public/data/snapshot.json
src/        React UI: screener, leaders, calculator and journal pages, chart page (src/chart/: indicators and
            drawing tools), and the live-price poller (live.ts)
.github/    the daily build-and-deploy workflow
```

Not investment advice. Signals are computed on daily closes (today's live price during the session) and are only
as good as the source data.
