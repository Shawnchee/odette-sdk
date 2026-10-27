// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Whitelist: only Odette's products, collateral, markets and OptionBook pass.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, checkWhitelist, filterWhitelisted, OPTION_BOOK_R12, IMPLEMENTATIONS } from '../src/index.ts';

// Feed recorded at 2026-10-27T07:19:59Z. Every time rule is judged at that moment.
const NOW = 1793085599;
const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const clone = (x) => structuredClone(x);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const wl = parseFeed(load('whitelist-orders.json'));
const sample = parseFeed(load('feed-sample.json'));
const put = wl.orders[0];
const ranger = wl.orders[4];
const callSpread = sample.orders.find((o) => o.order.implementation === IMPLEMENTATIONS.CALL_SPREAD && o.order.collateral.toLowerCase() === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
const putSpread = sample.orders.find((o) => o.order.implementation === IMPLEMENTATIONS.PUT_SPREAD && o.order.collateral.toLowerCase() === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');

function rejectReason(raw, opts = {}) {
  const r = checkWhitelist(raw, { now: NOW, ...opts });
  return r.ok ? 'accepted' : r.reason;
}

check('fixture parses: 10 orders, none malformed', () => {
  assert.equal(wl.orders.length, 10);
  assert.deepEqual(wl.malformed, []);
});

check('10-order fixture: exactly the 5 real Odette orders pass', () => {
  const { accepted, rejected } = filterWhitelisted(wl.orders, { now: NOW });
  assert.deepEqual(
    accepted.map((o) => o.ticker),
    ['ETH-28OCT26-2180-P', 'BTC-28OCT26-77000-P', 'ETH-28OCT26-2320-C', 'SOL-28OCT26-101-C', 'BTC-28OCT26-79000/80000-RANGER']
  );
  assert.deepEqual(
    accepted.map((o) => o.product),
    ['PUT', 'PUT', 'LINEAR_CALL', 'LINEAR_CALL', 'RANGER']
  );
  assert.deepEqual(
    accepted.map((o) => o.underlying),
    ['ETH', 'BTC', 'ETH', 'SOL', 'BTC']
  );
  assert.deepEqual(
    rejected.map((r) => r.reason),
    ['unsupported-implementation', 'unsupported-implementation', 'wrong-collateral', 'unknown-market', 'bad-strikes']
  );
});

check('reject messages are the PRD texts', () => {
  const { rejected } = filterWhitelisted(wl.orders, { now: NOW });
  assert.equal(rejected[0].message, 'Order type is not supported by Odette. Implementation 0xa1d5f6b16A2e7f298F8d2cDF78F7779B4A20C4C2.');
  assert.equal(rejected[1].message, 'Order type is not supported by Odette. Implementation 0x0000000000000000000000000000000000000000.');
  assert.equal(rejected[2].message, 'Order collateral is not USDC.');
  assert.equal(rejected[3].message, 'Price feed 0x2222222222222222222222222222222222222222 is not an Odette market.');
  assert.equal(rejected[4].message, 'Order strikes do not match the option type.');
});

check('spreads are hidden by default', () => {
  assert.ok(callSpread && putSpread, 'fixture has a USDC CALL_SPREAD and PUT_SPREAD');
  assert.equal(rejectReason(callSpread), 'unsupported-implementation');
  assert.equal(rejectReason(putSpread), 'unsupported-implementation');
  assert.equal(rejectReason(callSpread, { enableSpreads: false }), 'unsupported-implementation');
});

check('spreads pass only with enableSpreads: true', () => {
  const a = checkWhitelist(callSpread, { enableSpreads: true, now: NOW });
  const b = checkWhitelist(putSpread, { enableSpreads: true, now: NOW });
  assert.ok(a.ok && b.ok);
  assert.equal(a.order.product, 'CALL_SPREAD');
  assert.equal(b.order.product, 'PUT_SPREAD');
});

check('spreads on a non BTC/ETH market are refused even when enabled', () => {
  const sol = clone(callSpread);
  sol.order.priceFeed = '0x975043adBb80fc32276CbF9Bbcfd4A601a12462D';
  assert.equal(rejectReason(sol, { enableSpreads: true }), 'unknown-market');
});

check('spread strikes must be ordered for their side', () => {
  const flipped = clone(callSpread);
  flipped.order.strikes = [...flipped.order.strikes].reverse();
  assert.equal(rejectReason(flipped, { enableSpreads: true }), 'bad-strikes');
  const flippedPut = clone(putSpread);
  flippedPut.order.strikes = [...flippedPut.order.strikes].reverse();
  assert.equal(rejectReason(flippedPut, { enableSpreads: true }), 'bad-strikes');
});

check('RANGER needs 4 strictly rising strikes', () => {
  const r3 = clone(ranger);
  r3.order.strikes = r3.order.strikes.slice(0, 3);
  assert.equal(rejectReason(r3), 'bad-strikes');
  const flat = clone(ranger);
  flat.order.strikes = [flat.order.strikes[0], flat.order.strikes[0], flat.order.strikes[2], flat.order.strikes[3]];
  assert.equal(rejectReason(flat), 'bad-strikes');
});

check('zero strike is refused', () => {
  const z = clone(put);
  z.order.strikes = [0n];
  assert.equal(rejectReason(z), 'bad-strikes');
});

check('call/put flag must match the implementation', () => {
  const p = clone(put);
  p.order.isCall = true;
  assert.equal(rejectReason(p), 'bad-call-flag');
  const c = clone(wl.orders[2]);
  c.order.isCall = false;
  assert.equal(rejectReason(c), 'bad-call-flag');
});

check('maker bids (isLong true) are refused', () => {
  const bid = clone(put);
  bid.order.isLong = true;
  assert.equal(rejectReason(bid), 'wrong-side');
});

check('OptionBook: r12 passes, absent defaults to r12, unknown is refused', () => {
  const r = checkWhitelist(put, { now: NOW });
  assert.ok(r.ok);
  assert.equal(r.order.optionBook, OPTION_BOOK_R12);
  const none = clone(put);
  delete none.optionBookAddress;
  const n = checkWhitelist(none, { now: NOW });
  assert.ok(n.ok);
  assert.equal(n.order.optionBook, OPTION_BOOK_R12);
  const other = clone(put);
  other.optionBookAddress = '0x3333333333333333333333333333333333333333';
  const o = checkWhitelist(other, { now: NOW });
  assert.equal(o.ok, false);
  assert.equal(o.reason, 'unknown-option-book');
  assert.equal(o.message, 'This order belongs to OptionBook 0x3333333333333333333333333333333333333333, which this tool does not support.');
});

check('chainId other than Base is refused', () => {
  const eth = clone(put);
  eth.chainId = 1;
  assert.equal(rejectReason(eth), 'wrong-chain');
});

check('zero price and zero liquidity are refused', () => {
  const p = clone(put);
  p.order.price = 0n;
  assert.equal(rejectReason(p), 'invalid-price');
  const l = clone(put);
  l.order.maxCollateralUsable = 0n;
  assert.equal(rejectReason(l), 'no-liquidity');
});

check('address match ignores case', () => {
  const lower = clone(put);
  lower.order.implementation = lower.order.implementation.toLowerCase();
  lower.order.collateral = lower.order.collateral.toLowerCase();
  lower.order.priceFeed = lower.order.priceFeed.toLowerCase();
  assert.equal(rejectReason(lower), 'accepted');
});

check('second probe: every USDC PUT/LINEAR_CALL/RANGER in the recorded sample passes', () => {
  const live = new Set(Object.entries(IMPLEMENTATIONS).filter(([k]) => !k.endsWith('SPREAD')).map(([, a]) => a));
  const candidates = sample.orders.filter((o) => live.has(o.order.implementation) && o.order.collateral === '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  assert.ok(candidates.length >= 3);
  for (const c of candidates) assert.equal(rejectReason(c), 'accepted', c.ticker);
});

// ---- book rules from the web app: daily expiry, 1 h to 3 days, market days, hourly binaries ----

const book = Object.fromEntries(load('book-rules.json').data.orders.map((e) => [e._case, parseFeed({ orders: [e] }).orders[0]]));

check('hourly binaries are refused, even with spreads on', () => {
  assert.equal(book['hourly-binary'].feedProduct, 'hourly_binary');
  assert.equal(rejectReason(book['hourly-binary'], { enableSpreads: true }), 'hourly-binary');
});

check('daily binaries on spread implementations follow the spread flag', () => {
  assert.equal(rejectReason(book['daily-binary-spread']), 'unsupported-implementation');
  assert.equal(rejectReason(book['daily-binary-spread'], { enableSpreads: true }), 'accepted');
});

check('RANGER 25 h out passes; RANGER 241 h out is outside the 3-day book', () => {
  assert.equal(rejectReason(book['ranger-25h']), 'accepted');
  assert.equal(rejectReason(book['ranger-241h']), 'expiry-out-of-range');
});

check('expiry window edges: 1 h and 73 h are in, outside is out', () => {
  // Move "now" instead of the expiry, so the expiry stays at 08:00 UTC.
  // The quote itself stays live for 10 minutes after "now".
  const judge = (secondsToExpiry) => {
    const now = Number(put.order.expiry) - secondsToExpiry;
    const x = clone(put);
    x.order.orderExpiryTimestamp = BigInt(now + 600);
    return rejectReason(x, { now });
  };
  assert.equal(judge(3600), 'accepted');
  assert.equal(judge(3599), 'expiry-out-of-range');
  assert.equal(judge(73 * 3600), 'accepted');
  assert.equal(judge(73 * 3600 + 1), 'expiry-out-of-range');
});

check('expiry not at 08:00 UTC is refused', () => {
  const x = clone(put);
  x.order.expiry = x.order.expiry + 3600n;
  assert.equal(rejectReason(x), 'not-daily-expiry');
});

check('DOGE and PAXG trade on Thursday (UTC) only', () => {
  const doge = clone(put);
  doge.order.priceFeed = '0x8422f3d3CAFf15Ca682939310d6A5e619AE08e57';
  // NOW is Tuesday 2026-10-27 UTC.
  assert.equal(new Date(NOW * 1000).getUTCDay(), 2);
  assert.equal(rejectReason(doge), 'market-closed');
  // Thursday 2026-10-29 00:00 UTC, with an expiry 32 h later at 08:00 UTC.
  const thu = 1793232000;
  assert.equal(new Date(thu * 1000).getUTCDay(), 4);
  doge.order.expiry = BigInt(thu + 32 * 3600);
  doge.order.orderExpiryTimestamp = BigInt(thu + 600);
  assert.equal(rejectReason(doge, { now: thu }), 'accepted');
});

check('an order with under 30 s left is refused', () => {
  const x = clone(put);
  x.order.orderExpiryTimestamp = BigInt(NOW + 29);
  assert.equal(rejectReason(x), 'order-expiring');
  x.order.orderExpiryTimestamp = BigInt(NOW + 30);
  assert.equal(rejectReason(x), 'accepted');
});

check('RANGER outer widths must be equal (RangerOption.validateParams)', () => {
  const lop = clone(ranger);
  lop.order.strikes = [lop.order.strikes[0], lop.order.strikes[1], lop.order.strikes[2], lop.order.strikes[3] + 100_00000000n];
  assert.equal(rejectReason(lop), 'bad-strikes');
  assert.equal(rejectReason(ranger), 'accepted');
});

console.log(`# whitelist: ${passed} passed`);
