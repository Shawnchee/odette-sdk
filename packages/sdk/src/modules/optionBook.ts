// Adapted from thetanuts-sdk src/modules/optionBook.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Kept: buildContractOrder, calculateMaxContracts, previewFillOrder, fillOrder,
// encodeFillOrder, getReferrerFeeSplit, getAmountFilled, computeNonce.
// Odette changes:
// - The referrer is always ODETTE_REFERRER. No method takes a referrer argument.
//   Upstream fell back to ZeroAddress (:383, :484, :579).
// - Sizing comes from sizing.ts (per-implementation collateral, step, 0.50 USDC
//   minimum). Upstream's calculateMaxContracts has no RANGER case (:249-324).
// - previewFillOrder reports the premium of the contracts it will fill, not the
//   requested amount (upstream :382 echoed the request).
// - checkFill runs the pre-send checks; fillOrder refuses to send when one fails.
// - The target OptionBook is the order's book when it is a known release
//   (upstream :137-151 accepted only the configured book; today both are r12).
// - fillOrder takes an optional onSent callback that gets the tx hash at broadcast.
// Dropped: RFQ, claim, swapAndFillOrder, cancel, admin and callStatic helpers.

import { Contract, Interface } from 'ethers';
import type { TransactionReceipt, ContractTransactionResponse } from 'ethers';

import type { OdetteClient } from '../client.js';
import { OPTION_BOOK_ABI } from '../abi/optionBook.js';
import { ERC20_ABI } from '../abi/erc20.js';
import { BASE_CHAIN_ID, KNOWN_OPTION_BOOKS, ODETTE_REFERRER, USDC } from '../chain.js';
import { createError, mapContractError } from '../errors.js';
import {
  checkSize,
  collateralForContracts,
  contractsForUsdc,
  maxContracts,
  minContracts,
  premiumForContracts,
  sizeStep,
} from '../sizing.js';
import type { ContractOrder, OdetteOrder, ProductKind } from '../types.js';
import { recheckOrder } from '../whitelist.js';
import { fromBigInt } from '../utils/decimals.js';
import { validateAddress } from '../utils/validation.js';

/** Refuse a fill whose gas estimate is above this (PRD check 13, placeholder bound). */
export const MAX_FILL_GAS = 2_000_000n;

/**
 * Interface for OptionBook contract methods (v2)
 */
interface OptionBookContract {
  fillOrder: {
    (order: ContractOrder, signature: string, referrer: string): Promise<ContractTransactionResponse>;
    (order: ContractOrder, signature: string, referrer: string, overrides: { gasLimit: bigint }): Promise<ContractTransactionResponse>;
    estimateGas(order: ContractOrder, signature: string, referrer: string): Promise<bigint>;
  };
  amountFilled(nonce: bigint): Promise<bigint>;
  referrerFeeSplitBps(referrer: string): Promise<bigint>;
  computeNonce(order: ContractOrder): Promise<bigint>;
}

interface ERC20Reads {
  allowance(owner: string, spender: string): Promise<bigint>;
  balanceOf(account: string): Promise<bigint>;
}

/** Result of previewFillOrder. Same fields as upstream, plus Odette sizing. */
export interface FillPreview {
  numContracts: bigint;
  maxContracts: bigint;
  /** Smallest valid size (0.50 USDC premium). */
  minContracts: bigint;
  /** Size increment the chain accepts. */
  step: bigint;
  collateralToken: string;
  pricePerContract: bigint;
  /** Premium the taker pays for numContracts, USDC 6 dp (OptionBook: price * n / 1e8). */
  totalCollateral: bigint;
  /** Collateral the maker posts for numContracts, USDC 6 dp. */
  makerCollateral: bigint;
  /** Always ODETTE_REFERRER. */
  referrer: string;
  maker: string;
  expiry: bigint;
  isCall: boolean;
  strikes: bigint[];
  product: ProductKind;
  optionBook: string;
}

export interface CheckResult {
  /** PRD section 9 check number */
  id: number;
  name: string;
  ok: boolean;
  /** True when the check could not run (for example no taker address). ok is false. */
  skipped?: boolean;
  /** Failure text, or a short pass note */
  message: string;
}

export interface CheckOptions {
  /** Address that will send the fill. Default: the signer's address. */
  taker?: string;
  /** Run estimateGas when the other checks pass. Default true. */
  simulate?: boolean;
}

/** Decoded OrderFilled event from a fill receipt. */
export interface OrderFilledEvent {
  optionAddress: string;
  buyer: string;
  seller: string;
  premiumAmount: bigint;
  feeCollected: bigint;
  referrer: string;
  referralFeePaid: bigint;
  sellerWasMaker: boolean;
}

