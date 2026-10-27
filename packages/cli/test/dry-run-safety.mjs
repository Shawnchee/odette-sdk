// Copyright (c) 2026 Thetanuts Finance. MIT License.
// --dry-run never writes or deletes the config, even with --force.
// Regression for: `wallet create --force --dry-run` replaced the key,
// `wallet reset --force --dry-run` deleted the config, and
// `config unset privateKey --dry-run` removed the key (all copied from upstream).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { runCli, tempDir, writeConfig } from './helpers/run-cli.mjs';

const dir = tempDir();
const key = Wallet.createRandom().privateKey; // generated per run, never printed
const cfg = { version: 1, chainId: 8453, rpcUrl: 'https://mainnet.base.org', privateKey: key };

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const cases = [
  ['wallet create --force', ['wallet', 'create', '--force']],
  ['wallet create --force --reveal-key', ['wallet', 'create', '--force', '--reveal-key']],
  ['wallet reset --force', ['wallet', 'reset', '--force']],
  ['wallet import', ['wallet', 'import']],
  ['config unset privateKey', ['config', 'unset', 'privateKey']],
  ['config set rpcUrl', ['config', 'set', 'rpcUrl', 'https://example.org']],
  ['config set privateKey -', ['config', 'set', 'privateKey', '-']],
  ['setup', ['setup']],
];

for (const [label, args] of cases) {
  check(`--dry-run ${label}: exit 0, config byte-identical, key not printed`, () => {
    const p = writeConfig(dir, cfg, `${label.replace(/\W+/g, '-')}.json`);
    const before = readFileSync(p);
    const r = runCli(['--config', p, '--dry-run', ...args], { input: `${Wallet.createRandom().privateKey}\n` });
    assert.equal(r.code, 0, `${label}: ${r.stderr}`);
    assert.ok(existsSync(p), `${label}: config was deleted`);
    assert.deepEqual(readFileSync(p), before, `${label}: config changed`);
    assert.match(r.stderr, /Dry-run: .* Nothing was written\./);
    assert.ok(!(r.stdout + r.stderr).toLowerCase().includes(key.slice(2).toLowerCase()), `${label}: key printed`);
  });
}

check('--dry-run wallet create with no config creates no file', () => {
  const p = join(dir, 'never-created.json');
  const r = runCli(['--config', p, '--dry-run', 'wallet', 'create']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(existsSync(p), false);
});

check('without --dry-run, wallet create --force still works (the guard is dry-run only)', () => {
  const p = writeConfig(dir, cfg, 'real-create.json');
  const r = runCli(['--config', p, '-o', 'json', 'wallet', 'create', '--force']);
  assert.equal(r.code, 0, r.stderr);
  const saved = JSON.parse(readFileSync(p, 'utf8'));
  assert.notEqual(saved.privateKey, key);
});

console.log(`# dry-run-safety: ${passed} passed`);
