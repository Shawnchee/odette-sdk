// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Sizing: step, max and USDC -> contracts. Expected values are worked out by
// hand in the comments, not computed with the SDK's formula.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseFeed,
  filterWhitelisted,
  sizeStep,
  maxContracts,
  minContracts,
  MIN_PREMIUM_USDC,
  quantum,
  collateralPerContract,
  collateralForContracts,
  premiumForContracts,
  contractsForUsdc,
  checkSize,
  roundToStep,
} from '../src/index.ts';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

// Minimal OdetteOrder (upstream OrderWithSignature shape). Only the fields sizing reads.
function order(product, strikes, { maxCollateralUsable = 100_000000n, price = 10_000000n } = {}) {
  return {
    product,
    underlying: 'ETH',
    optionBook: '0x1bDff855d6811728acaDC00989e79143a2bdfDed',
    signature: '0x11',
    order: { price },
    rawApiData: { strikes: strikes.map(String), maxCollateralUsable: maxCollateralUsable.toString() },
  };
}
const strikesOf = (o) => o.rawApiData.strikes.map(BigInt);

// The chain's round trip, written out from the Solidity sources, so the test
// does not reuse sizing.ts. Returns true when numContracts survives
// calculateRequiredCollateral -> calculateNumContractsForCollateral.
function chainRoundTrip(product, strikes, n) {
  const E8 = 100000000n;
  let per;
  if (product === 'PUT' || product === 'LINEAR_CALL') per = strikes[0];
  else if (product === 'CALL_SPREAD') per = strikes[1] - strikes[0];
  else if (product === 'PUT_SPREAD') per = strikes[0] - strikes[1];
  else if (product === 'RANGER') per = 2n * (strikes[1] - strikes[0]);
  const collateral = (n * per) / E8;
  return (collateral * E8) / per === n;
}

// ---- PRD quantum cases (config.js:705-707) ----

check('PUT strike $1.95 -> step 20', () => {
  // gcd(195_000_000, 100_000_000) = 5_000_000; 100_000_000 / 5_000_000 = 20
  assert.equal(sizeStep(order('PUT', [195_000000n])), 20n);
});

check('PUT strike $2.00 -> step 1', () => {
  // gcd(200_000_000, 100_000_000) = 100_000_000 -> 1
  assert.equal(sizeStep(order('PUT', [200_000000n])), 1n);
});

check('LINEAR_CALL strike $1.825 -> step 40', () => {
  // gcd(182_500_000, 100_000_000) = 2_500_000 -> 40
  assert.equal(sizeStep(order('LINEAR_CALL', [182_500000n])), 40n);
});

check('PUT $1.95, 100 USDC max -> max 51.282040 contracts', () => {
  // 100 / 1.95 = 51.28205128... -> 51_282_051 (6 dp), floor to step 20 -> 51_282_040
  // maker posts 51.282040 * 1.95 = 99.999978 USDC <= 100
  const o = order('PUT', [195_000000n], { maxCollateralUsable: 100_000000n });
  assert.equal(maxContracts(o), 51_282040n);
  assert.equal(collateralForContracts(o, 51_282040n), 99_999978n);
  // min at price $0.10: 0.50 / 0.10 = 5 contracts = 5_000_000, already a multiple of 20
  assert.deepEqual(quantum(o), { step: 20n, min: 5_000000n, max: 51_282040n });
});

// ---- spread width case ----

check('CALL_SPREAD 2187.5/2200 uses the width $12.50 -> step 2', () => {
  // width 1_250_000_000; gcd(1_250_000_000, 100_000_000) = 50_000_000 -> 2
  const o = order('CALL_SPREAD', [218_750_000000n, 220_000_000000n], { maxCollateralUsable: 25_000013n });
  assert.equal(collateralPerContract(o), 1_250_000000n);
  assert.equal(sizeStep(o), 2n);
  // 25.000013 / 12.5 = 2.00000104 -> 2_000_001 -> floor to step 2 -> 2_000_000
  assert.equal(maxContracts(o), 2_000000n);
});

check('PUT_SPREAD width is the absolute difference', () => {
  // 2200 / 2187.5: width 12.5, same step and max as the call spread above
  const o = order('PUT_SPREAD', [220_000_000000n, 218_750_000000n], { maxCollateralUsable: 25_000013n });
  assert.equal(collateralPerContract(o), 1_250_000000n);
  assert.equal(sizeStep(o), 2n);
  assert.equal(maxContracts(o), 2_000000n);
});

check('spread step does not come from the first strike', () => {
  // 2000 / 2000.125: first strike $2000 alone would give step 1.
  // width $0.125 = 12_500_000; gcd(12_500_000, 1e8) = 12_500_000 -> step 8
  const o = order('CALL_SPREAD', [200_000_000000n, 200_012_500000n]);
  assert.equal(sizeStep(o), 8n);
});

// ---- RANGER: 2k, from RangerOption.sol ----

check('RANGER posts 2k per contract; step from 2k, not strikes[0]', () => {
  // strikes $1.00 / $1.125 / ... ; k = 0.125, 2k = 0.25 = 25_000_000
  // gcd(25_000_000, 1e8) = 25_000_000 -> step 4. The web app's strikes[0] rule gives step 1.
  const o = order('RANGER', [100_000000n, 112_500000n, 120_000000n, 130_000000n], { maxCollateralUsable: 10_000000n });
  assert.equal(collateralPerContract(o), 25_000000n);
  assert.equal(sizeStep(o), 4n);
  // 10 USDC / 0.25 = 40 contracts
  assert.equal(maxContracts(o), 40_000000n);
  // A step-1 size reverts on chain; a step-4 size does not.
  assert.equal(chainRoundTrip('RANGER', strikesOf(o), 1_000001n), false);
  assert.equal(chainRoundTrip('RANGER', strikesOf(o), 1_000004n), true);
});

