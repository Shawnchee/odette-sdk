// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Rules ported from thetaverse odette/config.js at origin/dev
// 5c3f2b0639ce07a134a0f82b7df8113dea1e744b: implementation constants (:266-270),
// isSpreadOrder (:273-285), isDirectionalOrder (:311-317), isRangerOrder (:324-328),
// CANONICAL_ASSETS (:1209-1307), COLLATERAL_TOKENS (:1309-1314).
// The source uses ethers v5 BigNumber. This port uses bigint.

import { getAddress } from 'ethers';
import { BASE_CHAIN_ID, KNOWN_OPTION_BOOKS, OPTION_BOOK_R12, USDC } from './chain.js';
import { toOdetteOrder } from './normalize.js';
import type { OdetteOrder, ProductKind, RawFeedOrder } from './types.js';

/** r12 implementations Odette accepts (config.js:266-270). */
export const IMPLEMENTATIONS: Readonly<Record<ProductKind, string>> = {
  PUT: '0x7355EB92dfb0503DB558a70c10843618932ab290',
  LINEAR_CALL: '0x051791df68223AE173Fade5217C48875e36eef61',
  RANGER: '0x9980ec85bc6fE07340adb36c76FA093bb6D4FcBc',
  CALL_SPREAD: '0xfaeD63f7040E65b79cF0Ae29706fDc423eE249A9',
  PUT_SPREAD: '0x02Fe0d9635e0139DBB3768a5d5Db404Fd84d9134',
};

/** Products that are ported but off unless `enableSpreads` is true. */
export const HIDDEN_PRODUCTS: readonly ProductKind[] = ['CALL_SPREAD', 'PUT_SPREAD'];

/** Odette markets: symbol -> price feed (CANONICAL_ASSETS, config.js:1209-1307). */
export const MARKETS: Readonly<Record<string, string>> = {
  ETH: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  BTC: '0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F',
  XRP: '0x9f0C1dD78C4CBdF5b9cf923a549A201EdC676D34',
  BNB: '0x4b7836916781CAAfbb7Bd1E5FDd20ED544B453b1',
  SOL: '0x975043adBb80fc32276CbF9Bbcfd4A601a12462D',
  AVAX: '0xE70f2D34Fd04046aaEC26a198A35dD8F2dF5cd92',
  PAXG: '0x5213eBB69743b85644dbB6E25cdF994aFBb8cF31',
  DOGE: '0x8422f3d3CAFf15Ca682939310d6A5e619AE08e57',
};

/** Spreads trade on BTC and ETH only (config.js:281). */
export const SPREAD_MARKETS: readonly string[] = ['BTC', 'ETH'];

/**
 * Markets that trade on some UTC weekdays only (CANONICAL_ASSETS `availability`,
 * isAssetAvailableOnDay config.js:1372). 0 = Sunday, 4 = Thursday. Not listed = every day.
 */
export const MARKET_DAYS: Readonly<Record<string, readonly number[]>> = {
  PAXG: [4],
  DOGE: [4],
};

/** Daily expiries are at 08:00 UTC (UTC_EXPIRY_HOUR, config.js). */
export const EXPIRY_UTC_SECOND_OF_DAY = 8 * 60 * 60;
/** The daily book drops an expiry in its last hour (DAILY_BOOK_MIN_SECONDS, config.js). */
export const MIN_SECONDS_TO_EXPIRY = 60 * 60;
/** The web app's longest expiry tab is 3 days (EXPIRY_FILTER_LIMITS '3day', config.js). */
export const MAX_SECONDS_TO_EXPIRY = 73 * 60 * 60;
/** The web app refreshes a quote with under 30 s left (isOrderExpiringSoon, ui_interactions.js:5355). */
export const MIN_SECONDS_TO_ORDER_EXPIRY = 30;

export interface WhitelistOptions {
  /** Default false. CALL_SPREAD and PUT_SPREAD stay hidden unless true. */
  enableSpreads?: boolean;
  /** Unix seconds to judge expiry and market days against. Default: the current time. */
  now?: number;
  /**
   * Skip the time rules (expiry window, market day, quote expiry). For
   * preview and encode only, which must not depend on the clock; checkFill
   * and fillOrder always apply them against chain time.
   */
  ignoreTime?: boolean;
}

export type RejectReason =
  | 'wrong-chain'
  | 'unsupported-implementation'
  | 'wrong-collateral'
  | 'unknown-market'
  | 'bad-strikes'
  | 'bad-call-flag'
  | 'wrong-side'
  | 'unknown-option-book'
  | 'invalid-price'
  | 'no-liquidity'
  | 'hourly-binary'
  | 'not-daily-expiry'
  | 'expiry-out-of-range'
  | 'market-closed'
  | 'order-expiring';

