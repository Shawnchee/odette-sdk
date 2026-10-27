// Copyright (c) 2026 Thetanuts Finance. MIT License.
// The referrer in fillOrder calldata is ODETTE_REFERRER, decoded by the REAL
// ethers Interface — once with the SDK's ABI, once with an independent
// hand-written signature — and on the transaction fillOrder actually builds.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface, ZeroAddress } from 'ethers';
import { OdetteClient, ODETTE_REFERRER, OPTION_BOOK_ABI, OPTION_BOOK_R12, USDC, contractsForUsdc } from '../src/index.ts';
import { fakeChain, recordingSigner } from './helpers/fake-chain.mjs';

const NOW = 1793085599; // feed recorded 2026-10-27T07:19:59Z
const sample = JSON.parse(readFileSync(new URL('./fixtures/feed-sample.json', import.meta.url), 'utf8'));

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const fetchStub = async () => ({ ok: true, status: 200, json: async () => structuredClone(sample) });
const chain = fakeChain({ now: NOW });
const client = new OdetteClient({ provider: chain.provider, fetch: fetchStub });
const orders = await client.api.fetchOrders(NOW);

// Independent of the copied ABI: the r12 fillOrder signature written out by hand.
const HAND = new Interface([
  'function fillOrder((address maker,uint256 orderExpiryTimestamp,address collateral,bool isCall,address priceFeed,address implementation,bool isLong,uint256 maxCollateralUsable,uint256[] strikes,uint256 expiry,uint256 price,uint256 numContracts,bytes extraOptionData) order, bytes signature, address referrer) returns (address)',
]);

await check('fixture gives PUT, LINEAR_CALL and RANGER orders', async () => {
  assert.deepEqual(orders.map((o) => o.product).sort(), ['LINEAR_CALL', 'PUT', 'RANGER']);
});

await check('encodeFillOrder: SDK ABI decodes referrer = ODETTE_REFERRER for every product', async () => {
  const iface = new Interface(OPTION_BOOK_ABI);
  for (const o of orders) {
    const { to, data } = client.optionBook.encodeFillOrder(o, 25_000000n);
    assert.equal(to, OPTION_BOOK_R12);
    const args = iface.decodeFunctionData('fillOrder', data);
    assert.equal(args[2], ODETTE_REFERRER);
    assert.notEqual(args[2], ZeroAddress);
    assert.equal(args[1], o.signature);
    assert.equal(args[0].numContracts, contractsForUsdc(o, 25_000000n));
  }
});

await check('encodeFillOrder: hand-written signature gives selector 0xa4761ec1 and the same referrer', async () => {
  for (const o of orders) {
    const { data } = client.optionBook.encodeFillOrder(o);
    assert.equal(data.slice(0, 10), '0xa4761ec1');
    const args = HAND.decodeFunctionData('fillOrder', data);
    assert.equal(args.referrer, ODETTE_REFERRER);
    // Signed fields reach calldata unchanged.
    assert.equal(args.order.maker, o.order.maker);
    assert.equal(args.order.implementation, o.rawApiData.implementation);
    assert.equal(args.order.collateral, USDC.address);
    assert.deepEqual(args.order.strikes.map(String), o.rawApiData.strikes);
    assert.equal(args.order.price, o.order.price);
    assert.equal(args.order.expiry, o.order.expiry);
    assert.equal(args.order.maxCollateralUsable, BigInt(o.rawApiData.maxCollateralUsable));
    assert.equal(args.order.isLong, false);
  }
});

await check('the transaction fillOrder sends carries ODETTE_REFERRER (real Contract encoder)', async () => {
  const signer = recordingSigner(chain.provider);
  const o = orders.find((x) => x.product === 'PUT');
  const premium = 25_000000n;
  chain.setBalance(USDC.address, await signer.getAddress(), 1_000_000000n);
  chain.setAllowance(USDC.address, await signer.getAddress(), OPTION_BOOK_R12, 1_000_000000n);
  chain.setBalance(USDC.address, o.order.maker, 1_000_000_000000n);
  chain.setAllowance(USDC.address, o.order.maker, OPTION_BOOK_R12, 1_000_000_000000n);
  const live = new OdetteClient({ provider: chain.provider, signer, fetch: fetchStub });
  await assert.rejects(live.optionBook.fillOrder(o, premium), /not sent \(test\)/);
  assert.equal(signer.sent.length, 1);
  const tx = signer.sent[0];
  assert.equal(tx.to.toLowerCase(), OPTION_BOOK_R12.toLowerCase());
  assert.equal(HAND.decodeFunctionData('fillOrder', tx.data).referrer, ODETTE_REFERRER);
  assert.equal(tx.data, live.optionBook.encodeFillOrder(o, premium).data);
  // gas limit = estimate x 1.2
  assert.equal(tx.gasLimit, (400_000n * 120n) / 100n);
});

await check('preview reports the referrer constant and the real premium', async () => {
  const o = orders[0];
  const p = client.optionBook.previewFillOrder(o, 25_000000n);
  assert.equal(p.referrer, ODETTE_REFERRER);
  assert.ok(p.totalCollateral <= 25_000000n);
  assert.equal(p.totalCollateral, (o.order.price * p.numContracts) / 100000000n);
});

console.log(`# referrer-calldata: ${passed} passed`);
