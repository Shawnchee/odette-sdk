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
  maxPayoutForContracts,
  chainMaxContracts,
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

check('PUT $1.95, 100 USDC max -> chain max 51.282040, page max 51.276940 contracts', () => {
  // Chain: 100 / 1.95 = 51.28205128... -> 51_282_051 (6 dp), floor to step 20 -> 51_282_040
  const o = order('PUT', [195_000000n], { maxCollateralUsable: 100_000000n });
  assert.equal(chainMaxContracts(o), 51_282040n);
  // Page: 51.28205128 * 0.9999 = 51.27692307 -> 51_276_923 -> up to step 20 -> 51_276_940
  // maker posts 51.276940 * 1.95 = 99.990033 USDC <= 100
  assert.equal(maxContracts(o), 51_276940n);
  assert.equal(collateralForContracts(o, 51_276940n), 99_990033n);
  // Min at price $0.10: the batch costs 5.127692, 1% costs 0.05127692, so 0.50 needs 10%.
  // 10% = 5.127692 -> 5_127_692 -> up to step 20 -> 5_127_700
  assert.deepEqual(quantum(o), { step: 20n, min: 5_127700n, max: 51_276940n });
});

// ---- spread width case ----

check('CALL_SPREAD 2187.5/2200 uses the width $12.50 -> step 2', () => {
  // width 1_250_000_000; gcd(1_250_000_000, 100_000_000) = 50_000_000 -> 2
  const o = order('CALL_SPREAD', [218_750_000000n, 220_000_000000n], { maxCollateralUsable: 25_000013n });
  assert.equal(collateralPerContract(o), 1_250_000000n);
  assert.equal(sizeStep(o), 2n);
  // Chain: 25.000013 / 12.5 = 2.00000104 -> 2_000_001 -> floor to step 2 -> 2_000_000
  assert.equal(chainMaxContracts(o), 2_000000n);
  // Page: 2.00000104 * 0.9999 = 1.99980104 -> 1_999_801 -> up to step 2 -> 1_999_802
  assert.equal(maxContracts(o), 1_999802n);
});

check('PUT_SPREAD width is the absolute difference', () => {
  // 2200 / 2187.5: width 12.5, same step and max as the call spread above
  const o = order('PUT_SPREAD', [220_000_000000n, 218_750_000000n], { maxCollateralUsable: 25_000013n });
  assert.equal(collateralPerContract(o), 1_250_000000n);
  assert.equal(sizeStep(o), 2n);
  assert.equal(maxContracts(o), 1_999802n);
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
  // Chain: 10 USDC / 0.25 = 40 contracts. Page: 40 * 0.9999 = 39.996, a multiple of 4.
  // The 100 USDC Ranger cap is 1,000 contracts at $0.10, so it does not bind.
  assert.equal(chainMaxContracts(o), 40_000000n);
  assert.equal(maxContracts(o), 39_996000n);
  // A step-1 size reverts on chain; a step-4 size does not.
  assert.equal(chainRoundTrip('RANGER', strikesOf(o), 1_000001n), false);
  assert.equal(chainRoundTrip('RANGER', strikesOf(o), 1_000004n), true);
});

// ---- USDC budget -> contracts ----

check('contractsForUsdc rounds as the page does: to nearest, then up to the step', () => {
  // price $0.10 = 10_000_000. 1.000017 USDC / 0.10 = 10.00017 -> 10_000_170 -> up to step 20 -> 10_000_180
  const o = order('PUT', [195_000000n], { price: 10_000000n });
  assert.equal(contractsForUsdc(o, 1_000017n), 10_000180n);
  // premium 10.000180 * 0.10 = 1.000018 USDC: above the budget by under one step, as on the page
  assert.equal(premiumForContracts(o, 10_000180n), 1_000018n);
});

check('contractsForUsdc caps at the page maximum', () => {
  const o = order('PUT', [195_000000n], { price: 10_000000n, maxCollateralUsable: 100_000000n });
  assert.equal(contractsForUsdc(o, 1_000_000000n), 51_276940n);
});

