// Copyright (c) 2026 Thetanuts Finance. MIT License.
// The SDK lists what the Odette web app shows, case by case, on entries recorded
// from the live feed. The expected verdict of every entry (_page.shown, _page.why)
// was produced by the web app's own functions (thetaverse origin/dev
// odette/config.js in a node vm: getAvailableAssets, filterOrdersByCollateral,
// filterOrdersForDailyBook, filterOrdersByAssetAndType, EXPIRY_FILTER_LIMITS),
// not by this SDK.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, checkWhitelist, filterWhitelisted, IMPLEMENTATIONS, SPREAD_MARKETS, MARKET_DAYS } from '../src/index.ts';

const fx = JSON.parse(readFileSync(new URL('./fixtures/page-cases.json', import.meta.url), 'utf8'));
const NOW = fx.now;
const { orders, malformed } = parseFeed(fx);
const entries = fx.data.orders.map((e, i) => ({ ...e, raw: orders[i] }));

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const verdict = (raw, opts = {}) => {
  const r = checkWhitelist(raw, { now: NOW, ...opts });
  return r.ok ? 'shown' : r.reason;
};
const byCase = (prefix) => entries.filter((e) => e._case.startsWith(prefix));
const SPREAD_IMPLS = new Set([IMPLEMENTATIONS.CALL_SPREAD, IMPLEMENTATIONS.PUT_SPREAD].map((a) => a.toLowerCase()));

check('fixture parses: every entry, none malformed, recorded on a Friday with no DOGE or PAXG chip', () => {
  assert.equal(malformed.length, 0);
  assert.ok(entries.length >= 30);
  assert.equal(new Date(NOW * 1000).getUTCDay(), 5);
  assert.deepEqual(fx.chips, ['ETH', 'BTC', 'XRP', 'BNB', 'SOL', 'AVAX']);
});

check('every entry: the SDK lists it exactly when the page shows it', () => {
  for (const e of entries) {
    const r = checkWhitelist(e.raw, { now: NOW });
    assert.equal(r.ok, e._page.shown, `${e._case}: page says ${e._page.why}, SDK says ${r.ok ? 'shown' : r.reason}`);
  }
});

check('the reason the SDK gives matches the page rule that hid the order', () => {
  const expect = {
    'hourly-binary': 'hourly-binary',
    'no-chip-today': 'market-closed',
    'beyond-3-days': 'expiry-out-of-range',
  };
  for (const e of entries) {
    if (e._page.shown) continue;
    if (e._page.why === 'collateral') {
      // The feed's non-USDC orders are physical PUT/CALL: the page drops them by
      // collateral first (app.js:152), the SDK by implementation first. Both hide them.
      assert.ok(['wrong-collateral', 'unsupported-implementation'].includes(verdict(e.raw)), e._case);
      continue;
    }
    if (e._page.why === 'not-a-listed-product') {
      // A spread on BNB or SOL fails the page's BTC/ETH rule (isSpreadOrder);
      // a fly or condor fails the implementation rule.
      const isSpread = SPREAD_IMPLS.has(e.order.implementation.toLowerCase());
      assert.equal(verdict(e.raw), isSpread ? 'unknown-market' : 'unsupported-implementation', e._case);
      continue;
    }
    assert.equal(verdict(e.raw), expect[e._page.why], e._case);
  }
});

check('BTC and ETH spreads inside 3 days are shown; the same spreads at 76 h are not (nearest three expiries)', () => {
  const shown = entries.filter((e) => /^spread-(BTC|ETH)-\d+h$/.test(e._case));
  assert.ok(shown.length >= 4);
  for (const e of shown) {
    const r = checkWhitelist(e.raw, { now: NOW });
    assert.ok(r.ok, e._case);
    assert.ok(['CALL_SPREAD', 'PUT_SPREAD'].includes(r.order.product));
    assert.ok(SPREAD_MARKETS.includes(r.order.underlying));
  }
  const later = byCase('spread-beyond-3-days');
  assert.ok(later.length >= 1);
  for (const e of later) {
    assert.ok(Number(e.order.expiry) - NOW > 73 * 3600);
    assert.equal(verdict(e.raw), 'expiry-out-of-range', e._case);
  }
});

check('a spread on BNB or SOL is not listed, by the SDK or the page', () => {
  for (const sym of ['BNB', 'SOL']) {
    const [e] = byCase(`spread-on-${sym}`);
    assert.ok(e, `fixture has a ${sym} spread`);
    assert.equal(e._page.shown, false);
    assert.equal(verdict(e.raw), 'unknown-market');
  }
});

check('hourly binaries on the spread implementations stay out', () => {
  const hb = byCase('hourly-binary');
  assert.ok(hb.length >= 1);
  for (const e of hb) {
    assert.ok(SPREAD_IMPLS.has(e.order.implementation.toLowerCase()));
    assert.equal(e._page.shown, false);
    assert.equal(verdict(e.raw), 'hourly-binary');
  }
});

