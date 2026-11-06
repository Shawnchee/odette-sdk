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

/** Odette's minimum premium: 0.50 USDC (MIN_PREMIUM_USD, config.js:145). */
export const MIN_PREMIUM_USDC = 500_000n;
/** The Ranger ticket starts at 1 USDC of premium (ticketAmountBounds, ui_interactions.js). */
export const MIN_RANGER_PREMIUM_USDC = 1_000_000n;
/** The Ranger ticket stops at 100 USDC of premium (ticketAmountBounds, ui_interactions.js). */
export const MAX_RANGER_PREMIUM_USDC = 100_000_000n;

// The web app sizes against 99.99% of the batch (calculateMaxContracts, config.js:636, :650, :673).
const MAX_TRIM_NUMERATOR = 9999n;
const MAX_TRIM_DENOMINATOR = 10000n;

/** Round half up: the number the web app's `toFixed(6)` produces, without binary float dust. */
function nearest(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * Largest valid size the chain accepts: floor(maxCollateralUsable * 1e8 /
 * collateralPerContract), rounded down to the step.
 *
 * This is the order's own cap. It does not know what is already filled on chain
 * (`amountFilled`), nor whether the maker can fund it. Those are chain reads.
 */
export function chainMaxContracts(order: OdetteOrder): bigint {
  const raw = (maxCollateralOf(order) * PRICE_SCALE) / collateralPerContract(order);
  const step = sizeStep(order);
  return raw - (raw % step);
}

/**
 * Round to a valid size the way the web app does (validateNumContractsForContract).
 * Its cap (getMaxRawContracts, config.js:684-690) is maxCollateralUsable itself for
 * anything but a spread. That cap only bites when a contract costs under 1 USD, as a
 * DOGE strike does: a size above it rounds down, not up. The chain's limit always applies.
 */
function toValidSize(order: OdetteOrder, numContracts: bigint): bigint {
  if (numContracts <= 0n) return 0n;
  const chainMax = chainMaxContracts(order);
  const isSpread = order.product === 'CALL_SPREAD' || order.product === 'PUT_SPREAD';
  const pageCap = isSpread ? chainMax : maxCollateralOf(order);
  return roundToStep(numContracts, sizeStep(order), pageCap < chainMax ? pageCap : chainMax);
}

/**
 * The web app's largest size: 99.99% of the batch. The Ranger ticket also stops
 * at 100 USDC of premium (Math.min(100, rangerMaxCost()), ticketAmountBounds).
 */
export function maxContracts(order: OdetteOrder): bigint {
  const trimmed = nearest(
    maxCollateralOf(order) * PRICE_SCALE * MAX_TRIM_NUMERATOR,
    collateralPerContract(order) * MAX_TRIM_DENOMINATOR
  );
  if (order.product === 'RANGER') {
    const rangerMax = nearest(MAX_RANGER_PREMIUM_USDC * PRICE_SCALE, order.order.price);
    if (rangerMax < trimmed) return toValidSize(order, rangerMax);
  }
  return toValidSize(order, trimmed);
}

/** The size the web app's minimum asks for, before the 0.50 USDC and maximum checks. */
function pageMinimum(order: OdetteOrder): bigint {
  const price = order.order.price;
  switch (order.product) {
    case 'RANGER':
      return toValidSize(order, nearest(MIN_RANGER_PREMIUM_USDC * PRICE_SCALE, price));
    case 'CALL_SPREAD':
    case 'PUT_SPREAD':
      // getMinimumPercentage: the 0.50 USDC minimum, rounded up, then to a valid size.
      return toValidSize(order, (MIN_PREMIUM_USDC * PRICE_SCALE + price - 1n) / price);
    case 'PUT':
    case 'LINEAR_CALL': {
      // getMinimumPercentage: the smallest WHOLE percent of the batch that costs
      // 0.50 USDC, and at least 1%. On an expensive batch this is well above 0.50 USDC.
      const per = collateralPerContract(order);
      const collateral = maxCollateralOf(order);
      const onePercentCost = collateral * MAX_TRIM_NUMERATOR * price;
      const needed = MIN_PREMIUM_USDC * 100n * per * MAX_TRIM_DENOMINATOR;
      const rawPercent = (needed + onePercentCost - 1n) / onePercentCost;
      const percent = rawPercent < 1n ? 1n : rawPercent;
      return toValidSize(
        order,
        nearest(collateral * PRICE_SCALE * MAX_TRIM_NUMERATOR * percent, per * MAX_TRIM_DENOMINATOR * 100n)
      );
    }
  }
}

/**
 * The web app's smallest size (getMinimumPercentage, config.js:794-823, and the
 * Ranger ticket's 1 USDC). At 100% it rests on the maximum. Returns null when the
 * order cannot be traded: at this size the premium is under the chain's 0.50 USDC.
 */
export function minContracts(order: OdetteOrder): bigint | null {
  const max = maxContracts(order);
  if (max <= 0n) return null;
  const wanted = pageMinimum(order);
  const min = wanted > max ? max : wanted;
  return premiumForContracts(order, min) < MIN_PREMIUM_USDC ? null : min;
}

/** `{ step, min, max }` for an order, in contracts with 6 decimals. `min` is null when the order cannot be traded. */
export function quantum(order: OdetteOrder): { step: bigint; min: bigint | null; max: bigint } {
  return { step: sizeStep(order), min: minContracts(order), max: maxContracts(order) };
}

/** USDC (6 dp) the maker posts for `numContracts`. Same formula as the chain. */
export function collateralForContracts(order: OdetteOrder, numContracts: bigint): bigint {
  return (numContracts * collateralPerContract(order)) / PRICE_SCALE;
}

/**
 * Most USDC (6 dp) the buyer can be paid at expiry for `numContracts`.
 * PUT, LINEAR_CALL and spreads pay at most what the maker posts. RANGER pays
 * (call leg + put leg - k), RangerOption.simulatePayout. That is piecewise
 * linear in price with one jump: just above strikes[2] the put leg goes from k
 * to strikes[3] - price. So the maximum is at a strike or one unit above
 * strikes[2] (they differ only when strikes[3] - strikes[2] > k).
 */
export function maxPayoutForContracts(order: OdetteOrder, numContracts: bigint): bigint {
  if (order.product !== 'RANGER') return collateralForContracts(order, numContracts);
  const [s0, s1, s2, s3] = strikesOf(order) as [bigint, bigint, bigint, bigint];
  const k = s1 - s0;
  let best = 0n;
  for (const price of [s0, s1, s2, s2 + 1n, s3]) {
    const call = price <= s0 ? 0n : price >= s1 ? k : price - s0;
    const put = price >= s3 ? 0n : price <= s2 ? k : s3 - price;
    const total = call + put;
    const perContract = total > k ? total - k : 0n;
    if (perContract > best) best = perContract;
  }
  return (numContracts * best) / PRICE_SCALE;
}

/** USDC (6 dp) premium the taker pays for `numContracts`. OptionBook: price * numContracts / 1e8. */
export function premiumForContracts(order: OdetteOrder, numContracts: bigint): bigint {
  return (order.order.price * numContracts) / PRICE_SCALE;
}

/**
 * Contracts a USDC budget (6 dp) buys, as the web app sizes a typed amount:
 * budget / price to the nearest contract unit, then to a valid size. Because the
 * page rounds to nearest, the premium can pass the budget by under one step.
 * A budget above the maximum buys the maximum.
 *
 * Returns 0n when the budget does not reach the minimum. The page raises such an
 * amount to its minimum and says so. The SDK does not spend more than the caller
 * named: the caller gets the refusal and the minimum.
 */
export function contractsForUsdc(order: OdetteOrder, usdcAmount: bigint): bigint {
  if (usdcAmount < 0n) throw new RangeError(`USDC amount must not be negative. Got ${usdcAmount}.`);
  const max = maxContracts(order);
  const min = minContracts(order);
  if (min === null) return 0n;
  const raw = nearest(usdcAmount * PRICE_SCALE, order.order.price);
  if (raw >= max) return max;
  const size = toValidSize(order, raw);
  if (size < min) return 0n;
  return size > max ? max : size;
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
 * contractsForUsdc uses it for a typed amount.
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
