// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Read commands on the recorded book: --type PUT|CALL|RANGER, product and
// underlying in JSON, RANGER preview with max payout, max-contracts, and the
// removed --private-key flag. Network is stubbed.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { runCli, tempDir } from './helpers/run-cli.mjs';

const dir = tempDir();
const noCfg = ['--config', join(dir, 'absent.json')];
const RANGER = ['--underlying', 'BTC', '--type', 'RANGER', '--strikes', '78500,79000,80000,80500', '--expiry', '1793174400'];

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
const json = (args) => {
  const r = runCli([...noCfg, '-o', 'json', ...args]);
  assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
  return JSON.parse(r.stdout);
};

check('orders: every row has product and underlying; all three products are listed', () => {
  const rows = json(['orders']);
  assert.ok(rows.length >= 3);
  assert.deepEqual([...new Set(rows.map((r) => r.product))].sort(), ['LINEAR_CALL', 'PUT', 'RANGER']);
  for (const r of rows) assert.ok(['ETH', 'BTC', 'SOL', 'XRP', 'BNB', 'AVAX', 'PAXG', 'DOGE'].includes(r.underlying), r.underlying);
});

check('orders --type RANGER lists RANGER only; CALL excludes RANGER; PUT is PUT only', () => {
  const ranger = json(['orders', '--type', 'RANGER']);
  assert.ok(ranger.length >= 1);
  assert.ok(ranger.every((r) => r.product === 'RANGER'));
  const calls = json(['orders', '--type', 'CALL']);
  assert.ok(calls.length >= 1 && calls.every((r) => r.product === 'LINEAR_CALL'));
  assert.deepEqual(json(['orders', '--type', 'LINEAR_CALL']), calls);
  assert.ok(json(['orders', '--type', 'PUT']).every((r) => r.product === 'PUT'));
});

check('orders --type with an unknown product exits 2', () => {
  const r = runCli([...noCfg, 'orders', '--type', 'FLY']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Expected PUT, CALL or RANGER/);
});

check('preview --type RANGER: exit 0, max payout is k per contract (not the 2k the maker posts)', () => {
  const p = json(['preview', ...RANGER, '--collateral', '5']);
  assert.equal(p.product, 'RANGER');
  // k = 500 USD: max payout = numContracts * 500 (6 dp); maker collateral = twice that.
  assert.equal(BigInt(p.maxPayout), (BigInt(p.numContracts) * 500_00000000n) / 100000000n);
  assert.equal(BigInt(p.makerCollateral), 2n * BigInt(p.maxPayout));
  assert.ok(BigInt(p.totalCollateral) <= 5_000000n);
});

check('preview table shows premium and maxPayout rows', () => {
  const r = runCli([...noCfg, 'preview', ...RANGER, '--collateral', '5']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /premium\s/);
  assert.match(r.stdout, /maxPayout\s/);
  assert.match(r.stdout, /BTC-28OCT26-78500\/79000\/80000\/80500-RANGER/);
});

check('--type RANGER needs four --strikes (exit 2)', () => {
  const r = runCli([...noCfg, 'preview', '--underlying', 'BTC', '--type', 'RANGER', '--strike', '79000', '--expiry', '1793174400']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /needs --strikes with 4 values/);
});

check('max-contracts on a RANGER: exit 0 and a positive size', () => {
  const m = json(['max-contracts', ...RANGER]);
  assert.ok(BigInt(m.maxContracts) > 0n);
});

check('--private-key is not a flag: exit 2 and the key is not echoed', () => {
  const key = Wallet.createRandom().privateKey; // generated per run, never printed
  const r = runCli([...noCfg, '--private-key', key, 'orders']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown option '--private-key'/);
  assert.ok(!(r.stdout + r.stderr).toLowerCase().includes(key.slice(2).toLowerCase()));
});

console.log(`# products: ${passed} passed`);
