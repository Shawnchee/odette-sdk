// Copyright (c) 2026 Thetanuts Finance. MIT License.
// A typed USDC amount is a spending cap. An order with a large size step must
// not round a small budget up to a large fill (security review, finding 1).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface } from 'ethers';
import { OdetteClient, OdetteError, OPTION_BOOK_ABI, OPTION_BOOK_R12, USDC, BUDGET_TOLERANCE_USDC, contractsForUsdc } from '../src/index.ts';
import { fakeChain, recordingSigner } from './helpers/fake-chain.mjs';

const NOW = 1793085599;
const sample = JSON.parse(readFileSync(new URL('./fixtures/feed-sample.json', import.meta.url), 'utf8'));
const TAKER = '0x1111111111111111111111111111111111111111';
const book = new Interface(OPTION_BOOK_ABI);

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

/** The recorded PUT with a strike of 5.00000001 USD: gcd with 1e8 is 1, so the step is 100 contracts. */
function craftedFeed() {
  const body = structuredClone(sample);
  const list = body.data.orders;
  const put = list.find((e) => e.order.isCall === false && e.order.strikes.length === 1);
  put.order.strikes = ['500000001'];
  put.order.price = '490000000'; // 4.90 USD per contract
  put.order.maxCollateralUsable = '5000000010'; // 1000 contracts
  body.data.orders = [put];
  return body;
}

async function setup(body) {
  const chain = fakeChain({ now: NOW });
  const signer = recordingSigner(chain.provider, TAKER);
  const client = new OdetteClient({ provider: chain.provider, signer, fetch: async () => ({ ok: true, status: 200, json: async () => structuredClone(body) }) });
  const orders = await client.api.fetchOrders(NOW);
  for (const o of orders) {
    chain.setAllowance(USDC.address, o.order.maker, OPTION_BOOK_R12, 10n ** 15n);
    chain.setBalance(USDC.address, o.order.maker, 10n ** 15n);
  }
  chain.setBalance(USDC.address, TAKER, 1000_000000n);
  chain.setAllowance(USDC.address, TAKER, OPTION_BOOK_R12, 1000_000000n);
  return { chain, signer, client, orders };
}

await check('the crafted order passes the whitelist (the probe is shaped like a real order)', async () => {
  const { orders } = await setup(craftedFeed());
  assert.equal(orders.length, 1);
  assert.equal(orders[0].product, 'PUT');
});

await check('a 5 USDC budget on a 100-contract step is refused, not rounded up to 490 USDC', async () => {
  const { client, orders } = await setup(craftedFeed());
  assert.throws(() => client.optionBook.previewFillOrder(orders[0], 5_000000n), (e) =>
    e instanceof OdetteError && e.code === 'INVALID_PARAMS' && /costs 490 USDC, above your 5 USDC amount/.test(e.message));
  assert.throws(() => client.optionBook.encodeFillOrder(orders[0], 5_000000n), /above your 5 USDC amount/);
});

await check('checkFill fails check 8 and fillOrder signs nothing', async () => {
  const { client, signer, orders } = await setup(craftedFeed());
  const checks = await client.optionBook.checkFill(orders[0], 5_000000n);
  const c8 = checks.find((c) => c.id === 8);
  assert.equal(c8.ok, false);
  assert.match(c8.message, /above your 5 USDC amount/);
  await assert.rejects(client.optionBook.fillOrder(orders[0], 5_000000n), (e) => e.code === 'CHECK_FAILED');
  assert.equal(signer.sent.length, 0);
});

await check('the same order fills when the budget covers one step (positive control, real encoder)', async () => {
  const { client, signer, orders } = await setup(craftedFeed());
  // recordingSigner records the tx, then refuses to broadcast it.
  await assert.rejects(client.optionBook.fillOrder(orders[0], 490_000000n), /not sent \(test\)/);
  assert.equal(signer.sent.length, 1);
  const [o] = book.decodeFunctionData('fillOrder', signer.sent[0].data);
  assert.equal(o.numContracts * o.price / 100_000000n, 490_000000n);
});

await check('a premium at budget + tolerance is accepted; one unit more is refused', async () => {
  const { client, orders } = await setup(craftedFeed());
  // Budget 489.99 USDC: nearest size is 100 contracts at 490 USDC = budget + 0.01.
  assert.equal(BUDGET_TOLERANCE_USDC, 10_000n);
  assert.equal(client.optionBook.previewFillOrder(orders[0], 489_990000n).totalCollateral, 490_000000n);
  // 489.989999 rounds to the same size, 0.010001 over: refused.
  assert.throws(() => client.optionBook.previewFillOrder(orders[0], 489_989999n), /above your/);
});

await check('honest recorded orders: no budget from 0.50 to 100 USDC is refused, and none overshoots by more than the tolerance', async () => {
  const { client, orders } = await setup(sample);
  for (const o of orders) {
    for (let b = 500_000n; b <= 100_000000n; b += 1_234_567n) {
      let p;
      try { p = client.optionBook.previewFillOrder(o, b); } catch (e) {
        assert.doesNotMatch(e.message, /above your/, `${o.ticker} at ${b}: ${e.message}`);
        continue;
      }
      assert.ok(p.totalCollateral <= b + BUDGET_TOLERANCE_USDC, `${o.ticker} at ${b}`);
    }
  }
});

await check('an honest order with a cents strike (step worth more than the tolerance) is never refused: the size steps down', async () => {
  // Fable review: a PUT at strike 67123.45 USD and 800 USD per contract has a step of
  // 20 units = 0.016 USDC. Rounding to nearest can pass the budget by more than 0.01.
  const body = structuredClone(sample);
  const put = body.data.orders.find((e) => e.order.isCall === false && e.order.strikes.length === 1);
  put.order.strikes = ['6712345000000'];
  put.order.price = '80000000000';
  put.order.maxCollateralUsable = '100000000000';
  body.data.orders = [put];
  const { client, orders } = await setup(body);
  assert.equal(orders.length, 1, 'probe order passes the whitelist');
  assert.equal(client.optionBook.previewFillOrder(orders[0], 100_000000n).step, 20n);
  let steppedDown = 0;
  for (let b = 12_000000n; b <= 60_000000n; b += 11_111n) {
    const p = client.optionBook.previewFillOrder(orders[0], b);
    assert.ok(p.totalCollateral <= b + BUDGET_TOLERANCE_USDC, `budget ${b}: premium ${p.totalCollateral}`);
    if (p.numContracts < contractsForUsdc(orders[0], b)) steppedDown += 1;
  }
  assert.ok(steppedDown > 0, 'probe: some budgets must need the step down, or this test proves nothing');
});

console.log(`# budget-cap: ${passed} passed`);
