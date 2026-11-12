# NEPSE Screener

Technical screener for stocks listed on the Nepal Stock Exchange.

Live: https://ishanepzy.github.io/nepse-screener/

- scans on EMA/SMA crosses, RSI, MACD, Supertrend, Bollinger, ADX, Stochastic, volume and breakouts, or any mix of
  your own conditions
- RS rating, Weinstein stage and Minervini trend template for every stock
- charts with indicators and drawing tools
- watchlist, leaders and laggards by sector, position size calculator, trade journal
- live prices during market hours

There is no backend. A GitHub Action downloads end-of-day prices on weekdays, packs them into one file
(`public/data/snapshot.json`, about 2.4 MB gzipped) and deploys to GitHub Pages. The screening itself runs in the
browser.

## Running it

Needs Node 23.6 or newer, because the data script is TypeScript run directly by node.

```bash
npm install
npm run data      # downloads prices, about a minute the first time
npm run dev       # http://localhost:5173
```

Other commands:

```
npm run data -- --offline     rebuild the data file from the local cache
npm run data -- --discover    re-scan all listed symbols for new listings
npm test
npm run type-check
npm run build                 static site in dist/
```

## Scans

A scan is a list of conditions joined by all/any. A condition compares two sides:

- crosses above / below: within the last N bars, and optionally still true today
- is above / below: on each of the last N bars
- is rising / falling: N bars in a row
- happened: for on/off events such as a breakout

A side can be a price, a moving average, any of the indicators, the highest high or lowest low of the previous N
days, volume, or a fixed number. "+ multiplier" scales the right side, e.g. volume above 2 times average volume.

With no conditions the scan lists everything that passes the filters. Scrips with no trade in 10 days are always
skipped. Mutual funds, debentures and promoter shares are left out unless you untick the filter.

Indicator formulas follow TradingView (Wilder smoothing for RSI/ATR/ADX, population stdev for Bollinger), so the
numbers should match its charts.

## How the ratings are worked out

**RS rating.** Weighted 12-month return (last 3 months 40%, the three quarters before that 20% each), ranked 1 to 99
against every company share that still trades.

**Weinstein stage.** From the 30-week average of weekly closes and its slope over 4 weeks (under 0.5% is flat).
Stage 2 is a close above a rising average, stage 4 a close below a falling one. Anything else is stage 3 after an
advance and stage 1 after a decline. This is a mechanical version of the method, so it won't always agree with a
chart read by eye.

**Trend template.** Minervini's 8 rules: price above the 150 and 200-day averages, 150 above 200, 200-day rising
for a month, 50 above both, price above the 50, at least 30% above the 52-week low, within 25% of the 52-week
high, RS 70 or more.

**Breakout** (21 days by default). The line is the highest high of the previous 21 days. A close above it starts a
breakout, which holds until a close drops back under the last level broken. The first later close above the
breakout day's high is marked B.

**Price / NEPSE.** Close divided by the index close of the same day, with its moving average and its high of the
previous 250 days.

## Fees

The calculator and the journal default to the SEBON commission slabs from 2024 (0.36% up to Rs 50,000, then 0.33%,
0.31%, 0.27%, and 0.24% above 1 crore, charged on the whole order), a 0.015% SEBON fee, Rs 25 DP charge per sale,
and capital gains tax of 7.5% or 5%. Brokers differ and rates change, so all of these can be edited on the page.

## Data

Prices come from merolagani.com's public endpoints, adjusted for bonus and right shares.

- Every run downloads the full history again. A bonus issue re-adjusts all past prices, so appending would go wrong.
- The data file keeps 4 years per symbol. With 3, EMA(200) hadn't settled and a few signals came out different
  from full history.
- Symbols with no trade for 60 days stop being refreshed. The whole symbol list is re-checked once a week.
- A bar's trade date is the UTC date of its timestamp.

Live prices: merolagani's market summary feed allows cross-origin reads, so the page polls it every 30 seconds
between 10:30 and 15:15 Nepal time and treats each read as today's bar. The feed carries no index value, so the
index stays at the last close until the evening build. Their SignalR channel refuses other origins, which is why
this polls.

Watchlist, journal, saved scans, drawings and settings are kept in the browser (localStorage). The journal has
backup and restore.

## Layout

```
shared/     indicators, conditions, presets, ratings, fees, journal maths, the engine
pipeline/   merolagani client and the data build
src/        React UI
.github/    build and deploy workflow
```

Not investment advice.
