// Copyright (c) 2026 Thetanuts Finance. MIT License.
// `odette fill` end to end on a stubbed Base: the signed transaction the CLI
// would broadcast is decoded (and refused by the stub). Also: re-quotes before
// send, approval amounts, buy-only wallet approve, missing signer.

import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { runCli, tempDir } from './helpers/run-cli.mjs';

const ODETTE = '0x94D784e81A5c8cA6E19629C73217b61a256Ea1c7';
const R12 = '0x1bDff855d6811728acaDC00989e79143a2bdfDed';
const dir = tempDir();
const key = Wallet.createRandom().privateKey; // generated per run, never printed
const noCfg = ['--config', join(dir, 'absent.json')];
const PUT = ['--underlying', 'ETH', '--type', 'PUT', '--strike', '2180', '--expiry', '1793174400'];
const funded = { ODETTE_PRIVATE_KEY: key, STUB_TAKER_ALLOWANCE: '1000000000' };
const sentFile = join(dir, 'sent.json');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
function sent() {
  return existsSync(sentFile) ? JSON.parse(readFileSync(sentFile, 'utf8')) : null;
}
function fillYes(env = {}, extra = []) {
  rmSync(sentFile, { force: true });
  return runCli([...noCfg, '--yes', 'fill', ...PUT, '--collateral', '5', ...extra], { env: { ...funded, STUB_SENT_FILE: sentFile, ...env } });
}

check('fill --yes signs a fillOrder to r12 with the Odette referrer (stub refuses the broadcast)', () => {
  const r = fillYes();
  assert.match(r.stderr, /sending is refused in tests/, r.stderr);
  const tx = sent();
  assert.ok(tx, 'no signed transaction reached the RPC');
  assert.equal(tx.to, R12);
  assert.equal(tx.referrer, ODETTE);
});

check('re-quote at a lower price before send: --yes proceeds at the new price', () => {
  const r = fillYes({ STUB_REQUOTE: 'down' });
  assert.match(r.stderr, /Odette re-quoted this order: price /);
  const tx = sent();
  assert.ok(tx, `did not reach send: ${r.stderr}`);
  assert.equal(tx.referrer, ODETTE);
  // Fixture ETH 2180 PUT price 228880710; the re-quote is 99% of it.
  assert.equal(tx.price, String((228880710n * 99n) / 100n));
});

check('re-quote at a higher price before send: --yes refuses (exit 3) and nothing is signed', () => {
  const r = fillYes({ STUB_REQUOTE: 'up' });
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /The price rose\. --yes does not accept a worse price/);
  assert.equal(sent(), null);
});

check('--approve-amount exact|max is accepted; a bad or too-small amount exits 2', () => {
  const env = { ODETTE_PRIVATE_KEY: key };
  assert.equal(runCli([...noCfg, '--dry-run', '-o', 'json', 'fill', ...PUT, '--collateral', '5', '--approve-amount', 'exact'], { env }).code, 0);
  assert.equal(runCli([...noCfg, '--dry-run', '-o', 'json', 'fill', ...PUT, '--collateral', '5', '--approve-amount', 'max'], { env }).code, 0);
  const small = runCli([...noCfg, '--dry-run', 'fill', ...PUT, '--collateral', '5', '--approve-amount', '1'], { env });
  assert.equal(small.code, 2, small.stderr);
  assert.match(small.stderr, /below this fill's premium/);
  assert.equal(runCli([...noCfg, '--dry-run', 'fill', ...PUT, '--collateral', '5', '--approve-amount', 'lots'], { env }).code, 2);
});

check('default approval with --collateral is the budget, not the floored premium', () => {
  const r = runCli([...noCfg, '--dry-run', '-o', 'json', 'fill', ...PUT, '--collateral', '5'], { env: { ODETTE_PRIVATE_KEY: key } });
  const j = JSON.parse(r.stdout);
  const amount = BigInt('0x' + j.approve.data.slice(-64));
  assert.equal(amount, 5_000000n);
  assert.ok(BigInt(j.preview.totalCollateral) <= amount);
});

check('wallet approve: no --spender, USDC only', () => {
  const env = { ODETTE_PRIVATE_KEY: key };
  assert.equal(runCli([...noCfg, 'wallet', 'approve', '--spender', '0x2222222222222222222222222222222222222222', '--amount', '1'], { env }).code, 2);
  const weth = runCli([...noCfg, 'wallet', 'approve', '--token', '0x4200000000000000000000000000000000000006', '--amount', '1'], { env });
  assert.equal(weth.code, 2, weth.stderr);
  const dry = runCli([...noCfg, '--dry-run', '-o', 'json', 'wallet', 'approve', '--amount', '1'], { env });
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, new RegExp(R12.slice(2).toLowerCase()));
});

check('fill without a key exits 4 (wallet error)', () => {
  const r = runCli([...noCfg, 'fill', ...PUT, '--collateral', '5']);
  assert.equal(r.code, 4, r.stderr);
});

check('fill --yes without --collateral is refused (exit 2): no unattended max-size buy', () => {
  rmSync(sentFile, { force: true });
  const r = runCli([...noCfg, '--yes', 'fill', ...PUT], { env: { ...funded, STUB_SENT_FILE: sentFile } });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /--yes needs --collateral/);
  assert.equal(sent(), null);
  // --dry-run without --collateral still previews the max size.
  assert.equal(runCli([...noCfg, '--dry-run', '-o', 'json', 'fill', ...PUT], { env: funded }).code, 0);
});

console.log(`# fill-flow: ${passed} passed`);