check('contractsForUsdc returns 0 below the page minimum', () => {
  // price $0.10, 100 USDC batch: the minimum is 10% of the batch = 5_127_700 (0.51277 USDC)
  const o = order('PUT', [195_000000n], { price: 10_000000n });
  assert.equal(contractsForUsdc(o, 400000n), 0n);
  assert.equal(contractsForUsdc(o, 500000n), 0n); // 0.50 USDC does not reach 10% of this batch
  assert.equal(contractsForUsdc(o, 520000n), 5_200000n);
  assert.equal(contractsForUsdc(o, 1n), 0n);
  assert.throws(() => contractsForUsdc(o, -1n), RangeError);
});

check('minimum: PUT is a whole percent of the batch', () => {
  assert.equal(MIN_PREMIUM_USDC, 500000n);
  // price $0.30, 100 USDC batch at strike $1.95: batch = 51.27692307 contracts, cost 15.383077.
  // 1% costs 0.15383077; 0.50 / 0.15383077 = 3.25 -> 4%. 4% = 2.05107692 -> 2_051_077 -> step 20 -> 2_051_080
  const o = order('PUT', [195_000000n], { price: 30_000000n });
  assert.equal(minContracts(o), 2_051080n);
  assert.equal(premiumForContracts(o, 2_051080n), 615324n);
});

check('minimum: a large PUT batch rests on 1%', () => {
  // strike $1, price $0.10, 10,000 USDC batch: 99.99% = 9,999 contracts. 1% = 99.99 contracts,
  // which cost 9.999 USDC, far over 0.50.
  const o = order('PUT', [100_000000n], { price: 10_000000n, maxCollateralUsable: 10_000_000000n });
  assert.equal(minContracts(o), 99_990000n);
});

check('minimum: a spread is the smallest valid size that costs 0.50 USDC', () => {
  // width $12.50 -> step 2. price $0.30: 0.50 / 0.30 = 1.6666.. -> 1_666_667 -> up to step 2 -> 1_666_668
  const o = order('CALL_SPREAD', [218_750_000000n, 220_000_000000n], { price: 30_000000n });
  assert.equal(minContracts(o), 1_666668n);
  assert.equal(premiumForContracts(o, 1_666668n), 500000n);
});

check('a strike under 1 USD: above the page cap the size rounds down, not up', () => {
  // PUT $0.07 -> step 100. 10,000 USDC batch: 142,857.142857 contracts; 99.99% = 142,842.857143 -> 142_842_857_143.
  // The page's cap is maxCollateralUsable (10_000_000_000), so it rounds DOWN to the step.
  const o = order('PUT', [7_000000n], { price: 1_000000n, maxCollateralUsable: 10_000_000000n });
  assert.equal(sizeStep(o), 100n);
  assert.equal(maxContracts(o), 142_842_857100n);
});

check('RANGER: minimum 1 USDC, maximum 100 USDC', () => {
  // k = $50, 2k = $100 -> step 1. price $20: 1 / 20 = 0.05 contracts; 100 / 20 = 5 contracts.
  // 10,000 USDC batch: chain max 100 contracts, far above the 100 USDC cap.
  const o = order('RANGER', [2150_00000000n, 2200_00000000n, 2250_00000000n, 2300_00000000n], { price: 20_00000000n, maxCollateralUsable: 10_000_000000n });
  assert.equal(chainMaxContracts(o), 100_000000n);
  assert.equal(minContracts(o), 50000n);
  assert.equal(maxContracts(o), 5_000000n);
  assert.equal(premiumForContracts(o, 50000n), 1_000000n);
  assert.equal(premiumForContracts(o, 5_000000n), 100_000000n);
  // 0.999 / 20 = 0.04995 contracts, under the minimum. 0.999999 / 20 rounds to 0.05, which is the minimum.
  assert.equal(contractsForUsdc(o, 999_000n), 0n);
  assert.equal(contractsForUsdc(o, 999_999n), 50000n);
  assert.equal(contractsForUsdc(o, 1_000_000000n), 5_000000n);
});

