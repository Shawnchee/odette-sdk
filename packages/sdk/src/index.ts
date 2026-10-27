// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Public entry point of @thetanuts-finance/odette-sdk.

export {
  BASE_CHAIN_ID,
  ODETTE_REFERRER,
  OPTION_BOOK_R12,
  KNOWN_OPTION_BOOKS,
  USDC,
  MULTICALL_ADDRESS,
  DEFAULT_FEED_URL,
  PRICE_DECIMALS,
} from './chain.js';
export { OPTION_BOOK_ABI, ORDER_COMPONENTS } from './abi/optionBook.js';
export { ERC20_ABI } from './abi/erc20.js';
export { OdetteError, isOdetteError, createError, mapContractError, type OdetteErrorCode } from './errors.js';
export { Logger, noopLogger, consoleLogger, type OdetteLogger } from './logger.js';
export type {
  ProductKind,
  SignedOrderStruct,
  RawFeedOrder,
  OdetteOrder,
  Order,
  OrderWithSignature,
  OdetteRawOrderData,
  ContractOrder,
} from './types.js';
export { OdetteClient, type OdetteClientConfig } from './client.js';
export { buildChainConfig, type OdetteChainConfig, type TokenConfig, type OptionImplementationInfo } from './chainConfig.js';
export { OptionBookModule, MAX_FILL_GAS, type FillPreview, type CheckResult, type CheckOptions, type OrderFilledEvent } from './modules/optionBook.js';
export { ERC20Module } from './modules/erc20.js';
export { APIModule } from './modules/api.js';
export { UtilsModule } from './modules/utils.js';
export { toBigInt, fromBigInt } from './utils/decimals.js';
export { toOdetteOrder } from './normalize.js';
export {
  IMPLEMENTATIONS,
  HIDDEN_PRODUCTS,
  MARKETS,
  SPREAD_MARKETS,
  MARKET_DAYS,
  EXPIRY_UTC_SECOND_OF_DAY,
  MIN_SECONDS_TO_EXPIRY,
  MAX_SECONDS_TO_EXPIRY,
  MIN_SECONDS_TO_ORDER_EXPIRY,
  isMarketOpen,
  checkWhitelist,
  recheckOrder,
  filterWhitelisted,
  productForImplementation,
  marketForPriceFeed,
  isProductEnabled,
  type WhitelistOptions,
  type WhitelistResult,
  type RejectReason,
} from './whitelist.js';
export {
  collateralPerContract,
  sizeStep,
  maxContracts,
  minContracts,
  MIN_PREMIUM_USDC,
  quantum,
  collateralForContracts,
  maxPayoutForContracts,
  premiumForContracts,
  contractsForUsdc,
  checkSize,
  roundToStep,
} from './sizing.js';
export {
  parseFeed,
  fetchFeed,
  fetchOrders,
  fetchOrdersRaw,
  fetchMarketData,
  type FeedOptions,
  type FeedRead,
  type MalformedFeedEntry,
} from './feed.js';
