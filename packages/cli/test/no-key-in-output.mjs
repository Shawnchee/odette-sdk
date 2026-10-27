// Copyright (c) 2026 Thetanuts Finance. MIT License.
// No command prints the configured private key: not on stdout, not on stderr.

import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { runCli, tempDir, writeConfig } from './helpers/run-cli.mjs';

const dir = tempDir();
const wallet = Wallet.createRandom(); // generated per run, never printed
const key = wallet.privateKey;
const bare = key.slice(2).toLowerCase();
const cfg = writeConfig(dir, { version: 1, chainId: 8453, rpcUrl: 'https://mainnet.base.org', privateKey: key });
const PUT = ['--underlying', 'ETH', '--type', 'PUT', '--strike', '2180', '--expiry', '1793174400'];

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function assertNoKey(r, label) {
  const all = (r.stdout + r.stderr).toLowerCase();
  assert.ok(!all.includes(bare), `${label}: output contains the private key`);
}

const cases = [
  ['wallet show', ['--config', cfg, 'wallet', 'show'], {}],
  ['wallet show -o json', ['--config', cfg, '-o', 'json', 'wallet', 'show'], {}],
  ['config show', ['--config', cfg, 'config', 'show'], {}],
  ['fill --dry-run -o json', ['--config', cfg, '--dry-run', '-o', 'json', 'fill', ...PUT, '--collateral', '5'], {}],
  ['preview', ['--config', cfg, 'preview', ...PUT], {}],
  ['--private-key flag + failing check', ['--config', `${dir}/absent.json`, '--private-key', key, 'fill', ...PUT, '--collateral', '5'], { STUB_TAKER_USDC: '0' }],
  ['ODETTE_PRIVATE_KEY env + dry-run table', ['--config', `${dir}/absent.json`, '--dry-run', 'fill', ...PUT], { ODETTE_PRIVATE_KEY: key }],
];

for (const [label, args, env] of cases) {
  check(`${label}: no key in output`, () => {
    const r = runCli(args, { env });
    assert.notEqual(r.signal, 'SIGTERM', `${label}: timed out`);
    assertNoKey(r, label);
  });
}

check('wallet show reports the address, the source and the fixed referrer', () => {
  const r = runCli(['--config', cfg, '-o', 'json', 'wallet', 'show']);
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.address, wallet.address);
  assert.equal(j.source, 'config');
  assert.equal(j.referrer, '0x94D784e81A5c8cA6E19629C73217b61a256Ea1c7');
});

check('config show masks the key', () => {
  const r = runCli(['--config', cfg, '-o', 'json', 'config', 'show']);
  const j = JSON.parse(r.stdout);
  assert.equal(j.privateKey, `0x…${key.slice(-4)}`);
});

console.log(`# no-key-in-output: ${passed} passed`);