// ---- USDC budget -> contracts ----

check('contractsForUsdc floors to the step', () => {
  // price $0.10 = 10_000_000. 1.000017 USDC / 0.10 = 10.00017 -> 10_000_170 -> floor 20 -> 10_000_160
  const o = order('PUT', [195_000000n], { price: 10_000000n });
  assert.equal(contractsForUsdc(o, 1_000017n), 10_000160n);
  // premium 10.000160 * 0.10 = 1.000016 USDC, not above the budget
  assert.equal(premiumForContracts(o, 10_000160n), 1_000016n);
});

check('contractsForUsdc caps at the maximum', () => {
  const o = order('PUT', [195_000000n], { price: 10_000000n, maxCollateralUsable: 100_000000n });
  assert.equal(contractsForUsdc(o, 1_000_000000n), 51_282040n);
});

check('contractsForUsdc returns 0 below the 0.50 USDC minimum', () => {
  // price $0.10: 0.40 USDC buys 4 contracts, under the 5-contract minimum
  const o = order('PUT', [195_000000n], { price: 10_000000n });
  assert.equal(contractsForUsdc(o, 400000n), 0n);
  assert.equal(contractsForUsdc(o, 500000n), 5_000000n);
  assert.equal(contractsForUsdc(o, 1n), 0n);
  assert.throws(() => contractsForUsdc(o, -1n), RangeError);
});

check('minimum size: smallest step with premium >= 0.50 USDC', () => {
  assert.equal(MIN_PREMIUM_USDC, 500000n);
  // price $0.30: 0.50 / 0.30 = 1.6666.. -> 1_666_667 -> up to step 20 -> 1_666_680
  // 1.666680 * 0.30 = 0.500004 >= 0.50; one step less, 1.666660 * 0.30 = 0.499998 < 0.50
  const o = order('PUT', [195_000000n], { price: 30_000000n });
  assert.equal(minContracts(o), 1_666680n);
  assert.equal(premiumForContracts(o, 1_666680n), 500004n);
  assert.equal(premiumForContracts(o, 1_666660n), 499998n);
});

check('minimum above maximum: the order cannot be traded', () => {
  // PUT $1.95, 1 USDC max -> max 0.512820 contracts; at $0.50 each the whole order costs 0.256 USDC
  const o = order('PUT', [195_000000n], { price: 50_000000n, maxCollateralUsable: 1_000000n });
  assert.equal(maxContracts(o), 512820n);
  assert.equal(minContracts(o), null);
  assert.equal(contractsForUsdc(o, 100_000000n), 0n);
  const c = checkSize(o, 512820n);
  assert.equal(c.ok, false);
  assert.equal(c.message, 'Order is too small to trade. The maximum size costs less than 0.50 USDC.');
});

check('checkSize: step, min, max and zero', () => {
  const o = order('PUT', [195_000000n], { maxCollateralUsable: 100_000000n });
  // price $0.10 -> min 5_000_000
  assert.deepEqual(checkSize(o, 5_000000n), { ok: true });
  assert.deepEqual(checkSize(o, 51_282040n), { ok: true });
  const bad = checkSize(o, 5_000010n);
  assert.equal(bad.ok, false);
  assert.equal(bad.message, 'Size 5000010 is not valid. Step is 20; minimum is 5000000; maximum is 51282040.');
  assert.equal(checkSize(o, 4_999980n).ok, false);
  assert.equal(checkSize(o, 0n).ok, false);
  assert.equal(checkSize(o, 51_282060n).ok, false);
});

// ---- web app parity: validateNumContractsForContract ----

check('roundToStep matches validateNumContractsForContract', () => {
  assert.equal(roundToStep(0n, 20n), 20n); // zero -> one quantum
  assert.equal(roundToStep(0n, 20n, 10n), 0n); // quantum above max -> 0
  assert.equal(roundToStep(40n, 20n), 40n); // already valid
  assert.equal(roundToStep(45n, 20n), 60n); // round up
  assert.equal(roundToStep(45n, 20n, 50n), 40n); // up passes max -> down
  assert.equal(roundToStep(15n, 20n, 10n), 0n); // down reaches 0 -> 0
});

// ---- second probe: real orders from the recorded feed ----

check('recorded feed: every Odette order max survives the chain round trip', () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/feed-sample.json', import.meta.url), 'utf8'));
  const { accepted } = filterWhitelisted(parseFeed(raw).orders, { enableSpreads: true, now: 1793085599 });
  assert.ok(accepted.length >= 5);
  for (const o of accepted) {
    const { step, max } = quantum(o);
    assert.ok(max > 0n, `${o.ticker} max > 0`);
    assert.equal(max % step, 0n, `${o.ticker} max is a multiple of step`);
    assert.ok(chainRoundTrip(o.product, strikesOf(o), max), `${o.ticker} max round-trips`);
    assert.ok(chainRoundTrip(o.product, strikesOf(o), step), `${o.ticker} step round-trips`);
    assert.ok(collateralForContracts(o, max) <= BigInt(o.rawApiData.maxCollateralUsable), `${o.ticker} max fits maxCollateralUsable`);
    const min = minContracts(o);
    if (min !== null) {
      assert.ok(premiumForContracts(o, min) >= 500000n, `${o.ticker} min premium >= 0.50`);
      assert.ok(premiumForContracts(o, min - step) < 500000n || min === step, `${o.ticker} min is the smallest`);
      assert.ok(chainRoundTrip(o.product, strikesOf(o), min), `${o.ticker} min round-trips`);
    }
  }
});

console.log(`# sizing: ${passed} passed`);