check('RANGER: a batch under 100 USDC stops at 99.99% of the batch', () => {
  // 20 USDC batch at 2k = $100: chain max 0.2 contracts, page max 0.19998. price $20: costs 3.9996 USDC.
  const o = order('RANGER', [2150_00000000n, 2200_00000000n, 2250_00000000n, 2300_00000000n], { price: 20_00000000n, maxCollateralUsable: 20_000000n });
  assert.equal(maxContracts(o), 199980n);
  assert.equal(minContracts(o), 50000n);
});

check('minimum above maximum: the order cannot be traded', () => {
  // PUT $1.95, 1 USDC batch: 0.51282051 * 0.9999 = 0.51276923 -> 512_769 -> step 20 -> 512_780.
  // At $0.50 each the whole order costs 0.256 USDC.
  const o = order('PUT', [195_000000n], { price: 50_000000n, maxCollateralUsable: 1_000000n });
  assert.equal(maxContracts(o), 512780n);
  assert.equal(minContracts(o), null);
  assert.equal(contractsForUsdc(o, 100_000000n), 0n);
  const c = checkSize(o, 512820n);
  assert.equal(c.ok, false);
  assert.equal(c.message, 'Order is too small to trade. The maximum size costs less than 0.50 USDC.');
});

check('checkSize: step, min, max and zero', () => {
  const o = order('PUT', [195_000000n], { maxCollateralUsable: 100_000000n });
  // price $0.10 -> min 5_127_700, max 51_276_940 (worked out above)
  assert.deepEqual(checkSize(o, 5_127700n), { ok: true });
  assert.deepEqual(checkSize(o, 51_276940n), { ok: true });
  const bad = checkSize(o, 5_127710n);
  assert.equal(bad.ok, false);
  assert.equal(bad.message, 'Size 5127710 is not valid. Step is 20; minimum is 5127700; maximum is 51276940.');
  assert.equal(checkSize(o, 5_127680n).ok, false);
  assert.equal(checkSize(o, 0n).ok, false);
  assert.equal(checkSize(o, 51_276960n).ok, false);
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

check('max payout: PUT pays at most the strike per contract', () => {
  // 2 contracts of a $1.95 PUT: at most 2 x 1.95 = 3.90 USDC
  assert.equal(maxPayoutForContracts(order('PUT', [195_000000n]), 2_000000n), 3_900000n);
});

check('max payout: symmetric RANGER pays k per contract, not the 2k the maker posts', () => {
  // 78500/79000/80000/80500: k = 500. 2 contracts pay at most 1000 USDC; the maker posts 2000.
  const o = order('RANGER', [7_850_000_000000n, 7_900_000_000000n, 8_000_000_000000n, 8_050_000_000000n]);
  assert.equal(maxPayoutForContracts(o, 2_000000n), 1_000_000000n);
  assert.equal(collateralForContracts(o, 2_000000n), 2_000_000000n);
});

check('max payout: asymmetric RANGER peaks just above the third strike', () => {
  // 100/110/120/140: k = 10, but s3 - s2 = 20. Just above 120, call = 10 and put = 140 - price,
  // so payout = 140 - price, which is 20 - 1e-8 USD at price 120.00000001.
  // 1 contract (1_000000) -> (2_000_000_000 - 1) * 1_000000 / 1e8 = 19_999_999 (19.999999 USDC).
  const o = order('RANGER', [100_00000000n, 110_00000000n, 120_00000000n, 140_00000000n]);
  assert.equal(maxPayoutForContracts(o, 1_000000n), 19_999999n);
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
      if (o.product.endsWith('SPREAD')) {
        assert.ok(premiumForContracts(o, min - step) < 500000n || min === step, `${o.ticker} min is the smallest`);
      }
      assert.ok(chainRoundTrip(o.product, strikesOf(o), min), `${o.ticker} min round-trips`);
    }
  }
});

console.log(`# sizing: ${passed} passed`);
