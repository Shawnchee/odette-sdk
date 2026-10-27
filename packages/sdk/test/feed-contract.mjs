// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Feed contract: a recorded live payload normalizes to the typed shape, and
// fetchOrders returns only whitelisted orders. globalThis.fetch is stubbed.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, fetchOrders, fetchOrdersRaw, OdetteError, DEFAULT_FEED_URL } from '../src/index.ts';

// Feed recorded at 2026-10-27T07:19:59Z. Every time rule is judged at that moment.
const NOW = 1793085599;
const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function stubFetch(body, { status = 200, json = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (!json) throw new SyntaxError('Unexpected token < in JSON');
        return structuredClone(body);
      },
    };
  };
  return calls;
}

function captureLogger() {
  const warns = [];
  return { warns, logger: { warn: (msg, meta) => warns.push({ msg, meta }) } };
}

const sample = load('feed-sample.json');

await check('recorded payload: 14 entries, none malformed', async () => {
  const { orders, malformed } = parseFeed(sample);
  assert.equal(orders.length, 14);
  assert.deepEqual(malformed, []);
});

await check('recorded payload: first entry has the typed shape', async () => {
  const [o] = parseFeed(sample).orders;
  assert.deepEqual(o, {
    order: {
      maker: '0xEcda1D002FBC55F2Fd3386bB4B9B95F859f3C39E',
      orderExpiryTimestamp: 1793085698n,
      collateral: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      isCall: false,
      priceFeed: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
      implementation: '0x7355EB92dfb0503DB558a70c10843618932ab290',
      isLong: false,
      maxCollateralUsable: 10_000_000000n,
      strikes: [2180_00000000n],
      expiry: 1793174400n,
      price: 228880710n,
      extraOptionData: '0x',
    },
    signature: '0x' + '11'.repeat(65),
    chainId: 8453,
    optionBookAddress: '0x1bDff855d6811728acaDC00989e79143a2bdfDed',
    ticker: 'ETH-28OCT26-2180-P',
  });
});

await check('recorded payload: every entry carries optionBookAddress r12 and chainId 8453', async () => {
  for (const o of parseFeed(sample).orders) {
    assert.equal(o.optionBookAddress, '0x1bDff855d6811728acaDC00989e79143a2bdfDed');
    assert.equal(o.chainId, 8453);
  }
});

await check('fetchOrders: default URL, only PUT / LINEAR_CALL / RANGER on USDC', async () => {
  const calls = stubFetch(sample);
  const { warns, logger } = captureLogger();
  const orders = await fetchOrders({ logger, now: NOW });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, DEFAULT_FEED_URL);
  assert.deepEqual(orders.map((o) => o.product).sort(), ['LINEAR_CALL', 'PUT', 'RANGER']);
  for (const o of orders) assert.equal(o.rawApiData.collateral, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  assert.equal(warns.length, 1);
  assert.equal(warns[0].meta.count, 11);
});

await check('fetchOrders: enableSpreads adds the two USDC BTC spreads only', async () => {
  stubFetch(sample);
  const orders = await fetchOrders({ enableSpreads: true, now: NOW });
  assert.deepEqual(orders.map((o) => o.product).sort(), ['CALL_SPREAD', 'LINEAR_CALL', 'PUT', 'PUT_SPREAD', 'RANGER']);
});

await check('fetchOrders on the 10-order fixture returns the 5 allowed', async () => {
  stubFetch(load('whitelist-orders.json'));
  const orders = await fetchOrders({ feedUrl: 'https://feed.example/', now: NOW });
  assert.equal(orders.length, 5);
});

await check('fetchOrdersRaw returns every well-formed entry, unfiltered', async () => {
  stubFetch(sample);
  assert.equal((await fetchOrdersRaw()).length, 14);
});

await check('unwrapped { orders } body is accepted', async () => {
  stubFetch({ orders: sample.data.orders });
  assert.equal((await fetchOrders({ now: NOW })).length, 3);
});

await check('malformed entries are reported, not filled with zero', async () => {
  const good = sample.data.orders[0];
  const bad = (edit) => {
    const x = structuredClone(good);
    edit(x);
    return x;
  };
  const body = {
    data: {
      orders: [
        good,
        bad((x) => delete x.order.price),
        bad((x) => (x.order.strikes = [2 ** 53 + 2])),
        bad((x) => (x.order.strikes = [2180.5])),
        bad((x) => (x.order.isCall = 'false')),
        bad((x) => (x.order.maker = '0x1234')),
        bad((x) => (x.order.strikes = [])),
        bad((x) => (x.signature = '')),
        bad((x) => (x.order.maxCollateralUsable = '-1')),
        'not an object',
      ],
    },
  };
  const { orders, malformed } = parseFeed(body);
  assert.equal(orders.length, 1);
  assert.deepEqual(malformed, [
    { index: 1, reason: 'missing price' },
    { index: 2, reason: 'strikes[0] is not an unsigned integer' },
    { index: 3, reason: 'strikes[0] is not an unsigned integer' },
    { index: 4, reason: 'isCall is not a boolean' },
    { index: 5, reason: 'maker is not an address' },
    { index: 6, reason: 'strikes is not a non-empty array' },
    { index: 7, reason: 'signature is not hex' },
    { index: 8, reason: 'maxCollateralUsable is not an unsigned integer' },
    { index: 9, reason: 'entry is not an object' },
  ]);
  const { warns, logger } = captureLogger();
  stubFetch(body);
  assert.equal((await fetchOrders({ logger, now: NOW })).length, 1);
  assert.equal(warns[0].meta.count, 9);
});

await check('absent extraOptionData defaults to 0x; bad hex is refused', async () => {
  const a = structuredClone(sample.data.orders[0]);
  delete a.order.extraOptionData;
  const b = structuredClone(sample.data.orders[0]);
  b.order.extraOptionData = 'zz';
  const { orders, malformed } = parseFeed({ orders: [a, b] });
  assert.equal(orders[0].order.extraOptionData, '0x');
  assert.deepEqual(malformed, [{ index: 1, reason: 'extraOptionData is not hex' }]);
});

await check('no orders list is an error, not an empty book', async () => {
  for (const body of [{}, { data: {} }, { data: { orders: 'x' } }, [], null]) {
    assert.throws(() => parseFeed(body), (e) => e instanceof OdetteError && e.code === 'FEED_INVALID');
  }
  stubFetch({ error: 'down' });
  await assert.rejects(fetchOrders(), (e) => e instanceof OdetteError && e.code === 'FEED_INVALID');
});

await check('HTTP failure is an error', async () => {
  stubFetch({}, { status: 503 });
  await assert.rejects(fetchOrders(), (e) => e instanceof OdetteError && e.code === 'HTTP_ERROR' && e.message === 'Order feed returned HTTP 503. Try again later, or set feedUrl.');
  stubFetch({}, { json: false });
  await assert.rejects(fetchOrders(), (e) => e instanceof OdetteError && e.code === 'FEED_INVALID');
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(fetchOrders(), (e) => e instanceof OdetteError && e.code === 'HTTP_ERROR');
});

console.log(`# feed-contract: ${passed} passed`);
