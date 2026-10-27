// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Pre-send checks (PRD section 9) on a fake Base, and fillOrder refusing to send.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OdetteClient, OdetteError, OPTION_BOOK_R12, USDC } from '../src/index.ts';
import { fakeChain, recordingSigner } from './helpers/fake-chain.mjs';

const NOW = 1793085599;
const sample = JSON.parse(readFileSync(new URL('./fixtures/feed-sample.json', import.meta.url), 'utf8'));
const fetchStub = async () => ({ ok: true, status: 200, json: async () => structuredClone(sample) });
const TAKER = '0x1111111111111111111111111111111111111111';

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

/** Everything funded. Tests break one thing at a time. */
async function setup(over = {}) {
  const chain = fakeChain({ now: NOW, ...over });
  const signer = recordingSigner(chain.provider, TAKER);
  const client = new OdetteClient({ provider: chain.provider, signer, fetch: fetchStub });
  const orders = await client.api.fetchOrders(NOW);
  for (const o of orders) {
    chain.setAllowance(USDC.address, o.order.maker, OPTION_BOOK_R12, 1_000_000_000000n);
    chain.setBalance(USDC.address, o.order.maker, 1_000_000_000000n);
  }
  chain.setBalance(USDC.address, TAKER, 100_000000n);
  chain.setAllowance(USDC.address, TAKER, OPTION_BOOK_R12, 100_000000n);
  return { chain, signer, client, orders, put: orders.find((o) => o.product === 'PUT') };
}

const byId = (checks, id) => checks.find((c) => c.id === id);
const failed = (checks) => checks.filter((c) => !c.ok).map((c) => c.id);

await check('all checks pass for a funded 25 USDC fill on every product', async () => {
  const { client, orders } = await setup();
  for (const o of orders) {
    const checks = await client.optionBook.checkFill(o, 25_000000n);
    assert.deepEqual(failed(checks), [], `${o.ticker}: ${JSON.stringify(checks)}`);
    assert.deepEqual(checks.map((c) => c.id), [1, 2, 8, 9, 10, 11, 12, 13]);
  }
});

await check('1: wrong chain stops at check 1', async () => {
  const { client, put } = await setup({ chainId: 1n });
  const checks = await client.optionBook.checkFill(put, 25_000000n);
  assert.deepEqual(checks, [{ id: 1, name: 'chain', ok: false, message: 'Wrong chain. Connect to Base (8453).' }]);
});

await check('2: an order past its quote expiry by chain time fails', async () => {
  const { client, put } = await setup({ now: Number(put0().rawApiData.orderExpiryTimestamp) });
  const c = byId(await client.optionBook.checkFill(put, 25_000000n), 2);
  assert.equal(c.ok, false);
  assert.equal(c.message, 'Order has expired. Fetch orders again.');
});

await check('8: a budget under the 0.50 USDC minimum fails with the smallest cost', async () => {
  const { client, put } = await setup();
  const c = byId(await client.optionBook.checkFill(put, 100000n), 8);
  assert.equal(c.ok, false);
  assert.match(c.message, /^0\.1 USDC is below the minimum\. The smallest fill costs 0\.5\d* USDC\.$/);
});

await check('11: taker balance below the premium fails', async () => {
  const { chain, client, put } = await setup();
  chain.setBalance(USDC.address, TAKER, 3_000000n);
  const c = byId(await client.optionBook.checkFill(put, 25_000000n), 11);
  assert.equal(c.ok, false);
  assert.match(c.message, /^Your USDC balance is 3 USDC\. This fill needs [0-9.]+ USDC\.$/);
});

await check('12: allowance below the premium fails; simulate is skipped', async () => {
  const { chain, client, put } = await setup();
  chain.setAllowance(USDC.address, TAKER, OPTION_BOOK_R12, 0n);
  const checks = await client.optionBook.checkFill(put, 25_000000n);
  assert.equal(byId(checks, 12).ok, false);
  assert.match(byId(checks, 12).message, /^USDC approval is 0 USDC\. Approve at least [0-9.]+ USDC first\.$/);
  assert.equal(byId(checks, 13), undefined);
});

