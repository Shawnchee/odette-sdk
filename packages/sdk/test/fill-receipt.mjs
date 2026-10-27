// Copyright (c) 2026 Thetanuts Finance. MIT License.
// fillOrder after broadcast, on a fake Base: onSent before the receipt, the
// referrer recorded in OrderFilled, the mismatch log, and the gas bound.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface } from 'ethers';
import { OdetteClient, OdetteError, ODETTE_REFERRER, OPTION_BOOK_ABI, OPTION_BOOK_R12, USDC } from '../src/index.ts';
import { fakeChain, minedSigner } from './helpers/fake-chain.mjs';

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

/** Everything funded; the signer's send resolves and the receipt is mined. */
async function setup({ chain: over = {}, signer: sOpts = {} } = {}) {
  const chain = fakeChain({ now: NOW, ...over });
  const events = [];
  const errors = [];
  const signer = minedSigner(chain.provider, TAKER, { events, ...sOpts });
  const logger = { error: (msg, meta) => errors.push({ msg, meta }) };
  const client = new OdetteClient({ provider: chain.provider, signer, fetch: fetchStub, logger });
  const orders = await client.api.fetchOrders(NOW);
  for (const o of orders) {
    chain.setAllowance(USDC.address, o.order.maker, OPTION_BOOK_R12, 1_000_000_000000n);
    chain.setBalance(USDC.address, o.order.maker, 1_000_000_000000n);
  }
  chain.setBalance(USDC.address, TAKER, 100_000000n);
  chain.setAllowance(USDC.address, TAKER, OPTION_BOOK_R12, 100_000000n);
  return { signer, client, events, errors, put: orders.find((o) => o.product === 'PUT') };
}

await check('fillOrder resolves the receipt; OrderFilled records ODETTE_REFERRER', async () => {
  const { signer, client, errors, put } = await setup();
  const receipt = await client.optionBook.fillOrder(put, 25_000000n);
  assert.equal(receipt.status, 1);
  assert.equal(signer.sent.length, 1);
  assert.equal(new Interface(OPTION_BOOK_ABI).decodeFunctionData('fillOrder', signer.sent[0].data)[2], ODETTE_REFERRER);
  const filled = client.optionBook.decodeOrderFilled(receipt, OPTION_BOOK_R12);
  assert.ok(filled, 'no OrderFilled event decoded');
  assert.equal(filled.referrer, ODETTE_REFERRER);
  assert.deepEqual(errors, []);
});

await check('onSent gets the hash before wait() resolves', async () => {
  const { client, events, put } = await setup();
  const receipt = await client.optionBook.fillOrder(put, 25_000000n, { onSent: (h) => events.push(`sent:${h}`) });
  assert.deepEqual(events, [`sent:${receipt.hash}`, 'mined']);
});

await check('a receipt with another referrer logs "Referrer mismatch"', async () => {
  const other = '0x2222222222222222222222222222222222222222';
  const { client, errors, put } = await setup({ signer: { referrer: other } });
  const receipt = await client.optionBook.fillOrder(put, 25_000000n);
  assert.equal(client.optionBook.decodeOrderFilled(receipt, OPTION_BOOK_R12).referrer, other);
  assert.equal(errors.length, 1);
  assert.match(errors[0].msg, /^Referrer mismatch in OrderFilled/);
  assert.equal(errors[0].meta.recorded, other);
});

await check('gas 2,000,001 rejects with CHECK_FAILED and sends nothing', async () => {
  const { signer, client, put } = await setup({ chain: { gas: 2_000_001n } });
  await assert.rejects(
    client.optionBook.fillOrder(put, 25_000000n),
    (e) => e instanceof OdetteError && e.code === 'CHECK_FAILED' && /Gas estimate 2000001 is above the 2000000 limit/.test(e.message)
  );
  assert.equal(signer.sent.length, 0);
});

console.log(`# fill-receipt: ${passed} passed`);
