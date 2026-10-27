// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Exit codes (PRD 7.2): 0 ok / dry-run, 1 runtime or failed check, 2 usage,
// 3 confirmation refused, 4 config or wallet. Pattern from thetanuts-sdk
// cli/tests/exitCodes.test.ts. Network is stubbed; nothing is sent.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Interface, Wallet } from 'ethers';
import { runCli, tempDir, writeConfig } from './helpers/run-cli.mjs';

const ODETTE = '0x94D784e81A5c8cA6E19629C73217b61a256Ea1c7';
const dir = tempDir();
const key = Wallet.createRandom().privateKey; // generated per run, never printed
const noCfg = ['--config', `${dir}/absent.json`];
const PUT = ['--underlying', 'ETH', '--type', 'PUT', '--strike', '2180', '--expiry', '1793174400'];

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

check('--help exits 0', () => {
  assert.equal(runCli(['--help']).code, 0);
});

check('unknown flag exits 2', () => {
  assert.equal(runCli(['--bogus']).code, 2);
});

check('--referrer is not a flag: exits 2', () => {
  const r = runCli([...noCfg, '--referrer', '0x2222222222222222222222222222222222222222', 'orders']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown option '--referrer'/);
});

check('--chain is not a flag: exits 2', () => {
  assert.equal(runCli([...noCfg, '--chain', 'base', 'orders']).code, 2);
});

check('config set referrer exits 2 and names the fixed address', () => {
  const r = runCli([...noCfg, 'config', 'set', 'referrer', '0x2222222222222222222222222222222222222222']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, new RegExp(`fixed \\(${ODETTE}\\)`));
});

check('a config file with a referrer key exits 4', () => {
  const p = writeConfig(dir, { version: 1, chainId: 8453, rpcUrl: 'https://mainnet.base.org', referrer: '0x2222222222222222222222222222222222222222' }, 'ref.json');
  for (const cmd of [['orders'], ['wallet', 'show'], ['config', 'show']]) {
    const r = runCli(['--config', p, ...cmd]);
    assert.equal(r.code, 4, `${cmd.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /has a "referrer" key\. The Odette referrer is fixed/);
  }
});

check('a config file for another chain exits 4', () => {
  const p = writeConfig(dir, { version: 1, chainId: 1, rpcUrl: 'https://mainnet.base.org' }, 'chain1.json');
  assert.equal(runCli(['--config', p, 'orders']).code, 4);
});

check('fill with an incomplete selector exits 2', () => {
  const r = runCli([...noCfg, 'fill', '--underlying', 'ETH'], { env: { ODETTE_PRIVATE_KEY: key } });
  assert.equal(r.code, 2, r.stderr);
});

check('check --direction sell exits 2 (buy only)', () => {
  assert.equal(runCli([...noCfg, 'check', ...PUT, '--direction', 'sell']).code, 2);
});

check('fill --dry-run -o json: exit 0, one JSON object, Odette referrer in calldata, no prompt', () => {
  const r = runCli([...noCfg, '--dry-run', '-o', 'json', 'fill', ...PUT, '--collateral', '5'], { env: { ODETTE_PRIVATE_KEY: key } });
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.dryRun, true);
  assert.equal(j.referrer, ODETTE);
  assert.ok(j.approve && j.fill && Array.isArray(j.checks));
  const hand = new Interface(['function fillOrder((address,uint256,address,bool,address,address,bool,uint256,uint256[],uint256,uint256,uint256,bytes),bytes,address)']);
  assert.equal(hand.decodeFunctionData('fillOrder', j.fill.data)[2], ODETTE);
  assert.doesNotMatch(r.stderr, /Proceed|Approve .*\?/);
});

check('a failed pre-send check exits 1 before any prompt', () => {
  // Taker has 1 USDC; a 5 USDC fill fails check 11.
  const r = runCli([...noCfg, 'fill', ...PUT, '--collateral', '5'], { env: { ODETTE_PRIVATE_KEY: key, STUB_TAKER_USDC: '1000000' } });
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /Your USDC balance is 1 USDC/);
  assert.doesNotMatch(r.stdout + r.stderr, /Proceed with fill/);
});

check('approval refused on a non-TTY without --yes exits 3', () => {
  // Funded taker, zero allowance: the approve prompt is reached and refused.
  const r = runCli([...noCfg, 'fill', ...PUT, '--collateral', '5'], { env: { ODETTE_PRIVATE_KEY: key } });
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /Refusing to prompt for confirmation on a non-TTY stdin/);
});

check('wallet approve without --yes on a non-TTY exits 3', () => {
  const r = runCli([...noCfg, 'wallet', 'approve', '--token', 'USDC', '--for', 'optionBook', '--amount', '1'], { env: { ODETTE_PRIVATE_KEY: key } });
  assert.equal(r.code, 3, r.stderr);
});

check('-o bogus exits 2 and lists the allowed formats; -o json still exits 0', () => {
  const bad = runCli([...noCfg, '-o', 'bogus', 'orders']);
  assert.equal(bad.code, 2, bad.stderr);
  assert.match(bad.stderr, /bogus/);
  assert.match(bad.stderr, /table, json, csv, yaml/);
  const ok = runCli([...noCfg, '-o', 'json', 'orders']);
  assert.equal(ok.code, 0, ok.stderr);
  assert.ok(Array.isArray(JSON.parse(ok.stdout)));
});

check('without --config, the CLI reads <HOME>/.config/odette/config.json from the test HOME', () => {
  const home = tempDir();
  mkdirSync(join(home, '.config', 'odette'), { recursive: true });
  const w = Wallet.createRandom(); // generated per run, never printed
  writeConfig(join(home, '.config', 'odette'), { version: 1, chainId: 8453, rpcUrl: 'https://mainnet.base.org', privateKey: w.privateKey });
  for (const env of [{ HOME: home, XDG_CONFIG_HOME: '' }, { HOME: home, XDG_CONFIG_HOME: join(home, '.config') }]) {
    const r = runCli(['-o', 'json', 'wallet', 'show'], { env });
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.address, w.address);
    assert.equal(j.configPath, join(home, '.config', 'odette', 'config.json'));
    assert.ok(!(r.stdout + r.stderr).includes(w.privateKey.slice(2)), 'key printed');
  }
});

check('config set chainId 1 is a usage error (exit 2)', () => {
  const r = runCli([...noCfg, 'config', 'set', 'chainId', '1']);
  assert.equal(r.code, 2, r.stderr);
});

check('RPC URL errors never print the URL path or query (API keys)', () => {
  for (const url of ['http://rpc.example.com/v2/SECRETAPIKEY123?apikey=SECRETQUERY', 'not a url SECRETAPIKEY123']) {
    const r = runCli([...noCfg, '--rpc-url', url, 'orders']);
    assert.notEqual(r.code, 0);
    assert.ok(!(r.stdout + r.stderr).includes('SECRET'), r.stderr);
  }
});

check('saving a config does not chmod an existing directory', () => {
  const d = tempDir();
  chmodSync(d, 0o755);
  const r = runCli(['--config', join(d, 'config.json'), 'wallet', 'create']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(statSync(d).mode & 0o777, 0o755);
  assert.equal(statSync(join(d, 'config.json')).mode & 0o777, 0o600);
});

check('an empty or malformed --collateral is a usage error, never "no budget" (exit 2)', () => {
  const env = { ODETTE_PRIVATE_KEY: key, STUB_TAKER_ALLOWANCE: '1000000000' };
  for (const [cmd, val] of [['preview', ''], ['fill', ''], ['fill', '  '], ['fill', '1.2.3'], ['fill', 'abc']]) {
    const r = runCli([...noCfg, cmd, ...PUT, '--collateral', val], { env });
    assert.equal(r.code, 2, `${cmd} --collateral ${JSON.stringify(val)}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /Proceed with fill|Fill sent/);
  }
});

