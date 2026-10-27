// Adapted from thetanuts-sdk src/modules/api.ts (fetchOrders :144-160,
// normalizeOdetteOrder :1026-1098) at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Changes: uses fetch, not axios. Every field is type-checked; a malformed entry
// is reported, never filled in with 0 or "". Legacy Order fields are dropped.

import { getAddress, isAddress, isHexString } from 'ethers';
import { DEFAULT_FEED_URL } from './chain.js';
import { OdetteError } from './errors.js';
import { Logger, type OdetteLogger } from './logger.js';
import type { OdetteOrder, RawFeedOrder, SignedOrderStruct } from './types.js';
import { filterWhitelisted, type RejectReason, type WhitelistOptions } from './whitelist.js';

export interface FeedOptions extends WhitelistOptions {
  /** Default: the Thetanuts order feed the Odette web app reads. */
  feedUrl?: string;
  logger?: OdetteLogger;
  /** Default: globalThis.fetch. */
  fetch?: typeof fetch;
}

/** A feed entry that failed type validation. */
export interface MalformedFeedEntry {
  index: number;
  reason: string;
}

export interface FeedRead {
  orders: RawFeedOrder[];
  malformed: MalformedFeedEntry[];
}

class FieldError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(obj: Record<string, unknown>, name: string): unknown {
  if (!(name in obj) || obj[name] === undefined || obj[name] === null) {
    throw new FieldError(`missing ${name}`);
  }
  return obj[name];
}

function addressField(obj: Record<string, unknown>, name: string): string {
  const v = field(obj, name);
  if (typeof v !== 'string' || !isAddress(v)) throw new FieldError(`${name} is not an address`);
  return getAddress(v);
}

/** Accept a decimal string or a JSON number that is a safe integer. Never guess. */
function toUint(v: unknown, name: string): bigint {
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) return BigInt(v);
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  throw new FieldError(`${name} is not an unsigned integer`);
}

function uintField(obj: Record<string, unknown>, name: string): bigint {
  return toUint(field(obj, name), name);
}

function boolField(obj: Record<string, unknown>, name: string): boolean {
  const v = field(obj, name);
  if (typeof v !== 'boolean') throw new FieldError(`${name} is not a boolean`);
  return v;
}

/** Validate one feed entry. Throws FieldError on the first bad field. */
function parseEntry(raw: unknown): RawFeedOrder {
  if (!isRecord(raw)) throw new FieldError('entry is not an object');
  const o = field(raw, 'order');
  if (!isRecord(o)) throw new FieldError('order is not an object');

  const strikesRaw = field(o, 'strikes');
  if (!Array.isArray(strikesRaw) || strikesRaw.length === 0) throw new FieldError('strikes is not a non-empty array');
  const strikes = strikesRaw.map((s, i) => toUint(s, `strikes[${i}]`));

  // The web app sends "0x" when extraOptionData is absent (ui_interactions.js:5458).
  // Absent is allowed; a present value must be hex.
  const extra = o['extraOptionData'] ?? '0x';
  if (typeof extra !== 'string' || !isHexString(extra)) throw new FieldError('extraOptionData is not hex');

  const order: SignedOrderStruct = {
    maker: addressField(o, 'maker'),
    orderExpiryTimestamp: uintField(o, 'orderExpiryTimestamp'),
    collateral: addressField(o, 'collateral'),
    isCall: boolField(o, 'isCall'),
    priceFeed: addressField(o, 'priceFeed'),
    implementation: addressField(o, 'implementation'),
    isLong: boolField(o, 'isLong'),
    maxCollateralUsable: uintField(o, 'maxCollateralUsable'),
    strikes,
    expiry: uintField(o, 'expiry'),
    price: uintField(o, 'price'),
    extraOptionData: extra,
  };

  const signature = field(raw, 'signature');
  if (typeof signature !== 'string' || !isHexString(signature) || signature.length <= 2) {
    throw new FieldError('signature is not hex');
  }

  const entry: RawFeedOrder = { order, signature };

  if (raw['chainId'] != null) {
    if (typeof raw['chainId'] !== 'number' || !Number.isSafeInteger(raw['chainId'])) {
      throw new FieldError('chainId is not an integer');
    }
    entry.chainId = raw['chainId'];
  }
  if (raw['optionBookAddress'] != null) {
    entry.optionBookAddress = addressField(raw, 'optionBookAddress');
  }
  if (typeof raw['nonce'] === 'string') entry.nonce = raw['nonce'];
  if (typeof o['ticker'] === 'string') entry.ticker = o['ticker'];
  if (o['product'] != null) {
    if (typeof o['product'] !== 'string') throw new FieldError('product is not a string');
    entry.feedProduct = o['product'];
  }

  return entry;
}

