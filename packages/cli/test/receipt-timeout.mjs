// Copyright (c) 2026 Thetanuts Finance. MIT License.
// The optional ETH/USD lookup after a mined fill is bounded and aborted, so a
// stalled request cannot hide the receipt (a hidden receipt invites a retry).

import assert from 'node:assert/strict';
import { fetchEthUsdSafe } from '../src/output.ts';

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

await check('a lookup that never answers returns null within the timeout', async () => {
  const started = Date.now();
  const v = await fetchEthUsdSafe({ getMarketData: () => new Promise(() => {}) }, 200);
  assert.equal(v, null);
  assert.ok(Date.now() - started < 1_000, `took ${Date.now() - started} ms`);
});

await check('the request is aborted on timeout', async () => {
  let aborted = false;
  await fetchEthUsdSafe({
    getMarketData: ({ signal } = {}) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    }),
  }, 100);
  assert.equal(aborted, true);
});

await check('a prompt answer is used; a bad price or an error gives null', async () => {
  assert.equal(await fetchEthUsdSafe({ getMarketData: async () => ({ prices: { ETH: 3900.5 } }) }), 3900.5);
  assert.equal(await fetchEthUsdSafe({ getMarketData: async () => ({ prices: { ETH: 0 } }) }), null);
  assert.equal(await fetchEthUsdSafe({ getMarketData: async () => { throw new Error('down'); } }), null);
});

await check('the default timeout is 3 s', async () => {
  const { ETH_USD_TIMEOUT_MS } = await import('../src/output.ts');
  assert.equal(ETH_USD_TIMEOUT_MS, 3_000);
});

console.log(`# receipt-timeout: ${passed} passed`);
