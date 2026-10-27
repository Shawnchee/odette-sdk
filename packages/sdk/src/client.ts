// Adapted from thetanuts-sdk src/client/ThetanutsClient.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Kept: chainId, chainConfig, provider, signer, logger, referrer, erc20,
// optionBook, api, utils, hasSigner, requireSigner, getSignerAddress,
// assertNetwork, getCurrentTimestamp.
// Odette changes: Base only; the referrer is the constant ODETTE_REFERRER and
// the constructor refuses a `referrer` option; no axios; no RFQ, loan, vault,
// event, websocket or pricing modules.

import type { Provider, Signer } from 'ethers';

import { BASE_CHAIN_ID, DEFAULT_FEED_URL, ODETTE_REFERRER } from './chain.js';
import { buildChainConfig, type OdetteChainConfig } from './chainConfig.js';
import { createError } from './errors.js';
import { Logger, noopLogger, type OdetteLogger } from './logger.js';
import { APIModule } from './modules/api.js';
import { ERC20Module } from './modules/erc20.js';
import { OptionBookModule } from './modules/optionBook.js';
import { UtilsModule } from './modules/utils.js';

export interface OdetteClientConfig {
  /** Base (8453). Kept for parity with ThetanutsClientConfig; any other value is refused. */
  chainId?: typeof BASE_CHAIN_ID;
  /** Provider connected to Base. */
  provider: Provider;
  /** Required for fills and approvals. */
  signer?: Signer;
  /** Default false. CALL_SPREAD and PUT_SPREAD stay hidden unless true. */
  enableSpreads?: boolean;
  /** Default: the Thetanuts order feed the Odette web app reads. */
  feedUrl?: string;
  logger?: OdetteLogger;
  /** Default: globalThis.fetch. For tests and custom transports. */
  fetch?: typeof fetch;
}

/**
 * Main client for trading Odette orders on Base.
 *
 * @example
 * ```typescript
 * const client = new OdetteClient({ provider, signer });
 * const orders = await client.api.fetchOrders();
 * const receipt = await client.optionBook.fillOrder(orders[0], 10_000000n);
 * ```
 */
export class OdetteClient {
  /** Chain ID (always Base, 8453) */
  public readonly chainId: typeof BASE_CHAIN_ID = BASE_CHAIN_ID;

  /** Chain configuration (Base, Odette products only) */
  public readonly chainConfig: OdetteChainConfig;

  /** Odette's referrer. Always ODETTE_REFERRER. Read only. */
  public readonly referrer: string = ODETTE_REFERRER;

  /** Ethers provider */
  public readonly provider: Provider;

  /** Ethers signer (optional) */
  public readonly signer: Signer | undefined;

  /** Logger instance */
  public readonly logger: Logger;

  /** Order feed URL */
  public readonly feedUrl: string;

  /** True when the hidden spread products are on */
  public readonly enableSpreads: boolean;

  /** fetch implementation for the feed (undefined = globalThis.fetch) */
  public readonly fetch: typeof fetch | undefined;

  /** ERC20 token operations */
  public readonly erc20: ERC20Module;

  /** OptionBook preview, checks and fills */
  public readonly optionBook: OptionBookModule;

  /** Order feed */
  public readonly api: APIModule;

  /** Decimal helpers */
  public readonly utils: UtilsModule;

  constructor(config: OdetteClientConfig) {
    this.validateConfig(config);

    this.provider = config.provider;
    this.signer = config.signer;
    this.logger = new Logger(config.logger ?? noopLogger);
    this.feedUrl = config.feedUrl ?? DEFAULT_FEED_URL;
    this.enableSpreads = config.enableSpreads === true;
    this.fetch = config.fetch;
    this.chainConfig = buildChainConfig({ enableSpreads: this.enableSpreads });

    Object.defineProperty(this, 'referrer', { value: ODETTE_REFERRER, writable: false, configurable: false });

    this.erc20 = new ERC20Module(this);
    this.optionBook = new OptionBookModule(this);
    this.api = new APIModule(this);
    this.utils = new UtilsModule();
  }

  private validateConfig(config: OdetteClientConfig): void {
    if (!config || !config.provider) {
      throw createError('INVALID_PARAMS', 'provider is required');
    }
    if (config.chainId !== undefined && config.chainId !== BASE_CHAIN_ID) {
      throw createError(
        'NETWORK_UNSUPPORTED',
        `Chain ID ${String(config.chainId)} is not supported. Odette trades on Base (${BASE_CHAIN_ID}) only.`
      );
    }
    if ('referrer' in (config as unknown as Record<string, unknown>)) {
      throw createError(
        'INVALID_PARAMS',
        `The Odette SDK has a fixed referrer (${ODETTE_REFERRER}). Remove the referrer option.`
      );
    }
  }

  /**
   * Check if signer is available
   */
  hasSigner(): boolean {
    return !!this.signer;
  }

  /**
   * Get the signer, throwing if not available
   */
  requireSigner(): Signer {
    if (!this.signer) {
      throw createError('SIGNER_REQUIRED', 'Signer is required for this operation');
    }
    return this.signer;
  }

  /**
   * Get the current signer address
   */
  async getSignerAddress(): Promise<string> {
    return this.requireSigner().getAddress();
  }

  /**
   * Verify the configured provider and signer provider are connected to Base.
   * Call before write operations.
   */
  async assertNetwork(): Promise<void> {
    const expected = BigInt(this.chainId);
    const providerNetwork = await this.provider.getNetwork();
    if (providerNetwork.chainId !== expected) {
      throw createError(
        'NETWORK_UNSUPPORTED',
        `Provider network mismatch: expected chain ${this.chainId}, got ${providerNetwork.chainId.toString()}`
      );
    }

    const signerProvider = this.signer?.provider;
    if (signerProvider) {
      const signerNetwork = await signerProvider.getNetwork();
      if (signerNetwork.chainId !== expected) {
        throw createError(
          'NETWORK_UNSUPPORTED',
          `Signer network mismatch: expected chain ${this.chainId}, got ${signerNetwork.chainId.toString()}`
        );
      }
    }
  }

  /**
   * Get the current timestamp from the blockchain.
   * Throws when the latest block cannot be read (upstream fell back to the
   * local clock; expiry checks must use chain time).
   */
  async getCurrentTimestamp(): Promise<number> {
    const block = await this.provider.getBlock('latest');
    if (!block) {
      throw createError('CONTRACT_REVERT', 'Could not read the latest block. Check the RPC URL.');
    }
    return block.timestamp;
  }
}