const KNOWN_BOOKS = new Set(KNOWN_OPTION_BOOKS.map((a) => a.toLowerCase()));

function usdc(amount: bigint): string {
  return `${fromBigInt(amount, USDC.decimals)} USDC`;
}

/**
 * Module for OptionBook contract interactions (v2)
 *
 * Provides methods for previewing, checking and filling Odette orders.
 *
 * @example
 * ```typescript
 * // Fill an order with 10 USDC of premium
 * const receipt = await client.optionBook.fillOrder(order, 10_000000n);
 * ```
 */
export class OptionBookModule {
  constructor(private readonly client: OdetteClient) {}

  /**
   * Get the OptionBook contract address
   */
  get contractAddress(): string {
    return this.client.chainConfig.contracts.optionBook;
  }

  /**
   * Get a read-only contract instance
   */
  private getReadContractAt(address: string): OptionBookContract {
    return new Contract(address, OPTION_BOOK_ABI, this.client.provider) as unknown as OptionBookContract;
  }

  /**
   * Get a contract instance with signer at a specific address
   * Used when the order was signed for a different OptionBook contract
   */
  private getWriteContractAt(address: string): OptionBookContract {
    const signer = this.client.requireSigner();
    return new Contract(address, OPTION_BOOK_ABI, signer) as unknown as OptionBookContract;
  }

  /**
   * Resolve and validate the OptionBook target address from an order.
   *
   * The feed attaches `optionBookAddress`. To prevent a compromised feed from
   * redirecting fills to an attacker contract that drains pre-existing
   * allowances, the address MUST be a known OptionBook release.
   */
  private resolveOptionBookTarget(order: OdetteOrder): string {
    const target = validateAddress(order.rawApiData.optionBookAddress ?? order.optionBook, 'optionBookAddress');
    if (!KNOWN_BOOKS.has(target.toLowerCase())) {
      throw createError(
        'INVALID_ORDER',
        `This order belongs to OptionBook ${target}, which this tool does not support.`
      );
    }
    return target;
  }

  /**
   * Build ContractOrder from an order and fill amount
   *
   * IMPORTANT: Do NOT modify the order fields from the API - the signature
   * is tied to the exact order parameters. Only numContracts can be set by the caller.
   */
  buildContractOrder(order: OdetteOrder, numContracts: bigint): ContractOrder {
    const rawData = order.rawApiData;
    if (!rawData) {
      throw createError('INVALID_ORDER', 'Order is missing rawApiData required for contract call');
    }

    // Engagement invariant (TNU-AUDIT-0047): zero-address implementations on
    // API responses indicate a misconfigured/rogue feed. Reject loudly at the
    // SDK boundary.
    if (
      !rawData.implementation ||
      rawData.implementation === '0x0000000000000000000000000000000000000000'
    ) {
      throw createError(
        'INVALID_ORDER',
        'OptionBook fill: order.implementation is zero-address — the option type is not deployed on this chain.'
      );
    }

    return {
      maker: order.order.maker,
      // The exact signed value (upstream used the rounded JS number).
      orderExpiryTimestamp: order.orderExpiryTimestamp ?? BigInt(rawData.orderExpiryTimestamp),
      collateral: rawData.collateral,
      isCall: rawData.isCall,
      priceFeed: rawData.priceFeed,
      implementation: rawData.implementation,
      isLong: rawData.isLong,
      maxCollateralUsable: BigInt(rawData.maxCollateralUsable),
      strikes: rawData.strikes.map(s => BigInt(s)),
      expiry: order.order.expiry,
      price: order.order.price,
      numContracts: numContracts,
      extraOptionData: rawData.extraOptionData || '0x',
    };
  }

  /**
   * Re-derive the order from its signed fields with this client's product
   * settings. Refuses a hidden product (CALL_SPREAD / PUT_SPREAD unless
   * enableSpreads) and replaces caller-supplied labels (product, underlying,
   * optionBook) with the ones the implementation and price feed imply.
   */
  private listed(order: OdetteOrder): OdetteOrder {
    const rule = recheckOrder(order, { enableSpreads: this.client.enableSpreads, ignoreTime: true });
    if (!rule.ok) {
      throw createError('INVALID_ORDER', rule.message);
    }
    return rule.order;
  }

  /**
   * Maximum valid size the signed order allows (contracts, 6 dp), rounded down
   * to the step. Does not know what is already filled on chain; checkFill does.
   */
  calculateMaxContracts(order: OdetteOrder): bigint {
    return maxContracts(this.listed(order));
  }

