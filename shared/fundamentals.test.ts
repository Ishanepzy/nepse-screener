import { test } from 'node:test';
import assert from 'node:assert/strict';
import { letterA, letterC, letterI, nextFlight, parseAmount, parseAnnual, parseFundHoldings, parseQuarterSeries, parseTearsheet, quarterProfit, type Fundamentals } from './fundamentals.ts';

test('amounts in the units nepsetrading prints', () => {
  assert.equal(parseAmount('2.56 Arba'), 2.56e9);
  assert.equal(parseAmount('-82.12 Cr'), -82.12e7);
  assert.equal(parseAmount('45.10 Lakh'), 45.1e5);
  assert.equal(parseAmount('1,234'), 1234);
  assert.equal(parseAmount('1.2 Zillion'), null);
  assert.equal(parseAmount('—'), null);
});

test('the flight data of a Next.js page is its pushed strings, joined', () => {
  const html = `<script>self.__next_f.push([1,"a:[\\"x\\""])</script><script>self.__next_f.push([1,",1]\\n"])</script>`;
  assert.equal(nextFlight(html), 'a:["x",1]\n');
});

test('tearsheet: year-to-date net profit per quarter, from the keyed table cells', () => {
  const cell = (key: string, text: string) => `["$","td","${key}",{"title":"+45.4% vs Q1","style":{"backgroundColor":"rgba(16,185,129,0.55)"},"className":"x","children":"${text}"}]`;
  const flight = `"tr","netProfit",{"children":[${cell('2083/2084Q1netProfit', '2.56 Arba')},${cell('2082/2083Q4netProfit', '7.91 Arba')},${cell('2082/2083Q1operatingProfit', '9 Arba')},${cell('2081/2082Q2netProfit', '-82.12 Cr')}]}`;
  assert.deepEqual(parseTearsheet(flight), [
    [2083, 1, 2.56e9],
    [2082, 4, 7.91e9],
    [2081, 2, -82.12e7],
  ]);
});

test('five-year page: net profit by fiscal year, only for the year asked', () => {
  const flight =
    `{"keys":["78/79 Q4","79/80 Q4"],"values":[1,2],"precision":1000,"monetary":true,"label":"Net Interest Income"}` +
    `{"keys":["80/81 Q4","81/82 Q4","82/83 Q4"],"values":[7060033,7127567,7905796],"precision":1000,"monetary":true,"label":"Net Profit","fill":true}`;
  assert.deepEqual(parseAnnual(flight, 2082), [
    [2080, 7060033000],
    [2081, 7127567000],
    [2082, 7905796000],
  ]);
  assert.equal(parseAnnual(flight, 2083), null);
});

test('a quarterly page for another quarter: five years of that quarter to date, rounded to rupees', () => {
  const flight = `{"keys":["81/82 Q2","82/83 Q2"],"values":[-352738.159,674435.83],"precision":1000,"monetary":true,"label":"Net Profit","fill":true}`;
  assert.deepEqual(parseQuarterSeries(flight), {
    quarter: 2,
    rows: [
      [2081, -352738159],
      [2082, 674435830],
    ],
  });
  // not a fourth quarter: no full-year figures
  assert.equal(parseAnnual(flight, 2082), null);
  assert.equal(parseQuarterSeries('{"keys":[],"values":[]}'), null);
});

test('mutual fund holdings: the total from each scheme’s part of it, and the shares the public holds', () => {
  const owner = (who: string, sh: string) =>
    `["$","div","${who}",{"children":[["$","div",null,{"className":"x","children":"${who}"}],["$","div",null,{"className":"y","children":["51","%"]}],["$","div",null,{"className":"z","children":["${sh}"," sh"]}]]}]`;
  const row = (sym: string, shares: number, part: string) =>
    `["$","tr","${sym}-null-null-${shares}",{"className":"r","children":[["$","th",null,{"scope":"row","className":"s","children":["${sym}",null]}],["$","td",null,{"className":"t","children":"${shares}"}],["$","td",null,{"className":"t","children":"1.23 Cr"}],["$","td",null,{"className":"t","children":"${part}"}]]}]`;
  const page = (rows: string) =>
    `${owner('Promoter', '4,83,49,029')},${owner('Public', '4,64,53,969')}["$","section",null,{"id":"funds","children":[${rows}]}],["$","section",null,{"id":"brokers"}]`;
  // NLIC: 5,29,139 shares are 69.2% of all fund holdings; the smaller rows would give a rougher total
  const nlic = parseFundHoldings(page(`${row('MSIP', 16498, '2.2%')},${row('NMBSBF', 529139, '69.2%')},${row('MBLEF', 40339, '5.3%')}`));
  assert.deepEqual(nlic, { mf: Math.round(529139 / 0.692), float: 46453969 });
  // ownership but no mutual fund table: no fund holds it
  assert.deepEqual(parseFundHoldings(`${owner('Public', '1,000')}`), { mf: 0, float: 1000 });
  assert.equal(parseFundHoldings('<html>nothing</html>'), null);
});

