// Adapted from thetanuts-sdk cli/src/bookOrderIdentity.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Changes: adds findSameInstrument. Odette re-signs every order about once a
// minute (2026-10-27: all 400 instruments re-signed within 75 s, 397 with a new
// price), so a signature match aborts most interactive fills.
import type { OdetteOrder as OrderWithSignature } from '@thetanuts-finance/odette-sdk';

/**
 * Find the exact signed order in a refreshed book.
 *
 * Odette reuses a nonce across batches of orders, so `(maker, nonce)` is not a
 * unique identity. The EIP-712 signature commits to the complete order and is
 * stable when list indices move or available liquidity changes.
 */
export function findSignedOrder(
  orders: OrderWithSignature[],
  reference: OrderWithSignature
): OrderWithSignature | undefined {
  const maker = reference.order.maker.toLowerCase();
  const signature = reference.signature.toLowerCase();
  return orders.find(
    (candidate) =>
      candidate.order.maker.toLowerCase() === maker &&
      candidate.signature.toLowerCase() === signature
  );
}

/**
 * Find the same instrument in a refreshed book, whatever its current quote.
 *
 * Identity follows the Odette web app's getOrderSelectionKey (config.js:297-303)
 * plus the maker: implementation, strikes, expiry, call/put, price feed and
 * collateral. The quote (price, signature, quote expiry) may differ; the caller
 * must compare terms and re-confirm. When several quotes match, the cheapest wins.
 */
export function findSameInstrument(
  orders: OrderWithSignature[],
  reference: OrderWithSignature
): OrderWithSignature | undefined {
  const key = (o: OrderWithSignature): string => {
    const r = o.rawApiData;
    return [
      o.order.maker.toLowerCase(),
      r?.implementation.toLowerCase(),
      (r?.strikes ?? []).join(','),
      o.order.expiry.toString(),
      r?.isCall ? '1' : '0',
      r?.priceFeed.toLowerCase(),
      r?.collateral.toLowerCase(),
      // Part of the signed terms (option parameters and nonce), so a quote
      // with different extra data is a different instrument.
      (r?.extraOptionData ?? '0x').toLowerCase(),
    ].join(':');
  };
  const want = key(reference);
  const matches = orders.filter((o) => key(o) === want);
  if (matches.length === 0) return undefined;
  return matches.reduce((best, o) => (o.order.price < best.order.price ? o : best));
}
