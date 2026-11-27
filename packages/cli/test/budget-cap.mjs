// Copyright (c) 2026 Thetanuts Finance. MIT License.
// `odette --yes fill` against a crafted order whose size step is 100 contracts:
// --collateral 1 must not approve or fill 100 USDC (security review, finding 1).

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { runCli, tempDir } from './helpers/run-cli.mjs';

const dir = tempDir();
const key = Wallet.createRandom().privateKey; // generated per run, never printed
const noCfg = ['--config', join(dir, 'absent.json')];
const sentFile = join(dir, 'sent.json');
const ETH_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

// The recorded ETH PUT with strike 1.00000001 USD (step 100 contracts) at 1 USD per contract.
const body = JSON.parse(readFileSync(new URL('../../sdk/test/fixtures/feed-sample.json', import.meta.url), 'utf8'));
const put = body.data.orders.find((e) => e.order.isCall === false && e.order.strikes.length === 1 &&
  e.order.priceFeed.toLowerCase() === ETH_FEED.toLowerCase());
assert.ok(put, 'fixture has an ETH PUT');
put.order.strikes = ['100000001'];
put.order.price = '100000000';
put.order.maxCollateralUsable = '1000000000';
body.data.orders = [put];
const feedFile = join(dir, 'crafted-feed.json');
writeFileSync(feedFile, JSON.stringify(body));
const ARGS = ['fill', '--underlying', 'ETH', '--type', 'PUT', '--strike', '1.00000001', '--expiry', put.order.expiry];

function fill(collateral, allowance) {
  return runCli([...noCfg, '--yes', ...ARGS, '--collateral', collateral], {
    env: { ODETTE_PRIVATE_KEY: key, STUB_FEED_FILE: feedFile, STUB_TAKER_USDC: '1000000000', STUB_TAKER_ALLOWANCE: allowance, STUB_SENT_FILE: sentFile },
  });
}

check('--yes --collateral 1 is refused before any approve or fill', () => {
  const r = fill('1', '0');
  // Exit 2, as for an amount below the minimum: the --collateral value does not fit this order.
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /costs 100 USDC, above your 1 USDC amount/);
  assert.doesNotMatch(r.stderr, /Approv/);
  assert.equal(existsSync(sentFile), false);
});

check('the same order is matched and signed when the budget covers one step (positive control)', () => {
  const r = fill('100', '1000000000');
  assert.ok(existsSync(sentFile), r.stderr);
  const tx = JSON.parse(readFileSync(sentFile, 'utf8'));
  assert.equal(tx.numContracts, '100000000');
  assert.equal(tx.price, '100000000');
});

console.log(`# budget-cap (cli): ${passed} passed`);
