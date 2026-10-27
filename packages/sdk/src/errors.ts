// Adapted from thetanuts-sdk src/types/errors.ts and src/utils/errors.ts at
// 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Trimmed to the codes the Odette SDK raises. Prefix renamed to OdetteError.
// Subclasses are folded into `code`; `instanceof OdetteError` plus `code` covers them.

/**
 * Error codes for Odette SDK errors
 */
export type OdetteErrorCode =
  | 'ORDER_EXPIRED'
  | 'INSUFFICIENT_ALLOWANCE'
  | 'INSUFFICIENT_BALANCE'
  | 'MAKER_CANNOT_FUND'
  | 'NETWORK_UNSUPPORTED'
  | 'HTTP_ERROR'
  | 'FEED_INVALID'
  | 'CONTRACT_REVERT'
  | 'INVALID_PARAMS'
  | 'INVALID_ORDER'
  | 'SIZE_EXCEEDED'
  | 'SIGNER_REQUIRED'
  | 'CHECK_FAILED'
  | 'UNKNOWN';

/**
 * Base error class for all Odette SDK errors.
 * Supports `instanceof` checks.
 */
export class OdetteError extends Error {
  readonly code: OdetteErrorCode;
  readonly meta?: Record<string, unknown>;

  constructor(code: OdetteErrorCode, message: string, cause?: unknown, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'OdetteError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
    if (meta !== undefined) {
      this.meta = meta;
    }
  }
}

/**
 * Type guard for OdetteError
 */
export function isOdetteError(error: unknown): error is OdetteError {
  return error instanceof OdetteError;
}

/**
 * Create an OdetteError with the specified code and message.
 */
export function createError(
  code: OdetteErrorCode,
  message: string,
  cause?: unknown,
  meta?: Record<string, unknown>
): OdetteError {
  return new OdetteError(code, message, cause, meta);
}

/**
 * Wrap an unknown error as an OdetteError
 */
export function wrapError(
  error: unknown,
  defaultCode: OdetteErrorCode = 'UNKNOWN',
  defaultMessage?: string
): OdetteError {
  if (isOdetteError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const message = defaultMessage ?? error.message;
    return createError(defaultCode, message, error);
  }

  const message = defaultMessage ?? String(error);
  return createError(defaultCode, message, error);
}

/**
 * Map contract/ethers errors to OdetteError codes.
 */
export function mapContractError(error: unknown): OdetteError {
  // Pass-through: if the caller already raised a typed OdetteError
  // (e.g. SIGNER_REQUIRED from requireSigner()), don't re-wrap it as a
  // CONTRACT_REVERT. Re-wrapping loses the original code.
  if (isOdetteError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('insufficient allowance') || message.includes('erc20: insufficient allowance')) {
      return createError('INSUFFICIENT_ALLOWANCE', 'Insufficient token allowance. Please approve tokens first.', error);
    }

    if (message.includes('insufficient balance') || message.includes('erc20: transfer amount exceeds balance')) {
      return createError('INSUFFICIENT_BALANCE', 'Insufficient token balance.', error);
    }

    if (message.includes('expired') || message.includes('order expired')) {
      return createError('ORDER_EXPIRED', 'Order has expired. Fetch orders again.', error);
    }

    return createError('CONTRACT_REVERT', `Contract call failed: ${error.message}`, error);
  }

  return wrapError(error, 'CONTRACT_REVERT', 'Contract call failed');
}
