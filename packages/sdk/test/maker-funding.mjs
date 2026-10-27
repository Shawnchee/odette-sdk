// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Maker funding is MIN(allowance, balanceOf) (review lesson L-024), and the
// order nonce's remaining capacity caps it too.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OdetteClient, OPTION_BOOK_R12, USDC } from '../src/index.ts';
import { fakeChain } from './helpers/fake-chain.mjs';

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

async function setup({ makerAllowance, makerBalance, amountFilled = 0n }) {
  const chain = fakeChain({ now: NOW, amountFilled });
  const client = new OdetteClient({ provider: chain.provider, fetch: fetchStub });
  const order = (await client.api.fetchOrders(NOW)).find((o) => o.product === 'PUT');
  chain.setAllowance(USDC.address, order.order.maker, OPTION_BOOK_R12, makerAllowance);
  chain.setBalance(USDC.address, order.order.maker, makerBalance);
  chain.setBalance(USDC.address, TAKER, 10_000_000000n);
  chain.setAllowance(USDC.address, TAKER, OPTION_BOOK_R12, 10_000_000000n);
  return { chain, client, order };
}

const maker = (checks) => checks.find((c) => c.id === 10);

await check('L-024: allowance 27,641 USDC, balance 53 USDC -> fundable 53', async () => {
  const { client, order } = await setup({ makerAllowance: 27_641_000000n, makerBalance: 53_000000n });
  const f = await client.optionBook.getMakerFundable(order);
  assert.equal(f.fundable, 53_000000n);
  assert.equal(f.allowance, 27_641_000000n);
  assert.equal(f.balance, 53_000000n);
});

await check('allowance below balance -> fundable is the allowance', async () => {
  const { client, order } = await setup({ makerAllowance: 7_000000n, makerBalance: 900_000000n });
  assert.equal((await client.optionBook.getMakerFundable(order)).fundable, 7_000000n);
});

await check('check 10 fails when the fill needs more than the maker can fund', async () => {
  // ETH 2180 PUT: maker posts 2180 USDC per contract. Max fill needs far more than 53 USDC.
  const { client, order } = await setup({ makerAllowance: 27_641_000000n, makerBalance: 53_000000n });
  const c = maker(await client.optionBook.checkFill(order, undefined, { taker: TAKER, simulate: false }));
  assert.equal(c.ok, false);
  assert.match(c.message, /^Maker cannot fund this size\. Maker can cover 53 USDC; this fill needs [0-9.]+ USDC\.$/);
});

await check('check 10 passes for a size the maker covers', async () => {
  // 1 USDC premium at ~$2.29/contract = ~0.44 contracts -> ~950 USDC collateral. The maker has 10,000.
  const { client, order } = await setup({ makerAllowance: 10_000_000000n, makerBalance: 10_000_000000n });
  const c = maker(await client.optionBook.checkFill(order, 1_000000n, { taker: TAKER, simulate: false }));
  assert.equal(c.ok, true, c.message);
});

await check('amount already filled on the nonce caps the fill', async () => {
  // maxCollateralUsable is 10,000 USDC; 9,999 already used leaves 1 USDC of room.
  const { client, order } = await setup({ makerAllowance: 10_000_000000n, makerBalance: 10_000_000000n, amountFilled: 9_999_000000n });
  assert.equal(await client.optionBook.getRemainingCollateral(order), 1_000000n);
  const c = maker(await client.optionBook.checkFill(order, 1_000000n, { taker: TAKER, simulate: false }));
  assert.equal(c.ok, false);
  assert.match(c.message, /Maker can cover 1 USDC/);
});

console.log(`# maker-funding: ${passed} passed`);