/**
 * Validate a parsed feed body. Accepts `{ data: { orders } }` or `{ orders }`.
 * Throws FEED_INVALID when there is no orders array. Bad entries are returned
 * in `malformed`, not dropped silently.
 */
export function parseFeed(body: unknown): FeedRead {
  const list = isRecord(body)
    ? isRecord(body['data']) && Array.isArray(body['data']['orders'])
      ? body['data']['orders']
      : Array.isArray(body['orders'])
        ? body['orders']
        : null
    : null;
  if (list === null) {
    throw new OdetteError('FEED_INVALID', 'Order feed response has no orders list. Check feedUrl, or try again later.');
  }

  const orders: RawFeedOrder[] = [];
  const malformed: MalformedFeedEntry[] = [];
  list.forEach((entry, index) => {
    try {
      orders.push(parseEntry(entry));
    } catch (error) {
      if (!(error instanceof FieldError)) throw error;
      malformed.push({ index, reason: error.message });
    }
  });
  return { orders, malformed };
}

/** GET the feed URL. Throws HTTP_ERROR on a network failure or a non-2xx status. */
async function getFeed(url: string, doFetch: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await doFetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    throw new OdetteError('HTTP_ERROR', `Order feed request failed: ${String(error)}. Check your network, or set feedUrl.`, error, { url });
  }
  if (!response.ok) {
    throw new OdetteError('HTTP_ERROR', `Order feed returned HTTP ${response.status}. Try again later, or set feedUrl.`, undefined, {
      url,
      status: response.status,
    });
  }
  return response;
}

async function readFeedBody(response: Response, url: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new OdetteError('FEED_INVALID', 'Order feed did not return JSON. Check feedUrl.', error, { url });
  }
}

/**
 * Market prices from the same feed body (`data.market_data`). Only numeric,
 * positive prices are returned; a missing asset is absent, never 0.
 */
export async function fetchMarketData(opts: FeedOptions = {}): Promise<{ prices: Record<string, number> }> {
  const url = opts.feedUrl ?? DEFAULT_FEED_URL;
  const body = await readFeedBody(await getFeed(url, opts.fetch ?? globalThis.fetch), url);
  const md = isRecord(body) && isRecord(body['data']) && isRecord(body['data']['market_data']) ? body['data']['market_data'] : {};
  const prices: Record<string, number> = {};
  for (const [k, v] of Object.entries(md)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) prices[k] = v;
  }
  return { prices };
}

/** GET the feed and validate it. No whitelist is applied. */
export async function fetchFeed(opts: FeedOptions = {}): Promise<FeedRead> {
  const url = opts.feedUrl ?? DEFAULT_FEED_URL;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const log = new Logger(opts.logger);
  log.debug('Fetching orders from the order feed', { url });

  const response = await getFeed(url, doFetch);
  const body = await readFeedBody(response, url);
  const read = parseFeed(body);
  if (read.malformed.length > 0) {
    log.warn('Order feed entries failed validation and were skipped', { count: read.malformed.length, malformed: read.malformed });
  }
  return read;
}

/**
 * Every well-formed feed order, before Odette's whitelist. For diagnostics only.
 * Never fill from this list; use fetchOrders.
 */
export async function fetchOrdersRaw(opts: FeedOptions = {}): Promise<RawFeedOrder[]> {
  return (await fetchFeed(opts)).orders;
}

/**
 * Fetch the feed and return the orders the Odette web app shows now. Each
 * refused order is counted by reason and logged at warn. On-chain checks
 * (maker funding, amount filled) are not done here.
 */
export async function fetchOrders(opts: FeedOptions = {}): Promise<OdetteOrder[]> {
  const { orders } = await fetchFeed(opts);
  const { accepted, rejected } = filterWhitelisted(orders, opts);
  if (rejected.length > 0) {
    const byReason: Partial<Record<RejectReason, number>> = {};
    for (const r of rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
    new Logger(opts.logger).warn('Order feed entries are not Odette orders and were skipped', { count: rejected.length, byReason });
  }
  return accepted;
}
