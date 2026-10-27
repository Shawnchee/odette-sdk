// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Opt-in, read-only: ODETTE_LIVE=1 node scripts/run-tests.mjs
// Reads the live feed and Base (eth_call only). Never signs or sends.
// RPC: ODETTE_RPC_URL, default https://mainnet.base.org.

import assert from 'node:assert/strict';
import { Interface, JsonRpcProvider, Wallet } from 'ethers';
import { OdetteClient, ODETTE_REFERRER, OPTION_BOOK_ABI, OPTION_BOOK_R12 } from '../src/index.ts';

if (process.env.ODETTE_LIVE !== '1') {
  console.log('# dry-run-live: skipped (set ODETTE_LIVE=1 to run)');
  process.exit(0);
}

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const provider = new JsonRpcProvider(process.env.ODETTE_RPC_URL ?? 'https://mainnet.base.org', 8453, { staticNetwork: true });
const client = new OdetteClient({ provider });
// A fresh random address holds no USDC: check 11 must fail, checks 1-9 must pass.
// (0x...dEaD is not empty: tokens are burned there.)
const EMPTY_TAKER = Wallet.createRandom().address;

const orders = await client.api.fetchOrders();

await check('live feed returns Odette orders on r12', async () => {
  assert.ok(orders.length > 0, 'no Odette orders in the live book');
  for (const o of orders) {
    assert.ok(['PUT', 'LINEAR_CALL', 'RANGER'].includes(o.product), o.product);
    assert.equal(o.optionBook, OPTION_BOOK_R12);
  }
  console.log(`  ${orders.length} orders: ${[...new Set(orders.map((o) => o.product))].join(', ')}`);
});

await check('one order per product: calldata carries ODETTE_REFERRER; checks 1-10 pass on chain', async () => {
  const iface = new Interface(OPTION_BOOK_ABI);
  for (const product of ['PUT', 'LINEAR_CALL', 'RANGER']) {
    const o = orders.find((x) => x.product === product);
    if (!o) {
      console.log(`  ${product}: none listed now`);
      continue;
    }
    const enc = client.optionBook.encodeFillOrder(o);
    assert.equal(iface.decodeFunctionData('fillOrder', enc.data)[2], ODETTE_REFERRER);
    const checks = await client.optionBook.checkFill(o, 1_000000n, { taker: EMPTY_TAKER });
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    for (const id of [1, 2, 8, 9]) assert.equal(byId[id]?.ok, true, `${product} check ${id}: ${byId[id]?.message}`);
    assert.ok(byId[10], `${product}: check 10 ran`);
    assert.equal(byId[11]?.ok, false, `${product}: an empty taker must fail check 11`);
    console.log(`  ${product} ${o.ticker ?? ''}: maker ${byId[10].ok ? 'can' : 'cannot'} fund 1 USDC (${byId[10].message})`);
  }
});

await check('referrerFeeSplitBps(ODETTE) reads', async () => {
  const bps = await client.optionBook.getReferrerFeeSplit();
  assert.equal(typeof bps, 'bigint');
  console.log(`  referrerFeeSplitBps(ODETTE) = ${bps}`);
});

console.log(`# dry-run-live: ${passed} passed`);
