// Copyright (c) 2026 Thetanuts Finance. MIT License.
// redactSecrets removes RPC API keys from realistic ethers error text.

import assert from 'node:assert/strict';
import { redactSecrets } from '../src/output.ts';

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

console.log(`# redact: ${passed} passed`);
