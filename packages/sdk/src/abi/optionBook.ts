// Adapted from thetanuts-sdk src/abis/optionBook.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Copied as-is. Do not add overloads (ethers drops the bare name of an overloaded method).

/**
 * OptionBook ABI - Complete contract interface
 * Source: /abi/OptionBook.json
 */

/**
 * Order struct components - reused across multiple functions
 */
const ORDER_COMPONENTS = [
  { name: 'maker', type: 'address', internalType: 'address' },
  { name: 'orderExpiryTimestamp', type: 'uint256', internalType: 'uint256' },
  { name: 'collateral', type: 'address', internalType: 'address' },
  { name: 'isCall', type: 'bool', internalType: 'bool' },
  { name: 'priceFeed', type: 'address', internalType: 'address' },
  { name: 'implementation', type: 'address', internalType: 'address' },
  { name: 'isLong', type: 'bool', internalType: 'bool' },
  { name: 'maxCollateralUsable', type: 'uint256', internalType: 'uint256' },
  { name: 'strikes', type: 'uint256[]', internalType: 'uint256[]' },
  { name: 'expiry', type: 'uint256', internalType: 'uint256' },
  { name: 'price', type: 'uint256', internalType: 'uint256' },
  { name: 'numContracts', type: 'uint256', internalType: 'uint256' },
  { name: 'extraOptionData', type: 'bytes', internalType: 'bytes' },
] as const;

export const OPTION_BOOK_ABI = [
  // ============ Constructor ============
  {
    type: 'constructor',
    inputs: [{ name: '_factory', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },

  // ============ View Functions ============
  {
    type: 'function',
    name: 'LIMIT_ORDER_TYPEHASH',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'PRICE_DECIMALS',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'amountFilled',
    inputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'computeNonce',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct OptionBook.Order',
        components: ORDER_COMPONENTS,
      },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'eip712Domain',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1', internalType: 'bytes1' },
      { name: 'name', type: 'string', internalType: 'string' },
      { name: 'version', type: 'string', internalType: 'string' },
      { name: 'chainId', type: 'uint256', internalType: 'uint256' },
      { name: 'verifyingContract', type: 'address', internalType: 'address' },
      { name: 'salt', type: 'bytes32', internalType: 'bytes32' },
      { name: 'extensions', type: 'uint256[]', internalType: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'factory',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract OptionFactory' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'fees',
    inputs: [
      { name: '', type: 'address', internalType: 'address' },
      { name: '', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hashOrder',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct OptionBook.Order',
        components: ORDER_COMPONENTS,
      },
    ],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'referrerFeeSplitBps',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  // r12-additive views
  {
    type: 'function',
    name: 'getValidNumContracts',
    inputs: [
      { name: 'implementation', type: 'address', internalType: 'address' },
      { name: 'strikes', type: 'uint256[]', internalType: 'uint256[]' },
      { name: 'desiredContracts', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [
      {
        name: 'result',
        type: 'tuple',
        internalType: 'struct OptionBook.ValidContractsResult',
        components: [
          { name: 'validContracts', type: 'uint256', internalType: 'uint256' },
          { name: 'collateralRequired', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'makerCancellationCutoff',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'minNumContracts',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'minPremiumAmount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },

  // ============ Write Functions ============
  {
    type: 'function',
    name: 'cancelOrder',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct OptionBook.Order',
        components: ORDER_COMPONENTS,
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // r12-additive writes (user-facing batch + cutoff cancellation)
  {
    type: 'function',
    name: 'cancelOrders',
    inputs: [
      {
        name: 'orders',
        type: 'tuple[]',
        internalType: 'struct OptionBook.Order[]',
        components: ORDER_COMPONENTS,
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'cancelOrdersExpiringBefore',
    inputs: [{ name: 'cutoffTimestamp', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimFees',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'fillOrder',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct OptionBook.Order',
        components: ORDER_COMPONENTS,
      },
      { name: 'signature', type: 'bytes', internalType: 'bytes' },
      { name: 'referrer', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: 'optionAddress', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setReferrerFeeSplit',
    inputs: [
      { name: 'referrer', type: 'address', internalType: 'address' },
      { name: 'feeBps', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'swapAndFillOrder',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct OptionBook.Order',
        components: ORDER_COMPONENTS,
      },
      { name: 'signature', type: 'bytes', internalType: 'bytes' },
      { name: 'swapRouter', type: 'address', internalType: 'address' },
      { name: 'swapSrcToken', type: 'address', internalType: 'address' },
      { name: 'swapSrcAmount', type: 'uint256', internalType: 'uint256' },
      { name: 'swapData', type: 'bytes', internalType: 'bytes' },
      { name: 'referrer', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: 'optionAddress', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'sweepProtocolFees',
    inputs: [{ name: 'token', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },

  // ============ Events ============
  {
    type: 'event',
    name: 'EIP712DomainChanged',
    inputs: [],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FeesClaimed',
    inputs: [
      { name: 'recipient', type: 'address', indexed: true, internalType: 'address' },
      { name: 'token', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OrderCancelled',
    inputs: [
      { name: 'nonce', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'maker', type: 'address', indexed: true, internalType: 'address' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OrderFilled',
    inputs: [
      { name: 'nonce', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'buyer', type: 'address', indexed: true, internalType: 'address' },
      { name: 'seller', type: 'address', indexed: true, internalType: 'address' },
      { name: 'optionAddress', type: 'address', indexed: false, internalType: 'address' },
      { name: 'premiumAmount', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'feeCollected', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'referrer', type: 'address', indexed: false, internalType: 'address' },
      { name: 'referralFeePaid', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'sellerWasMaker', type: 'bool', indexed: false, internalType: 'bool' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ReferralFeePaid',
    inputs: [
      { name: 'referrer', type: 'address', indexed: true, internalType: 'address' },
      { name: 'collateral', type: 'address', indexed: true, internalType: 'address' },
      { name: 'fee', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'optionAddress', type: 'address', indexed: false, internalType: 'address' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ReferrerFeeSplitUpdated',
    inputs: [
      { name: 'referrer', type: 'address', indexed: true, internalType: 'address' },
      { name: 'feeBps', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  // r12-additive event
  {
    type: 'event',
    name: 'MakerCutoffUpdated',
    inputs: [
      { name: 'maker', type: 'address', indexed: true, internalType: 'address' },
      { name: 'oldCutoff', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'newCutoff', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },

  // ============ Errors ============
  { type: 'error', name: 'InvalidPriceFeedDecimals', inputs: [] },
  { type: 'error', name: 'InvalidShortString', inputs: [] },
  { type: 'error', name: 'PriceFeedStale', inputs: [] },
  { type: 'error', name: 'PriceMustBePositive', inputs: [] },
  {
    type: 'error',
    name: 'StringTooLong',
    inputs: [{ name: 'str', type: 'string', internalType: 'string' }],
  },
] as const;

// Export the order components for use in types
export { ORDER_COMPONENTS };
