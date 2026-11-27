// Copyright (c) 2026 Thetanuts Finance. MIT License.
// redactSecrets removes RPC API keys from realistic ethers error text.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { redactSecrets, registerRpcUrl } from '../src/output.ts';
import { runCli, tempDir } from './helpers/run-cli.mjs';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const ALCHEMY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const INFURA = '0123456789abcdef0123456789abcdef';
const APIKEY = 'k3yK3yk3yK3yk3yK3yk3y';

check('an ethers 401 SERVER_ERROR with an Alchemy URL loses the key', () => {
  const raw = 'server response 401 Unauthorized (request={  }, response={  }, error=null, info={ "requestUrl": ' +
    `"https://base-mainnet.g.alchemy.com/v2/${ALCHEMY}", "responseBody": "", "responseStatus": "401 Unauthorized" }, ` +
    'code=SERVER_ERROR, version=6.16.0)';
  const out = redactSecrets(raw);
  assert.ok(!out.includes(ALCHEMY), out);
  assert.match(out, /alchemy\.com\/v2\/<redacted>/);
  assert.match(out, /code=SERVER_ERROR/);
});

check('an Infura /v3/<32 hex> URL loses the key', () => {
  const out = redactSecrets(`server response 403 Forbidden (info={ "requestUrl": "https://base-mainnet.infura.io/v3/${INFURA}" })`);
  assert.ok(!out.includes(INFURA), out);
  assert.match(out, /infura\.io\/v3\/<redacted>/);
});

check('an apiKey= query string loses the key', () => {
  const out = redactSecrets(`server response 401 (info={ "requestUrl": "https://rpc.example.com/base?apiKey=${APIKEY}&x=1" })`);
  assert.ok(!out.includes(APIKEY), out);
  assert.match(out, /apiKey=<redacted>&x=1/);
});

check('text without a secret is unchanged', () => {
  const s = 'could not detect network (event="noNetwork", code=NETWORK_ERROR, version=6.16.0)';
  assert.equal(redactSecrets(s), s);
});

check('a registered RPC URL with an unknown key shape is redacted (ankr path, api-key query)', () => {
  const ANKR = 'https://rpc.ankr.com/base/0f1e2d3c4b5a69788796a5b4c3d2e1f0';
  const QUERY = 'https://base.example.org/rpc?api-key=s3cr3t-canary-value';
  assert.ok(redactSecrets(`x "${ANKR}" y`).includes(ANKR), 'probe: the shape rules alone miss this key');
  registerRpcUrl(ANKR);
  registerRpcUrl(QUERY);
  const out = redactSecrets(`info={ "requestUrl": "${ANKR}" } and { "requestUrl": "${QUERY}" }`);
  assert.ok(!out.includes('0f1e2d3c4b5a69788796a5b4c3d2e1f0'), out);
  assert.ok(!out.includes('s3cr3t-canary-value'), out);
  assert.match(out, /https:\/\/rpc\.ankr\.com\/<redacted>/);
});

check('a bare-origin RPC URL is not registered, so ordinary text stays readable', () => {
  registerRpcUrl('https://mainnet.base.org');
  const s = 'request to https://mainnet.base.org failed';
  assert.equal(redactSecrets(s), s);
});

check('end to end: an RPC 503 under --json-errors does not print the configured RPC key', () => {
  const dir = tempDir();
  const r = runCli(['--config', join(dir, 'absent.json'), '--json-errors', 'wallet', 'balance', '--address', '0x1111111111111111111111111111111111111111'], {
    env: { ODETTE_RPC_URL: 'https://rpc.example.test/custom/secret-canary-123', STUB_RPC_FAIL: '1' },
  });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /rpc\.example\.test/, `probe: the error must name the RPC, or this test proves nothing: ${r.stderr}`);
  assert.ok(!(r.stdout + r.stderr).includes('secret-canary-123'), r.stderr);
});

check('end to end: pre-send check rows on stdout do not print the configured RPC key (json, yaml, table)', () => {
  // Check 1 embeds the ethers error, which holds requestUrl. render() writes it to stdout.
  const dir = tempDir();
  for (const o of ['json', 'yaml', 'table']) {
    const r = runCli(['--config', join(dir, 'absent.json'), '-o', o, 'preview', '--underlying', 'ETH', '--type', 'PUT', '--strike', '2180', '--expiry', '1793174400', '--collateral', '5'], {
      env: { ODETTE_PRIVATE_KEY: Wallet.createRandom().privateKey, ODETTE_RPC_URL: 'https://rpc.example.test/custom/secret-canary-123', STUB_RPC_FAIL: '1', COLUMNS: '2000' },
    });
    if (o === 'json') assert.match(r.stdout, /Could not reach the RPC/, `probe: check 1 must report the RPC error: ${r.stdout}${r.stderr}`);
    assert.ok(!(r.stdout + r.stderr).includes('secret-canary-123'), `${o}: ${r.stdout}`);
  }
});

console.log(`# redact: ${passed} passed`);
