// Copyright (c) 2026 Thetanuts Finance. MIT License.
// The chain-config view the CLI reads (field names as in thetanuts-sdk
// src/chains/index.ts ChainConfig), built for Base and Odette's products only.

import { BASE_CHAIN_ID, OPTION_BOOK_R12, USDC } from './chain.js';
import { IMPLEMENTATIONS, MARKETS, isProductEnabled, type WhitelistOptions } from './whitelist.js';
import type { ProductKind } from './types.js';

export interface TokenConfig {
  address: string;
  symbol: string;
  decimals: number;
}

export interface OptionImplementationInfo {
  name: string;
  type: 'VANILLA' | 'SPREAD' | 'RANGER';
  numStrikes: number;
}

export interface OdetteChainConfig {
  chainId: typeof BASE_CHAIN_ID;
  name: 'Base';
  nativeCurrency: 'ETH';
  explorerUrl: string;
  contracts: { optionBook: string };
  /** USDC only: Odette accepts no other collateral. */
  tokens: Record<string, TokenConfig>;
  /** Odette markets: symbol -> price feed. */
  priceFeeds: Record<string, string>;
  /** Enabled products only: name -> implementation. */
  implementations: Partial<Record<ProductKind, string>>;
  /** Enabled products only, keyed by lowercase implementation address. */
  optionImplementations: Record<string, OptionImplementationInfo>;
  defaultRpcUrls: string[];
}

const INFO: Record<ProductKind, OptionImplementationInfo> = {
  PUT: { name: 'PUT', type: 'VANILLA', numStrikes: 1 },
  LINEAR_CALL: { name: 'LINEAR_CALL', type: 'VANILLA', numStrikes: 1 },
  RANGER: { name: 'RANGER', type: 'RANGER', numStrikes: 4 },
  CALL_SPREAD: { name: 'CALL_SPREAD', type: 'SPREAD', numStrikes: 2 },
  PUT_SPREAD: { name: 'PUT_SPREAD', type: 'SPREAD', numStrikes: 2 },
};

export function buildChainConfig(opts: WhitelistOptions = {}): OdetteChainConfig {
  const implementations: Partial<Record<ProductKind, string>> = {};
  const optionImplementations: Record<string, OptionImplementationInfo> = {};
  for (const [kind, address] of Object.entries(IMPLEMENTATIONS) as Array<[ProductKind, string]>) {
    if (!isProductEnabled(kind, opts)) continue;
    implementations[kind] = address;
    optionImplementations[address.toLowerCase()] = INFO[kind];
  }
  return {
    chainId: BASE_CHAIN_ID,
    name: 'Base',
    nativeCurrency: 'ETH',
    explorerUrl: 'https://basescan.org',
    contracts: { optionBook: OPTION_BOOK_R12 },
    tokens: { USDC: { ...USDC } },
    priceFeeds: { ...MARKETS },
    implementations,
    optionImplementations,
    defaultRpcUrls: ['https://mainnet.base.org'],
  };
}
