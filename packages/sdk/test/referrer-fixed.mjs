// Copyright (c) 2026 Thetanuts Finance. MIT License.
// No option, env var or assignment changes the referrer, and it is never zero.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface, ZeroAddress } from 'ethers';
import * as sdk from '../src/index.ts';
import { fakeChain } from './helpers/fake-chain.mjs';

const { OdetteClient, ODETTE_REFERRER, OPTION_BOOK_ABI, OdetteError } = sdk;
const NOW = 1793085599;
const sample = JSON.parse(readFileSync(new URL('./fixtures/feed-sample.json', import.meta.url), 'utf8'));
const fetchStub = async () => ({ ok: true, status: 200, json: async () => structuredClone(sample) });

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const { provider } = fakeChain({ now: NOW });

await check('the constant is the PRD address and not zero', async () => {
  assert.equal(ODETTE_REFERRER, '0x94D784e81A5c8cA6E19629C73217b61a256Ea1c7');
  assert.notEqual(ODETTE_REFERRER.toLowerCase(), ZeroAddress);
});

await check('client.referrer is the constant with every config path empty', async () => {
  const c = new OdetteClient({ provider });
  assert.equal(c.referrer, ODETTE_REFERRER);
});

await check('a referrer option is refused', async () => {
  for (const referrer of ['0x2222222222222222222222222222222222222222', ZeroAddress, undefined]) {
    assert.throws(
      () => new OdetteClient({ provider, referrer }),
      (e) => e instanceof OdetteError && e.code === 'INVALID_PARAMS' && /fixed referrer/.test(e.message)
    );
  }
});

await check('client.referrer cannot be reassigned', async () => {
  const c = new OdetteClient({ provider });
  assert.throws(() => { c.referrer = '0x2222222222222222222222222222222222222222'; }, TypeError);
  assert.equal(c.referrer, ODETTE_REFERRER);
});

await check('ODETTE_REFERRER and THETANUTS_REFERRER env vars change nothing', async () => {
  process.env.ODETTE_REFERRER = '0x2222222222222222222222222222222222222222';
  process.env.THETANUTS_REFERRER = '0x3333333333333333333333333333333333333333';
  try {
    const c = new OdetteClient({ provider, fetch: fetchStub });
    const [o] = await c.api.fetchOrders(NOW);
    const args = new Interface(OPTION_BOOK_ABI).decodeFunctionData('fillOrder', c.optionBook.encodeFillOrder(o).data);
    assert.equal(args[2], ODETTE_REFERRER);
  } finally {
    delete process.env.ODETTE_REFERRER;
    delete process.env.THETANUTS_REFERRER;
  }
});

await check('extra arguments to encode / preview / fill are not a referrer path', async () => {
  const c = new OdetteClient({ provider, fetch: fetchStub });
  const [o] = await c.api.fetchOrders(NOW);
  const other = '0x2222222222222222222222222222222222222222';
  const enc = c.optionBook.encodeFillOrder(o, undefined, other);
  assert.equal(new Interface(OPTION_BOOK_ABI).decodeFunctionData('fillOrder', enc.data)[2], ODETTE_REFERRER);
  assert.equal(c.optionBook.previewFillOrder(o, undefined, other).referrer, ODETTE_REFERRER);
  assert.equal(c.optionBook.encodeFillOrder.length, 2);
  assert.equal(c.optionBook.fillOrder.length, 2);
});

await check('the SDK exports no setter or override for the referrer', async () => {
  const names = Object.keys(sdk).filter((k) => /referr/i.test(k));
  assert.deepEqual(names, ['ODETTE_REFERRER']);
});

console.log(`# referrer-fixed: ${passed} passed`);
