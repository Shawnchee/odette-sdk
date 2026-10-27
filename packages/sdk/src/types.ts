// Adapted from thetanuts-sdk src/types/optionBook.ts (ContractOrder, Order) and
// src/types/api.ts (OdetteRawOrderData, OrderWithSignature) at
// 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Trimmed to the order shape the Odette feed sends. OdetteOrder and
// RawFeedOrder are Odette additions.

/** Products the SDK knows. CALL_SPREAD and PUT_SPREAD are hidden unless enabled. */
export type ProductKind = 'PUT' | 'LINEAR_CALL' | 'RANGER' | 'CALL_SPREAD' | 'PUT_SPREAD';

/**
 * Contract Order structure for OptionBook contract (v2)
 * This matches the on-chain struct exactly
 */
export interface ContractOrder {
  /** Maker address */
  maker: string;
  /** Order expiry timestamp (when the order itself expires, not the option) */
  orderExpiryTimestamp: bigint;
  /** Collateral token address (USDC, WETH, etc.) */
  collateral: string;
  /** Whether this is a call option (true) or put option (false) */
  isCall: boolean;
  /** Price feed address for the underlying asset */
  priceFeed: string;
  /** Implementation address (determines product type: spread, butterfly, condor) */
  implementation: string;
  /** Whether maker is long (true = maker sells to taker, false = maker buys from taker) */
  isLong: boolean;
  /** Maximum collateral that can be used for this order */
  maxCollateralUsable: bigint;
  /** Strike prices array (8 decimals) */
  strikes: bigint[];
  /** Option expiry timestamp */
  expiry: bigint;
  /** Price per contract (8 decimals) */
  price: bigint;
  /** Number of contracts to fill (6 decimals for USDC collateral) */
  numContracts: bigint;
  /** Extra option data (usually "0x") */
  extraOptionData: string;
}

/**
 * Order structure used in SDK (simplified view)
 * Contains the essential fields for display and basic operations
 */
export interface Order {
  /** Maker address */
  maker: string;
  /** Taker address (zero address for any taker) */
  taker: string;
  /** Option contract address (empty before fill, populated after) */
  option: string;
  /** Whether maker is buyer (true) or seller (false) from taker's perspective */
  isBuyer: boolean;
  /** Number of contracts */
  numContracts: bigint;
  /** Price per contract in collateral token units (8 decimals) */
  price: bigint;
  /** Option expiry timestamp */
  expiry: bigint;
  /**
   * Feed-provided nonce, for display only. Absent when the feed omits it
   * (upstream used 0n; a missing value is not zero). The chain nonce comes
   * from OptionBook.computeNonce.
   */
  nonce?: bigint;
  /** Option type (0 = call, 1 = put) */
  optionType?: number;
  /**
   * All strike prices in 8 decimals.
   * Array length indicates product type:
   * - 1 strike: vanilla (put/call)
   * - 2 strikes: spread
   * - 4 strikes: ranger
   */
  strikes?: bigint[];
  /**
   * @deprecated Use `strikes[0]` instead. This field only contains the first strike.
   * Strike price in 8 decimals
   */
  strikePrice?: bigint;
  /** Collateral token address */
  collateralToken?: string;
  /** Underlying token address */
  underlyingToken?: string;
  /** Order deadline timestamp */
  deadline?: bigint;
}

export interface OdetteRawOrderData {
  /** Collateral token address */
  collateral: string;
  /** Price feed address (BTC or ETH) */
  priceFeed: string;
  /** Implementation address (determines product type) */
  implementation: string;
  /** Strike prices (8 decimals) */
  strikes: string[];
  /** Is call option */
  isCall: boolean;
  /** Is long position (maker is selling) */
  isLong: boolean;
  /** Order expiry timestamp */
  orderExpiryTimestamp: number;
  /** Extra option data */
  extraOptionData: string;
  /** Max collateral usable */
  maxCollateralUsable: string;
  /** OptionBook contract address the order was signed for */
  optionBookAddress?: string;
}

/**
 * Order with signature for API responses
 */
export interface OrderWithSignature {
  /** Order data */
  order: Order;
  /** Maker's signature */
  signature: string;
  /** Available amount to fill */
  availableAmount: bigint;
  /** Maker address (convenience) */
  makerAddress: string;
  /** Raw data from Odette API for filtering */
  rawApiData?: OdetteRawOrderData;
}

/** A feed order that passed Odette's whitelist. Every SDK fill takes one of these. */
export interface OdetteOrder extends OrderWithSignature {
  rawApiData: OdetteRawOrderData;
  /** Product, from the implementation address */
  product: ProductKind;
  /** Underlying symbol, from the price feed (for example "ETH") */
  underlying: string;
  /** OptionBook to send the fill to */
  optionBook: string;
  /** Feed-provided ticker (display only, never used for logic) */
  ticker?: string;
}

/**
 * The signed OptionBook order struct, typed, as the feed sends it.
 * Field order matches `OptionBook.Order` on chain, minus `numContracts`,
 * which the taker sets at fill time.
 */
export interface SignedOrderStruct {
  maker: string;
  orderExpiryTimestamp: bigint;
  collateral: string;
  isCall: boolean;
  priceFeed: string;
  implementation: string;
  /** false = maker sells to the taker (an ask). true = maker buys (a bid). */
  isLong: boolean;
  maxCollateralUsable: bigint;
  /** USD, 8 decimals */
  strikes: bigint[];
  expiry: bigint;
  /** Premium per contract, USD, 8 decimals */
  price: bigint;
  extraOptionData: string;
}

/** One feed entry after type validation. Not yet checked against Odette's rules. */
export interface RawFeedOrder {
  order: SignedOrderStruct;
  /** Maker's EIP-712 signature */
  signature: string;
  /** Chain the feed says the order is for, when sent */
  chainId?: number;
  /** OptionBook the order was signed for, when sent */
  optionBookAddress?: string;
  /** Feed-provided nonce (informational) */
  nonce?: string;
  /** Feed-provided ticker (display only, never used for logic) */
  ticker?: string;
  /** Feed-provided product tag, for example "hourly_binary". Odette drops hourly binaries. */
  feedProduct?: string;
}