check('Thursday-only markets: DOGE orders are in the feed on a Friday, the page has no chip, the SDK says market-closed', () => {
  const doge = byCase('thursday-only-market');
  assert.ok(doge.length >= 1);
  for (const e of doge) {
    assert.equal(e._page.asset, 'DOGE');
    assert.equal(e._page.why, 'no-chip-today');
    assert.equal(verdict(e.raw), 'market-closed');
  }
  assert.deepEqual(MARKET_DAYS.DOGE, [4]);
  // The same order on the Thursday before its expiry is listed.
  const e = doge[0];
  const thursday = Number(e.order.expiry) - 32 * 3600;
  assert.equal(new Date(thursday * 1000).getUTCDay(), 4);
  const moved = structuredClone(e.raw);
  moved.order.orderExpiryTimestamp = BigInt(thursday + 600);
  assert.equal(verdict(moved, { now: thursday }), 'shown');
});

check('enableSpreads: false hides exactly the spread entries the page shows', () => {
  const on = filterWhitelisted(entries.map((e) => e.raw), { now: NOW });
  const off = filterWhitelisted(entries.map((e) => e.raw), { now: NOW, enableSpreads: false });
  const onSpreads = on.accepted.filter((o) => o.product.endsWith('SPREAD'));
  assert.ok(onSpreads.length >= 4);
  assert.equal(off.accepted.length, on.accepted.length - onSpreads.length);
  assert.ok(off.accepted.every((o) => !o.product.endsWith('SPREAD')));
});

check('the Chart dedupes a spread by its selection key, best multiple first: the cheapest quote of two with the same key is the one shown', () => {
  // The recorded feed has no two orders with one selection key (397 orders,
  // 397 keys). Make the case: the same instrument quoted twice.
  const [e] = byCase('spread-ETH-28h');
  const dearer = structuredClone(e.raw);
  dearer.order.price = (dearer.order.price * 11n) / 10n;
  const both = filterWhitelisted([e.raw, dearer], { now: NOW }).accepted;
  assert.equal(both.length, 2);
  const width = (o) => { const [a, b] = o.rawApiData.strikes.map(BigInt); return a > b ? a - b : b - a; };
  assert.equal(width(both[0]), width(both[1]));
  // Same width: the page's "best multiple" (width / premium) is the lower premium,
  // which is what the CLI's selector picks (cheapest of the matches).
  const best = both.reduce((x, y) => (y.order.price < x.order.price ? y : x));
  assert.equal(best.order.price, e.raw.order.price);
});

// The page's choice, computed apart from the SDK: float k / premium, first wins a tie (revamp.js readRanges).
const pageMultiple = (e) => (Number(e.order.strikes[1]) - Number(e.order.strikes[0])) / Number(e.order.price);
const zonePairs = () => {
  const zones = {};
  for (const e of byCase('ranger-zone-')) (zones[e._case] ??= []).push(e);
  return Object.values(zones).filter((z) => z.length === 2);
};

check('a RANGER zone quoted twice: only the page\'s best multiple is accepted', () => {
  const pairs = zonePairs();
  assert.ok(pairs.length >= 1);
  for (const [a, b] of pairs) {
    assert.deepEqual(a.order.strikes.slice(1, 3), b.order.strikes.slice(1, 3));
    assert.notEqual(a.order.strikes[0], b.order.strikes[0]);
    const best = pageMultiple(b) > pageMultiple(a) ? b : a;
    const other = best === a ? b : a;
    for (const input of [[a.raw, b.raw], [b.raw, a.raw]]) {
      const { accepted, rejected } = filterWhitelisted(input, { now: NOW });
      assert.equal(accepted.length, 1);
      assert.deepEqual(accepted[0].rawApiData.strikes.map(String), best.order.strikes.map(String));
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason, 'ranger-zone-not-best');
      assert.deepEqual(rejected[0].raw.order.strikes.map(String), other.order.strikes.map(String));
    }
    // One order at a time, the rules still pass: a fill of a held order is judged on its own.
    assert.equal(verdict(other.raw), 'shown');
  }
});

check('a RANGER tie keeps the first order; other expiries and zones are not touched', () => {
  const [[a]] = zonePairs();
  const twin = structuredClone(a.raw);
  twin.signature = '0x' + 'ab'.repeat(65);
  const tied = filterWhitelisted([a.raw, twin], { now: NOW });
  assert.equal(tied.accepted.length, 1);
  assert.equal(tied.accepted[0].signature, a.raw.signature);
  const otherZone = structuredClone(a.raw);
  otherZone.order.strikes = a.raw.order.strikes.map((s) => s + 100_00000000n);
  assert.equal(filterWhitelisted([a.raw, otherZone], { now: NOW }).accepted.length, 2);
});

check('the recorded book: the SDK accepts every shown entry except zone losers, and nothing hidden', () => {
  const losers = zonePairs().length;
  const { accepted, rejected } = filterWhitelisted(entries.map((e) => e.raw), { now: NOW });
  assert.equal(accepted.length, entries.filter((e) => e._page.shown).length - losers);
  assert.equal(rejected.filter((r) => r.reason === 'ranger-zone-not-best').length, losers);
  assert.equal(rejected.filter((r) => r.reason !== 'ranger-zone-not-best').length, entries.filter((e) => !e._page.shown).length);
});

console.log(`# page-rules: ${passed} passed`);