  /**
   * Preview a fill order without executing it.
   *
   * @param order - An order from client.api.fetchOrders()
   * @param usdcAmount - USDC premium to spend (6 decimals). If not provided, uses max available.
   * @returns Preview of the fill: numContracts, premium, sizing, referrer
   *
   * @throws {OdetteError} INVALID_PARAMS when the amount does not reach the 0.50 USDC minimum
   */
  previewFillOrder(input: OdetteOrder, usdcAmount?: bigint): FillPreview {
    if (!input.rawApiData) {
      throw createError('INVALID_ORDER', 'Order is missing rawApiData required for contract call');
    }
    const order = this.listed(input);

    const max = maxContracts(order);
    const min = minContracts(order);
    if (min === null) {
      throw createError(
        'SIZE_EXCEEDED',
        'Order is too small to trade. The maximum size costs less than 0.50 USDC.'
      );
    }

    let numContracts: bigint;
    if (usdcAmount !== undefined) {
      // User specified how much to spend: floor to the step, cap at max.
      numContracts = contractsForUsdc(order, usdcAmount);
      if (numContracts === 0n) {
        throw createError(
          'INVALID_PARAMS',
          `${usdc(usdcAmount)} is below the minimum. The smallest fill costs ${usdc(premiumForContracts(order, min))}.`
        );
      }
    } else {
      // Fill max - use all available contracts
      numContracts = max;
    }

    return {
      numContracts,
      maxContracts: max,
      minContracts: min,
      step: sizeStep(order),
      collateralToken: order.rawApiData.collateral,
      pricePerContract: order.order.price,
      totalCollateral: premiumForContracts(order, numContracts),
      makerCollateral: collateralForContracts(order, numContracts),
      referrer: ODETTE_REFERRER,
      maker: order.order.maker,
      expiry: order.order.expiry,
      isCall: order.rawApiData.isCall,
      strikes: order.rawApiData.strikes.map(s => BigInt(s)),
      product: order.product,
      optionBook: this.resolveOptionBookTarget(order),
    };
  }

  /**
   * Encode a fillOrder transaction for use with any wallet library.
   * The referrer in the calldata is always ODETTE_REFERRER.
   *
   * @param order - An order from client.api.fetchOrders()
   * @param usdcAmount - USDC premium to spend (6 decimals). If not provided, fills max available.
   * @returns Object with `to` (contract address) and `data` (encoded calldata)
   */
  encodeFillOrder(input: OdetteOrder, usdcAmount?: bigint): { to: string; data: string } {
    const order = this.listed(input);
    const preview = this.previewFillOrder(order, usdcAmount);
    const contractOrder = this.buildContractOrder(order, preview.numContracts);

    const iface = new Interface(OPTION_BOOK_ABI);
    const data = iface.encodeFunctionData('fillOrder', [
      contractOrder,
      order.signature,
      ODETTE_REFERRER,
    ]);

    return {
      to: preview.optionBook,
      data,
    };
  }

  /**
   * Maker funding: MIN(allowance(maker, OptionBook), balanceOf(maker)) in the
   * order's collateral. The chain pulls collateral with transferFrom, so both
   * limits apply (thetaverse odette-app-worker.js:692-768; review lesson L-024).
   */
  async getMakerFundable(order: OdetteOrder): Promise<{ allowance: bigint; balance: bigint; fundable: bigint }> {
    const token = new Contract(order.rawApiData.collateral, ERC20_ABI, this.client.provider) as unknown as ERC20Reads;
    const book = this.resolveOptionBookTarget(order);
    try {
      const [allowance, balance] = await Promise.all([
        token.allowance(order.order.maker, book),
        token.balanceOf(order.order.maker),
      ]);
      return { allowance, balance, fundable: allowance < balance ? allowance : balance };
    } catch (error) {
      throw mapContractError(error);
    }
  }

  /**
   * Collateral still usable on this order's nonce: maxCollateralUsable minus
   * OptionBook.amountFilled(computeNonce(order)).
   */
  async getRemainingCollateral(order: OdetteOrder): Promise<bigint> {
    const contract = this.getReadContractAt(this.resolveOptionBookTarget(order));
    try {
      const nonce = await contract.computeNonce(this.buildContractOrder(order, 0n));
      const filled = await contract.amountFilled(nonce);
      const max = BigInt(order.rawApiData.maxCollateralUsable);
      return filled >= max ? 0n : max - filled;
    } catch (error) {
      throw mapContractError(error);
    }
  }