check('wallet approve --amount with a bad value exits 2', () => {
  for (const val of ['abc', '1.2.3', '']) {
    const r = runCli([...noCfg, 'wallet', 'approve', '--amount', val], { env: { ODETTE_PRIVATE_KEY: key } });
    assert.equal(r.code, 2, `--amount ${JSON.stringify(val)}: ${r.stderr}`);
  }
});

check('config set rpcUrl requires https; config show and set hide the URL path and query', () => {
  const p = join(tempDir(), 'rpc.json');
  assert.equal(runCli(['--config', p, 'config', 'set', 'rpcUrl', 'ftp://h/SECRETPATH?k=SQ']).code, 2);
  assert.equal(runCli(['--config', p, 'config', 'set', 'rpcUrl', 'not a url']).code, 2);
  assert.equal(runCli(['--config', p, 'config', 'set', 'rpcUrl', 'ftp://127.0.0.1:9/x']).code, 2, 'ftp on localhost');
  assert.equal(runCli(['--config', p, 'config', 'set', 'rpcUrl', 'http://127.0.0.1:8545']).code, 0, 'http on localhost is the dev escape hatch');
  assert.notEqual(runCli([...noCfg, '--rpc-url', 'ftp://127.0.0.1:9/x', 'orders']).code, 0, 'ftp refused at use time too');
  const set = runCli(['--config', p, '-o', 'json', 'config', 'set', 'rpcUrl', 'https://base-mainnet.example.com/v2/SECRETKEY123?apikey=SQ']);
  assert.equal(set.code, 0, set.stderr);
  const show = runCli(['--config', p, '-o', 'json', 'config', 'show']);
  for (const out of [set.stdout + set.stderr, show.stdout + show.stderr]) assert.ok(!out.includes('SECRET') && !out.includes('SQ'), out);
  assert.match(JSON.parse(show.stdout).rpcUrl, /^https:\/\/base-mainnet\.example\.com\/… \(path and query hidden\)$/);
  assert.equal(runCli(['--config', p, 'config', 'set', 'rpcUrl', 'https://mainnet.base.org']).code, 0);
  assert.equal(JSON.parse(runCli(['--config', p, '-o', 'json', 'config', 'show']).stdout).rpcUrl, 'https://mainnet.base.org');
});

console.log(`# exit-codes: ${passed} passed`);
