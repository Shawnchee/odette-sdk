// erc20.getDecimals returns a number, not the bigint ethers v6 decodes for uint8.
// A bigint here made client.utils.fromBigInt throw "Cannot mix BigInt and other types".

import assert from 'node:assert/strict';
import { OdetteClient, USDC } from '../src/index.ts';
import { fakeChain } from './helpers/fake-chain.mjs';

const fetchStub = async () => {
  throw new Error('erc20-decimals test: no feed fetch expected');
};

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const chain = fakeChain();
const client = new OdetteClient({ provider: chain.provider, fetch: fetchStub });

await check('getDecimals returns number 6, also from cache, and feeds fromBigInt', async () => {
  const decimals = await client.erc20.getDecimals(USDC.address);
  assert.equal(typeof decimals, 'number');
  assert.equal(decimals, 6);

  const callsBefore = chain.state.calls.length;
  const cached = await client.erc20.getDecimals(USDC.address);
  assert.equal(chain.state.calls.length, callsBefore, 'second call must come from the cache');
  assert.equal(typeof cached, 'number');
  assert.equal(cached, 6);

  assert.equal(client.utils.fromBigInt(1_500000n, decimals), '1.5');
});

console.log(`# erc20-decimals: ${passed} passed`);
