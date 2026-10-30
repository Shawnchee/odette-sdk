// Adapted from thetanuts-sdk cli/src/defaults.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Changes: comments.
/**
 * Single source of truth for CLI defaults. Bump these here, not at call sites.
 *
 * The CLI is Base-only by design (chainId 8453). Keep this aligned with the
 * SDK (`@odette-fi/sdk`) — see `src/chain.ts` there for
 * addresses and tokens.
 *
 * The default RPC is PUBLIC and shared — fine for read-only smoke and
 * onboarding, but will rate-limit under load. Users should override via
 * ODETTE_RPC_URL or `odette config set rpcUrl <url>` for any serious
 * usage.
 */
export const DEFAULT_CHAIN_ID = 8453; // Base mainnet
export const DEFAULT_RPC_URL = 'https://mainnet.base.org';