export type WhitelistResult =
  | { ok: true; order: OdetteOrder }
  | { ok: false; reason: RejectReason; message: string };

const PRODUCT_BY_IMPLEMENTATION = new Map<string, ProductKind>(
  (Object.entries(IMPLEMENTATIONS) as Array<[ProductKind, string]>).map(([kind, address]) => [
    address.toLowerCase(),
    kind,
  ])
);

const MARKET_BY_FEED = new Map<string, string>(
  Object.entries(MARKETS).map(([symbol, feed]) => [feed.toLowerCase(), symbol])
);

const KNOWN_BOOKS = new Set(KNOWN_OPTION_BOOKS.map((a) => a.toLowerCase()));

/** Product for an implementation address, or null when Odette does not list it. */
export function productForImplementation(implementation: string): ProductKind | null {
  return PRODUCT_BY_IMPLEMENTATION.get(implementation.toLowerCase()) ?? null;
}

/** Underlying symbol for a price feed, or null when it is not an Odette market. */
export function marketForPriceFeed(priceFeed: string): string | null {
  return MARKET_BY_FEED.get(priceFeed.toLowerCase()) ?? null;
}

/** True when the product is on with these options. */
export function isProductEnabled(product: ProductKind, opts: WhitelistOptions = {}): boolean {
  return opts.enableSpreads === true || !HIDDEN_PRODUCTS.includes(product);
}

/**
 * Strike shape per product.
 * - PUT, LINEAR_CALL: one strike (isDirectionalOrder).
 * - CALL_SPREAD: two strikes, first < second. PUT_SPREAD: first > second (isSpreadOrder).
 * - RANGER: four strikes (isRangerOrder). This port also requires them to rise
 *   strictly, because RangerOption computes k = strikes[1] - strikes[0] and needs k > 0.
 */
function strikesMatch(product: ProductKind, strikes: readonly bigint[]): boolean {
  if (strikes.some((s) => s <= 0n)) return false;
  switch (product) {
    case 'PUT':
    case 'LINEAR_CALL':
      return strikes.length === 1;
    case 'CALL_SPREAD':
      return strikes.length === 2 && strikes[0]! < strikes[1]!;
    case 'PUT_SPREAD':
      return strikes.length === 2 && strikes[0]! > strikes[1]!;
    case 'RANGER':
      return (
        strikes.length === 4 &&
        strikes[0]! < strikes[1]! &&
        strikes[1]! < strikes[2]! &&
        strikes[2]! < strikes[3]!
      );
  }
}

/**
 * The isCall flag each product must carry. Spreads: isSpreadOrder checks it.
 * PUT and LINEAR_CALL: added in this port (the web app does not check it).
 * RANGER: no rule in the source, so none here.
 */
function callFlagMatches(product: ProductKind, isCall: boolean): boolean {
  switch (product) {
    case 'PUT':
    case 'PUT_SPREAD':
      return isCall === false;
    case 'LINEAR_CALL':
    case 'CALL_SPREAD':
      return isCall === true;
    case 'RANGER':
      return true;
  }
}

function reject(reason: RejectReason, message: string): WhitelistResult {
  return { ok: false, reason, message };
}

/** True when the market trades on the UTC weekday of `nowSeconds`. */
export function isMarketOpen(underlying: string, nowSeconds: number): boolean {
  const days = MARKET_DAYS[underlying];
  return days === undefined || days.includes(new Date(nowSeconds * 1000).getUTCDay());
}

/**
 * Check one feed order against the rules the Odette web app applies to its book.
 * Returns the typed order, or the first reason it is refused. On-chain checks
 * (maker funding, amount already filled) are not done here.
 *
 * The SDK buys only (isLong false: the maker sells). It never sells or closes a position.
 */