  /**
   * Run the pre-send checks (PRD section 9) against the chain. Never sends.
   * Check 14 (re-fetch the order after a confirm prompt) belongs to the caller.
   */
  async checkFill(input: OdetteOrder, usdcAmount?: bigint, opts: CheckOptions = {}): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const add = (id: number, name: string, ok: boolean, message: string) => results.push({ id, name, ok, message });

    // 1. Chain
    try {
      await this.client.assertNetwork();
      add(1, 'chain', true, `Base (${BASE_CHAIN_ID})`);
    } catch (error) {
      const wrongChain = (error as { code?: string }).code === 'NETWORK_UNSUPPORTED';
      add(1, 'chain', false, wrongChain
        ? `Wrong chain. Connect to Base (${BASE_CHAIN_ID}).`
        : `Could not reach the RPC: ${(error as Error).message}. Check the RPC URL.`);
      return results;
    }

    // 2-7. Whitelist and book rules, judged at the latest block time.
    const now = await this.client.getCurrentTimestamp();
    const rule = recheckOrder(input, { enableSpreads: this.client.enableSpreads, now });
    add(2, 'odette-order', rule.ok, rule.ok ? `${rule.order.product} ${rule.order.underlying}` : rule.message);
    if (!rule.ok) return results;
    // Size from the re-derived order, never from caller-supplied labels.
    const order = rule.order;

    // 8-9. Size, step and 0.50 USDC minimum.
    let preview: FillPreview;
    try {
      preview = this.previewFillOrder(order, usdcAmount);
    } catch (error) {
      add(8, 'size', false, (error as Error).message);
      return results;
    }
    const size = checkSize(order, preview.numContracts);
    add(8, 'size', size.ok,
      size.ok ? `${fromBigInt(preview.numContracts, USDC.decimals)} contracts (step ${fromBigInt(preview.step, USDC.decimals)})` : size.message);
    if (!size.ok) return results;
    const premiumOk = preview.totalCollateral >= 500_000n;
    add(9, 'min-premium', premiumOk, premiumOk ? usdc(preview.totalCollateral) : 'Premium is below the 0.50 USDC minimum.');

    // 10. Maker can fund this size, and the order nonce has room for it.
    const need = preview.makerCollateral;
    const [{ fundable }, remaining] = await Promise.all([this.getMakerFundable(order), this.getRemainingCollateral(order)]);
    const cover = fundable < remaining ? fundable : remaining;
    add(10, 'maker-funding', cover >= need,
      cover >= need ? `maker covers ${usdc(cover)}` : `Maker cannot fund this size. Maker can cover ${usdc(cover)}; this fill needs ${usdc(need)}.`);

    // 11-12. Taker balance and allowance cover the premium.
    const taker = opts.taker ?? (this.client.signer ? await this.client.getSignerAddress() : undefined);
    if (taker === undefined) {
      results.push({ id: 11, name: 'taker-balance', ok: false, skipped: true, message: 'Skipped: no taker address. Pass a signer or opts.taker.' });
      return results;
    }
    const premium = preview.totalCollateral;
    const token = new Contract(preview.collateralToken, ERC20_ABI, this.client.provider) as unknown as ERC20Reads;
    const [balance, allowance] = await Promise.all([token.balanceOf(taker), token.allowance(taker, preview.optionBook)]);
    add(11, 'taker-balance', balance >= premium,
      balance >= premium ? usdc(balance) : `Your USDC balance is ${usdc(balance)}. This fill needs ${usdc(premium)}.`);
    add(12, 'taker-allowance', allowance >= premium,
      allowance >= premium ? usdc(allowance) : `USDC approval is ${usdc(allowance)}. Approve at least ${usdc(premium)} first.`);

    // 13. Simulate, only when nothing above failed (a known failure would revert anyway).
    if (opts.simulate !== false && results.every((r) => r.ok)) {
      const tx = this.encodeFillOrder(order, usdcAmount);
      try {
        const gas = await this.client.provider.estimateGas({ from: taker, to: tx.to, data: tx.data });
        add(13, 'simulate', gas <= MAX_FILL_GAS,
          gas <= MAX_FILL_GAS ? `${gas} gas` : `Gas estimate ${gas} is above the ${MAX_FILL_GAS} limit.`);
      } catch (error) {
        add(13, 'simulate', false, `Simulation failed: ${mapContractError(error).message}`);
      }
    }

