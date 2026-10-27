// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Money input parsing (toBigInt): malformed input is refused, never truncated.
// Upstream read "1.2.3" as 1.2 and "25.000000oops" as 25.

import assert from 'node:assert/strict';
import { toBigInt, fromBigInt, UtilsModule } from '../src/index.ts';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

check('valid amounts', () => {
  assert.equal(toBigInt('5', 6), 5_000000n);
  assert.equal(toBigInt('2.5', 6), 2_500000n);
  assert.equal(toBigInt('5.', 6), 5_000000n);
  assert.equal(toBigInt('0.000001', 6), 1n);
  assert.equal(toBigInt('-1.5', 6), -1_500000n);
  assert.equal(toBigInt('1e1', 6), 10_000000n); // exponent form, as upstream
  assert.equal(toBigInt('5.1234567', 6), 5_123456n); // extra decimals truncate (never round up a spend)
});

check('malformed amounts are refused', () => {
  for (const bad of ['1.2.3', '25.000000oops', 'abc', '', ' ', '.5', '5,5', '1_000', '0x10', '--5']) {
    assert.throws(() => toBigInt(bad, 6), /Invalid numeric/, `accepted ${JSON.stringify(bad)}`);
  }
});

check('client.utils wraps the same rule as INVALID_PARAMS', () => {
  const u = new UtilsModule();
  assert.throws(() => u.toBigInt('1.2.3', 6), (e) => e.code === 'INVALID_PARAMS');
  assert.equal(u.fromBigInt(1_500000n, 6), '1.5');
  assert.equal(fromBigInt(1n, 6), '0.000001');
});

console.log(`# decimals: ${passed} passed`);
