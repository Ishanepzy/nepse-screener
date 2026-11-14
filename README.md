# NEPSE Screener

Technical screener for stocks listed on the Nepal Stock Exchange.

Live: https://ishanepzy.github.io/nepse-screener/

- scans on EMA/SMA crosses, RSI, MACD, Supertrend, Bollinger, ADX, Stochastic, volume and 52-week breakouts, or any mix of
  your own conditions
- RS rating, Weinstein stage, Minervini trend template and O'Neil's CAN SLIM for every stock
- charts with indicators and drawing tools
- relative rotation graph against the NEPSE index
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
- happened: for on/off events, such as the ratio making a new high

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

On a chart, "Trend template" draws his five daily simple averages (10, 20, 50, 150 and 200 days) over the price,
plus a panel counting the rules met each day: green at 8, amber at 6 or 7, grey below, with the missing rules
named in the legend. Either half can be removed from the legend on its own. A chart opened from the Trend template
list shows it straight away. Rule 8 needs the RS rating on every past day, which is only
worked out when that panel is open or a scan uses it.

**Price / NEPSE.** Close divided by the index close of the same day, in its own panel with its moving average.
The line turns gold with a dot on every bar where the ratio closes above its highest value of the previous 126
days (6 months), so a run of dots is a stock that keeps outrunning the market. The lookback can be changed.

**CAN SLIM.** William O'Neil's seven letters:
- C: the latest quarter's net profit up 25% or more on the same quarter a year before.
- A: net profit up in each of the last three fiscal years, 25% a year or more.
- N: within 15% of the 52-week high.
- S: more volume on up days than down days over the last 50 sessions.
- L: RS rating 80 or more.
- I: mutual funds hold 1% or more of the shares the public holds, and no less than two months before.
- M: NEPSE above its 50-day average, and the 50-day above the 200-day.

C and A use net profit rather than EPS: NEPSE companies issue bonus shares often and filed EPS isn't restated for
them. Results come from nepsetrading.com, whose robots.txt allows these pages. The daily build reads its company
list once, then a company's own page only after it files something new, and its five-year page once a year, all
cached in `data/fundamentals.json` between runs. Filings are year to date, so a quarter on its own is that filing
less the one before. For I, the same site's quarterly page names a few schemes holding the stock and the part of
all mutual fund holdings each one has, which gives the total; it is read every two weeks (funds report monthly) and
measured against the shares the public holds, since promoter shares rarely trade. Mutual funds are the only
institutions whose holdings NEPSE publishes.

The CAN SLIM list and filter need C, A, N, S, L and I; a letter without data counts as not met. M is shown in the
market panel, and O'Neil would hold off buying while it is not in an uptrend. On the chart, the CAN SLIM indicator
draws the 52-week high, the line 15% under it and the 50- and 200-day averages, with a panel of N, S, L and M on
every day.

**Relative rotation.** Each stock against the NEPSE index on weekly closes. RS-Ratio (across) is 100 plus the
z-score of price / index over 10 weeks; RS-Momentum (up) is 100 plus the z-score of RS-Ratio's weekly change over
10 weeks, both after a 3-week EMA. JdK's exact formulas aren't public, so this is the usual open approximation.
Right of centre a stock is beating the market, above centre its lead is growing. Stocks tend to travel clockwise
through improving, leading, weakening and lagging. A bubble's size is how far it sits into its quadrant, and hovering
one draws its last 6 weeks. The page shows every company share, what the screener currently lists, or the
watchlist; a stock needs about 5 months of history to appear.

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

### If prices stop updating

GitHub switches scheduled workflows off after 60 days without a push to the repo, and this build never pushes
anything. When the data file is more than 4 days old the site shows a "prices may be out of date" bar. To turn
the schedule back on, open the Actions tab, pick "Build and deploy" and click "Enable workflow", or run:

```bash
gh workflow enable deploy.yml
```

Any push resets the 60 days. There are actions that keep a schedule alive automatically, but GitHub has taken
the best-known one down for breaking its terms of service, so this repo doesn't use one.

## Layout

```
shared/     indicators, conditions, presets, ratings, fees, journal maths, the engine
pipeline/   merolagani client and the data build
src/        React UI
.github/    build and deploy workflow
```

Not investment advice.