    return results;
  }

  /**
   * Fill an order on the OptionBook contract with Odette's referrer.
   *
   * Runs checkFill first and sends nothing when any check fails. Does not
   * approve: call client.erc20.ensureAllowance first when check 12 fails.
   *
   * @param order - An order from client.api.fetchOrders()
   * @param usdcAmount - USDC premium to spend (6 decimals). If not provided, fills max available.
   * @param opts.onSent - Called with the tx hash after broadcast, before the receipt. Does not change calldata.
   * @returns Transaction receipt. Decode it with decodeOrderFilled.
   *
   * @throws {OdetteError} CHECK_FAILED when a pre-send check fails
   * @throws {OdetteError} SIGNER_REQUIRED if no signer is configured
   */
  // opts has a default so fillOrder.length stays 2 (referrer-fixed.mjs checks it).
  async fillOrder(
    input: OdetteOrder,
    usdcAmount?: bigint,
    opts: { onSent?: (hash: string) => void } = {}
  ): Promise<TransactionReceipt> {
    this.client.requireSigner();
    const order = this.listed(input);
    const checks = await this.checkFill(order, usdcAmount, { simulate: false });
    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      throw createError('CHECK_FAILED', failed.map((c) => c.message).join(' '), undefined, { checks });
    }

    const preview = this.previewFillOrder(order, usdcAmount);
    this.client.logger.debug('Filling order', {
      maker: order.order.maker,
      numContracts: preview.numContracts.toString(),
      usdcAmount: usdcAmount?.toString() ?? 'max',
      referrer: ODETTE_REFERRER,
      targetContract: preview.optionBook,
    });

    try {
      const contract = this.getWriteContractAt(preview.optionBook);
      const contractOrder = this.buildContractOrder(order, preview.numContracts);

      // Estimate gas and add 20% buffer for Account Abstraction wallets (e.g., Coinbase Smart Wallet)
      const gasEstimate = await contract.fillOrder.estimateGas(contractOrder, order.signature, ODETTE_REFERRER);
      if (gasEstimate > MAX_FILL_GAS) {
        throw createError('CHECK_FAILED', `Gas estimate ${gasEstimate} is above the ${MAX_FILL_GAS} limit.`);
      }
      const gasLimit = (gasEstimate * 120n) / 100n;

      const tx = await contract.fillOrder(contractOrder, order.signature, ODETTE_REFERRER, { gasLimit });
      opts.onSent?.(tx.hash);
      const receipt = await tx.wait();

      if (!receipt) {
        throw createError('CONTRACT_REVERT', 'Transaction failed - no receipt returned');
      }

      const filled = this.decodeOrderFilled(receipt, preview.optionBook);
      if (!filled || filled.referrer.toLowerCase() !== ODETTE_REFERRER.toLowerCase()) {
        this.client.logger.error('Referrer mismatch in OrderFilled. This is a bug.', {
          txHash: receipt.hash,
          expected: ODETTE_REFERRER,
          recorded: filled?.referrer ?? 'no OrderFilled event',
        });
      }

      this.client.logger.info('Order filled successfully', {
        txHash: receipt.hash,
        maker: order.order.maker,
      });

      return receipt;
    } catch (error) {
      this.client.logger.error('Failed to fill order', { error });
      throw mapContractError(error);
    }
  }

  /** Decode the OrderFilled event from a fill receipt, or null when absent. */
  decodeOrderFilled(
    receipt: { logs: ReadonlyArray<{ address: string; topics: readonly string[]; data: string }> },
    optionBookAddress: string = this.contractAddress
  ): OrderFilledEvent | null {
    const iface = new Interface(OPTION_BOOK_ABI);
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== optionBookAddress.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (!parsed || parsed.name !== 'OrderFilled') continue;
        return {
          optionAddress: String(parsed.args['optionAddress']),
          buyer: String(parsed.args['buyer']),
          seller: String(parsed.args['seller']),
          premiumAmount: BigInt(parsed.args['premiumAmount']),
          feeCollected: BigInt(parsed.args['feeCollected']),
          referrer: String(parsed.args['referrer']),
          referralFeePaid: BigInt(parsed.args['referralFeePaid']),
          sellerWasMaker: Boolean(parsed.args['sellerWasMaker']),
        };
      } catch {
        // Ignore unrelated/malformed logs.
      }
    }
    return null;
  }

  /**
   * Odette's referrer fee split on the OptionBook, in basis points. Informational.
   */
  async getReferrerFeeSplit(): Promise<bigint> {
    try {
      return await this.getReadContractAt(this.contractAddress).referrerFeeSplitBps(ODETTE_REFERRER);
    } catch (error) {
      throw mapContractError(error);
    }
  }
}
