// Base addresses taken from thetanuts-sdk src/chains/index.ts (Base block) at
// 9e72aef1ab5c008ccc92352fa5048bd08c452ede and checked against thetaverse
// odette/config.js at origin/dev 5c3f2b0639ce07a134a0f82b7df8113dea1e744b.
// MIT License, Copyright (c) 2026 Thetanuts Finance.

/** Base mainnet. The SDK supports no other chain. */
export const BASE_CHAIN_ID = 8453;

/**
 * Odette's referrer. Every fill this SDK builds passes this address to
 * `OptionBook.fillOrder`. It is a constant: no option, env var or config key
 * changes it.
 */
export const ODETTE_REFERRER = '0x94D784e81A5c8cA6E19629C73217b61a256Ea1c7' as const;

/** Thetanuts OptionBook, release r12 on Base. */
export const OPTION_BOOK_R12 = '0x1bDff855d6811728acaDC00989e79143a2bdfDed' as const;

/** OptionBook releases this SDK fills against. An order for any other book is refused. */
export const KNOWN_OPTION_BOOKS: readonly string[] = [OPTION_BOOK_R12];

/** USDC on Base. The only collateral Odette accepts. */
export const USDC = {
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  symbol: 'USDC',
  decimals: 6,
} as const;

/** Multicall used by the Odette web app (thetaverse odette/config.js). */
export const MULTICALL_ADDRESS = '0xfEE958Fa595B4478cea7560C91400A98b83d6C91' as const;

/** Thetanuts order feed that the Odette web app reads today. */
export const DEFAULT_FEED_URL = 'https://round-snowflake-9c31.devops-118.workers.dev/';

/** `price` and `strikes` are USD with 8 decimals. */
export const PRICE_DECIMALS = 8;
