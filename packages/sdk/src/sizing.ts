// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Ported from thetaverse odette/config.js at origin/dev
// 5c3f2b0639ce07a134a0f82b7df8113dea1e744b: getContractQuantumStrike (:677),
// getMaxRawContracts (:684), validateNumContractsForContract (:715-760),
// calculateMaxContracts (:632-673). Collateral formulas checked against
// thetanuts_rfq src/options/{PutOption,LinearCallOption,RangerOption,
// CallSpreadOption,PutSpreadOption}.sol at 2c830620861eefcca895fb8e2a60b8f3fa915e7f.
//
// Units (all bigint):
//   strikes, price      USD, 8 decimals
//   numContracts        contracts, 6 decimals (the USDC collateral's decimals)
//   collateral, premium USDC, 6 decimals
//
// All contracts <-> USDC conversion happens in this file and nowhere else.

import { PRICE_DECIMALS } from './chain.js';
import type { OdetteOrder } from './types.js';

const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS);

/** Strikes, USD 8 dp, from the signed order. */
function strikesOf(order: OdetteOrder): bigint[] {
  return order.rawApiData.strikes.map((s) => BigInt(s));
}

/** The maker's collateral cap for this nonce, USDC 6 dp, from the signed order. */
function maxCollateralOf(order: OdetteOrder): bigint {
  return BigInt(order.rawApiData.maxCollateralUsable);
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/**
 * Collateral the maker posts per contract, USD with 8 decimals.
 * This is the "quantum strike" of config.js:677, taken from each
 * implementation's calculateRequiredCollateral:
 * - PUT, LINEAR_CALL: strikes[0]
 * - CALL_SPREAD, PUT_SPREAD: |strikes[0] - strikes[1]| (the width)
 * - RANGER: 2 * (strikes[1] - strikes[0])
 *
 * RANGER: RangerOption.sol and the web app's calculateMaxContracts (config.js:640-648)
 * both use 2k. The web app's step uses strikes[0] (config.js:677); this port takes
 * the step from 2k, as the contract's round trip does. On the live feed of
 * 2026-10-27 both step rules agreed for all 42 RANGER orders.
 * thetanuts-sdk calculateMaxContracts has no RANGER branch: it uses
 * (last strike - first strike), which is not what RangerOption.sol posts, so it
 * is not ported.
 */
export function collateralPerContract(order: OdetteOrder): bigint {
  const s = strikesOf(order);
  switch (order.product) {
    case 'PUT':
    case 'LINEAR_CALL':
      return s[0]!;
    case 'CALL_SPREAD':
    case 'PUT_SPREAD': {
      const w = s[0]! - s[1]!;
      return w < 0n ? -w : w;
    }
    case 'RANGER':
      return 2n * (s[1]! - s[0]!);
  }
}

/**
 * Smallest contract increment that survives the chain's
 * contracts -> collateral -> contracts round trip without loss:
 * step = 1e8 / gcd(collateralPerContract, 1e8).
 */
export function sizeStep(order: OdetteOrder): bigint {
  return PRICE_SCALE / gcd(collateralPerContract(order), PRICE_SCALE);
}

/**
 * Largest valid size the signed order allows: floor(maxCollateralUsable * 1e8 /
 * collateralPerContract), rounded down to the step.
 *
 * This is the order's own cap. It does not know what is already filled on chain
 * (`amountFilled`), nor whether the maker can fund it. Those are chain reads.
 */
export function maxContracts(order: OdetteOrder): bigint {
  const raw = (maxCollateralOf(order) * PRICE_SCALE) / collateralPerContract(order);
  const step = sizeStep(order);
  return raw - (raw % step);
}

/** Odette's minimum premium: 0.50 USDC (MIN_PREMIUM_USD, config.js:145). */
export const MIN_PREMIUM_USDC = 500_000n;

/**
 * Smallest valid size whose premium is at least MIN_PREMIUM_USDC: ceil(0.50 USDC
 * * 1e8 / price), rounded up to the step (getMinimumPercentage, config.js:794-823).
 * Returns null when that size is above the maximum: the order cannot be traded.
 */
export function minContracts(order: OdetteOrder): bigint | null {
  const price = order.order.price;
  const raw = (MIN_PREMIUM_USDC * PRICE_SCALE + price - 1n) / price;
  const step = sizeStep(order);
  const rem = raw % step;
  const min = rem === 0n ? raw : raw + (step - rem);
  return min > maxContracts(order) ? null : min;
}

/** `{ step, min, max }` for an order, in contracts with 6 decimals. `min` is null when the order cannot be traded. */
export function quantum(order: OdetteOrder): { step: bigint; min: bigint | null; max: bigint } {
  return { step: sizeStep(order), min: minContracts(order), max: maxContracts(order) };
}

/** USDC (6 dp) the maker posts for `numContracts`. Same formula as the chain. */
export function collateralForContracts(order: OdetteOrder, numContracts: bigint): bigint {
  return (numContracts * collateralPerContract(order)) / PRICE_SCALE;
}

/** USDC (6 dp) premium the taker pays for `numContracts`. OptionBook: price * numContracts / 1e8. */
export function premiumForContracts(order: OdetteOrder, numContracts: bigint): bigint {
  return (order.order.price * numContracts) / PRICE_SCALE;
}

/**
 * Contracts a USDC budget (6 dp) buys: floor to the step, cap at the maximum.
 * The premium of the result never exceeds the budget. Returns 0n when the
 * budget does not reach the minimum size (0.50 USDC premium).
 */
export function contractsForUsdc(order: OdetteOrder, usdcAmount: bigint): bigint {
  if (usdcAmount < 0n) throw new RangeError(`USDC amount must not be negative. Got ${usdcAmount}.`);
  const step = sizeStep(order);
  const max = maxContracts(order);
  const min = minContracts(order);
  const raw = (usdcAmount * PRICE_SCALE) / order.order.price;
  const floored = raw - (raw % step);
  const capped = floored > max ? max : floored;
  return min === null || capped < min ? 0n : capped;
}

/** Check a size against the order's step, minimum and maximum. */
export function checkSize(
  order: OdetteOrder,
  numContracts: bigint
): { ok: true } | { ok: false; step: bigint; min: bigint | null; max: bigint; message: string } {
  const { step, min, max } = quantum(order);
  if (min === null) {
    return { ok: false, step, min, max, message: 'Order is too small to trade. The maximum size costs less than 0.50 USDC.' };
  }
  if (numContracts >= min && numContracts <= max && numContracts % step === 0n) return { ok: true };
  return { ok: false, step, min, max, message: `Size ${numContracts} is not valid. Step is ${step}; minimum is ${min}; maximum is ${max}.` };
}

/**
 * Direct port of validateNumContractsForContract (config.js:715-760), for parity
 * with the web app's slider. Rounds `numContracts` UP to the next multiple of
 * `step`; if that passes `max`, rounds DOWN instead; returns 0n when no valid
 * size fits. Zero input returns one step (or 0n when one step passes `max`).
 * New code should prefer contractsForUsdc, which never rounds up.
 */
export function roundToStep(numContracts: bigint, step: bigint, max: bigint | null = null): bigint {
  if (step <= 0n) throw new RangeError(`Step must be positive. Got ${step}.`);
  if (numContracts === 0n) {
    if (max !== null && step > max) return 0n;
    return step;
  }
  const remainder = numContracts % step;
  if (remainder === 0n) return numContracts;
  const roundedUp = numContracts + (step - remainder);
  if (max !== null && roundedUp > max) {
    const roundedDown = numContracts - remainder;
    return roundedDown <= 0n ? 0n : roundedDown;
  }
  return roundedUp;
}