await check('13: gas above 2,000,000 and a reverting simulation both fail', async () => {
  const hi = await setup({ gas: 2_000_001n });
  assert.equal(byId(await hi.client.optionBook.checkFill(hi.put, 25_000000n), 13).message, 'Gas estimate 2000001 is above the 2000000 limit.');
  const rev = await setup({ gas: new Error('execution reverted: InvalidNumContracts') });
  const c = byId(await rev.client.optionBook.checkFill(rev.put, 25_000000n), 13);
  assert.equal(c.ok, false);
  assert.match(c.message, /^Simulation failed: /);
});

await check('fillOrder sends nothing when a check fails', async () => {
  const { chain, signer, client, put } = await setup();
  chain.setBalance(USDC.address, TAKER, 0n);
  await assert.rejects(
    client.optionBook.fillOrder(put, 25_000000n),
    (e) => e instanceof OdetteError && e.code === 'CHECK_FAILED' && /Your USDC balance is 0 USDC/.test(e.message)
  );
  assert.equal(signer.sent.length, 0);
});

await check('fillOrder without a signer throws SIGNER_REQUIRED before any read', async () => {
  const chain = fakeChain({ now: NOW });
  const client = new OdetteClient({ provider: chain.provider, fetch: fetchStub });
  const [o] = await client.api.fetchOrders(NOW);
  await assert.rejects(client.optionBook.fillOrder(o), (e) => e.code === 'SIGNER_REQUIRED');
  assert.equal(chain.state.calls.length, 0);
});

await check('a hidden spread order is refused at check 2 even if passed in by hand', async () => {
  const on = new OdetteClient({ provider: fakeChain({ now: NOW }).provider, fetch: fetchStub, enableSpreads: true });
  const spread = (await on.api.fetchOrders(NOW)).find((o) => o.product === 'CALL_SPREAD');
  const { client } = await setup();
  const c = byId(await client.optionBook.checkFill(spread, 25_000000n, { taker: TAKER }), 2);
  assert.equal(c.ok, false);
  assert.match(c.message, /^Order type is not supported by Odette/);
});

await check('a hidden spread cannot be previewed, encoded or sized on a default client', async () => {
  const on = new OdetteClient({ provider: fakeChain({ now: NOW }).provider, fetch: fetchStub, enableSpreads: true });
  const spread = (await on.api.fetchOrders(NOW)).find((o) => o.product === 'CALL_SPREAD');
  const { client } = await setup();
  for (const call of [
    () => client.optionBook.previewFillOrder(spread),
    () => client.optionBook.encodeFillOrder(spread, 25_000000n),
    () => client.optionBook.calculateMaxContracts(spread),
  ]) {
    assert.throws(call, (e) => e instanceof OdetteError && e.code === 'INVALID_ORDER' && /not supported by Odette/.test(e.message));
  }
  await assert.rejects(client.optionBook.fillOrder(spread), (e) => e.code === 'INVALID_ORDER');
});

await check('caller labels are ignored: a RANGER labelled PUT is sized as a RANGER', async () => {
  const { client, orders } = await setup();
  const ranger = orders.find((o) => o.product === 'RANGER');
  const lie = { ...ranger, product: 'PUT', underlying: 'ETH' };
  assert.deepEqual(client.optionBook.previewFillOrder(lie), client.optionBook.previewFillOrder(ranger));
  assert.equal(client.optionBook.previewFillOrder(lie).product, 'RANGER');
  const checks = await client.optionBook.checkFill(lie, 25_000000n);
  assert.equal(checks.find((c) => c.id === 2).message, 'RANGER BTC');
});

await check('an unreachable RPC is reported as such, not as a wrong chain', async () => {
  const { client, put, chain } = await setup();
  chain.provider.getNetwork = async () => { throw new Error('connect ECONNREFUSED'); };
  const [c] = await client.optionBook.checkFill(put, 25_000000n);
  assert.equal(c.ok, false);
  assert.match(c.message, /^Could not reach the RPC: connect ECONNREFUSED\. Check the RPC URL\.$/);
});

function put0() {
  return sample.data.orders.map((e) => ({ rawApiData: { orderExpiryTimestamp: e.order.orderExpiryTimestamp }, impl: e.order.implementation }))
    .find((x) => x.impl === '0x7355EB92dfb0503DB558a70c10843618932ab290');
}

console.log(`# fill-checks: ${passed} passed`);
