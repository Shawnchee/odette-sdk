// Adapted from thetanuts-sdk src/modules/api.ts normalizeOdetteOrder (:1026-1098)
// at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Changes: input is a type-checked RawFeedOrder, so no field falls back to 0
// or "". underlyingToken is left out: upstream maps BTC to a wrong token and
// every other market to the zero address. greeks are dropped. The exact
// orderExpiryTimestamp is kept as a bigint on OdetteOrder.

import { ZeroAddress } from 'ethers';
import type { OdetteOrder, Order, OdetteRawOrderData, ProductKind, RawFeedOrder } from './types.js';

/** Build the upstream OrderWithSignature shape for an order that passed the whitelist. */
export function toOdetteOrder(
  raw: RawFeedOrder,
  product: ProductKind,
  underlying: string,
  optionBook: string
): OdetteOrder {
  const o = raw.order;
  const strikes = o.strikes.map((s) => s.toString());

  const order: Order = {
    maker: o.maker,
    taker: ZeroAddress, // Odette doesn't have taker
    option: '', // Option address not provided in API, will be created on fill
    isBuyer: !o.isLong, // isLong=true means maker sells, so taker buys
    numContracts: 0n, // the taker sets numContracts at fill time
    price: o.price,
    expiry: o.expiry,
    ...(raw.nonce !== undefined && /^0x[0-9a-fA-F]+$|^[0-9]+$/.test(raw.nonce) ? { nonce: BigInt(raw.nonce) } : {}),
    optionType: o.isCall ? 0 : 1, // 0 = call, 1 = put
    strikes: [...o.strikes],
    strikePrice: o.strikes[0]!,
    collateralToken: o.collateral,
    deadline: o.expiry,
  };

  const rawApiData: OdetteRawOrderData = {
    collateral: o.collateral,
    priceFeed: o.priceFeed,
    implementation: o.implementation,
    strikes,
    isCall: o.isCall,
    isLong: o.isLong,
    orderExpiryTimestamp: Number(o.orderExpiryTimestamp),
    extraOptionData: o.extraOptionData,
    maxCollateralUsable: o.maxCollateralUsable.toString(),
    ...(raw.optionBookAddress !== undefined ? { optionBookAddress: raw.optionBookAddress } : {}),
  };

  return {
    order,
    signature: raw.signature,
    availableAmount: o.maxCollateralUsable,
    makerAddress: o.maker,
    rawApiData,
    product,
    underlying,
    optionBook,
    orderExpiryTimestamp: o.orderExpiryTimestamp,
    ...(raw.ticker !== undefined ? { ticker: raw.ticker } : {}),
  };
}