export function checkWhitelist(raw: RawFeedOrder, opts: WhitelistOptions = {}): WhitelistResult {
  const o = raw.order;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  if (raw.chainId !== undefined && raw.chainId !== BASE_CHAIN_ID) {
    return reject('wrong-chain', `Order is for chain ${raw.chainId}. Odette trades on Base (${BASE_CHAIN_ID}) only.`);
  }

  // filterOrdersForDailyBook (config.js:387). Hourly binaries use the spread implementations.
  if (raw.feedProduct === 'hourly_binary') {
    return reject('hourly-binary', 'Order is an hourly binary. Odette does not list hourly binaries.');
  }

  const product = productForImplementation(o.implementation);
  if (product === null || !isProductEnabled(product, opts)) {
    return reject('unsupported-implementation', `Order type is not supported by Odette. Implementation ${o.implementation}.`);
  }

  if (o.collateral.toLowerCase() !== USDC.address.toLowerCase()) {
    return reject('wrong-collateral', 'Order collateral is not USDC.');
  }

  const underlying = marketForPriceFeed(o.priceFeed);
  const isSpread = product === 'CALL_SPREAD' || product === 'PUT_SPREAD';
  if (underlying === null || (isSpread && !SPREAD_MARKETS.includes(underlying))) {
    return reject('unknown-market', `Price feed ${o.priceFeed} is not an Odette market.`);
  }

  if (!strikesMatch(product, o.strikes)) {
    return reject('bad-strikes', 'Order strikes do not match the option type.');
  }

  if (!callFlagMatches(product, o.isCall)) {
    return reject('bad-call-flag', 'Order call/put flag does not match the option type.');
  }

  if (o.isLong !== false) {
    return reject('wrong-side', 'Order is a maker bid. Odette buys options only.');
  }

  const optionBook = getAddress(raw.optionBookAddress ?? OPTION_BOOK_R12);
  if (!KNOWN_BOOKS.has(optionBook.toLowerCase())) {
    return reject('unknown-option-book', `This order belongs to OptionBook ${optionBook}, which this tool does not support.`);
  }

  if (o.price <= 0n) {
    return reject('invalid-price', 'Order price is zero.');
  }

  if (o.maxCollateralUsable <= 0n) {
    return reject('no-liquidity', 'Order has no collateral to fill against.');
  }

  if (opts.ignoreTime === true) {
    return { ok: true, order: toOdetteOrder(raw, product, underlying, optionBook) };
  }

  // isDailyBookExpiry (config.js:381) and the 1/2/3-day tabs (EXPIRY_FILTER_LIMITS).
  const toExpiry = Number(o.expiry) - now;
  if (Number(o.expiry % 86400n) !== EXPIRY_UTC_SECOND_OF_DAY) {
    return reject('not-daily-expiry', 'Order expiry is not 08:00 UTC. Odette lists daily expiries only.');
  }
  if (toExpiry < MIN_SECONDS_TO_EXPIRY || toExpiry > MAX_SECONDS_TO_EXPIRY) {
    return reject('expiry-out-of-range', 'Order expiry is outside the Odette book (1 hour to 3 days from now).');
  }

  if (!isMarketOpen(underlying, now)) {
    return reject('market-closed', `${underlying} does not trade today on Odette.`);
  }

  if (Number(o.orderExpiryTimestamp) - now < MIN_SECONDS_TO_ORDER_EXPIRY) {
    return reject('order-expiring', 'Order has expired. Fetch orders again.');
  }

  return { ok: true, order: toOdetteOrder(raw, product, underlying, optionBook) };
}

/** Split feed orders into accepted Odette orders and rejected ones with their reason. */
export function filterWhitelisted(
  raws: readonly RawFeedOrder[],
  opts: WhitelistOptions = {}
): { accepted: OdetteOrder[]; rejected: Array<{ raw: RawFeedOrder; reason: RejectReason; message: string }> } {
  const accepted: OdetteOrder[] = [];
  const rejected: Array<{ raw: RawFeedOrder; reason: RejectReason; message: string }> = [];
  const fixed = { ...opts, now: opts.now ?? Math.floor(Date.now() / 1000) };
  for (const raw of raws) {
    const result = checkWhitelist(raw, fixed);
    if (result.ok) accepted.push(result.order);
    else rejected.push({ raw, reason: result.reason, message: result.message });
  }
  return { accepted, rejected };
}

/**
 * Re-run every whitelist and book rule on an order the SDK already returned,
 * at a given time (for example the latest block). Used right before a fill.
 */
export function recheckOrder(order: OdetteOrder, opts: WhitelistOptions = {}): WhitelistResult {
  const r = order.rawApiData;
  const raw: RawFeedOrder = {
    order: {
      maker: order.order.maker,
      // The exact signed value; rawApiData's number can round above 2^53.
      orderExpiryTimestamp: order.orderExpiryTimestamp ?? BigInt(r.orderExpiryTimestamp),
      collateral: r.collateral,
      isCall: r.isCall,
      priceFeed: r.priceFeed,
      implementation: r.implementation,
      isLong: r.isLong,
      maxCollateralUsable: BigInt(r.maxCollateralUsable),
      strikes: r.strikes.map((s) => BigInt(s)),
      expiry: order.order.expiry,
      price: order.order.price,
      extraOptionData: r.extraOptionData,
    },
    signature: order.signature,
    ...(r.optionBookAddress !== undefined ? { optionBookAddress: r.optionBookAddress } : {}),
  };
  return checkWhitelist(raw, opts);
}