// NABIL's last 8 quarters, year to date
const nabil: Fundamentals = {
  q: [
    [2083, 1, 2.56e9],
    [2082, 4, 7.91e9],
    [2082, 3, 6.76e9],
    [2082, 2, 4.76e9],
    [2082, 1, 1.76e9],
    [2081, 4, 7.13e9],
    [2081, 3, 5.05e9],
    [2081, 2, 3.24e9],
  ],
  a: [
    [2078, 4.972756e9],
    [2079, 7.527149e9],
    [2080, 7.060033e9],
    [2081, 7.127567e9],
    [2082, 7.905796e9],
  ],
};

test('C: the latest quarter on its own against the same quarter a year before', () => {
  assert.equal(quarterProfit(nabil, 2082, 4), 7.91e9 - 6.76e9);
  assert.equal(quarterProfit(nabil, 2083, 1), 2.56e9);
  const c = letterC(nabil); // Q1: 2.56 against 1.76 Arba = +45.5%
  assert.equal(c.ok, true);
  assert.match(c.why, /Q1 2083\/84 net profit \+45\.5%/);

  // Q4 2082/83 alone (1.15) against Q4 2081/82 alone (2.08): down
  const q4 = letterC({ ...nabil, q: nabil.q.slice(1) });
  assert.equal(q4.ok, false);
  // a year-ago fourth quarter missing from the quarterly results comes from the full-year figures
  const gap: Fundamentals = { q: [[2082, 4, 300], [2082, 3, 200], [2081, 3, 150]], a: [[2081, 230]] };
  assert.match(letterC(gap).why, /Q4 2082\/83 net profit \+25\.0%/); // 100 against 80
  // no year-ago quarter to compare with
  assert.equal(letterC({ q: [[2083, 1, 1e9]], a: [] }).ok, null);
  // against a loss
  assert.equal(letterC({ q: [[2083, 1, 1e9], [2082, 1, -1e8]], a: [] }).ok, false);
  assert.equal(letterC(undefined).ok, null);
});

test('A: up every year for three years, 25% a year or more', () => {
  // NABIL fell in 2080/81, and grew about 4% a year over the three
  assert.equal(letterA(nabil).ok, false);
  const grower: Fundamentals = { q: [], a: [[2079, 100], [2080, 130], [2081, 169], [2082, 219.7]] };
  const a = letterA(grower);
  assert.equal(a.ok, true);
  assert.match(a.why, /\+30\.0% a year from 2079\/80 to 2082\/83, up every year/);
  // fast overall but one down year
  assert.equal(letterA({ q: [], a: [[2079, 100], [2080, 200], [2081, 190], [2082, 300]] }).ok, false);
  // a fourth quarter in the quarterly results counts as that year's result
  assert.equal(letterA({ q: [[2082, 4, 220]], a: [[2079, 100], [2080, 130], [2081, 170]] }).ok, true);
  assert.equal(letterA({ q: [], a: [[2081, 1], [2082, 2]] }).ok, null);
});

test('I: a real mutual fund stake, not shrinking', () => {
  const f = (mf: [string, number][]): Fundamentals => ({ q: [], a: [], mf, float: 1_000_000 });
  assert.equal(letterI(f([['2026-11-14', 20_000]]), '2026-11-14').ok, true); // 2%, no history yet
  assert.equal(letterI(f([['2026-11-14', 5_000]]), '2026-11-14').ok, false); // 0.5%
  // fell from 30,000 three months ago
  assert.equal(letterI(f([['2026-08-10', 30_000], ['2026-11-14', 20_000]]), '2026-11-14').ok, false);
  // rose; the reading a week ago is too recent to compare with
  const up = letterI(f([['2026-08-10', 15_000], ['2026-11-07', 25_000], ['2026-11-14', 20_000]]), '2026-11-14');
  assert.equal(up.ok, true);
  assert.match(up.why, /\+33\.3% since 2026-08-10/);
  assert.equal(letterI({ q: [], a: [] }, '2026-11-14').ok, null);
});
