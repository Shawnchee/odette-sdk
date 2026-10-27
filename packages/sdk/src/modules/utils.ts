// Adapted from thetanuts-sdk src/modules/utils.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Trimmed to toBigInt and fromBigInt. Code unchanged.

import { createError } from '../errors.js';
import { toBigInt as toBigIntSafe } from '../utils/decimals.js';

/**
 * Utility helpers on the client.
 *
 * @example
 * ```typescript
 * const amount = client.utils.toBigInt('100.5', 6);   // 100500000n
 * const display = client.utils.fromBigInt(100500000n, 6); // '100.5'
 * ```
 */
export class UtilsModule {
  /**
   * Convert a human-readable value to bigint with specified decimals
   *
   * @param value - Value to convert (number or string)
   * @param decimals - Number of decimals
   * @returns BigInt representation
   *
   * @example
   * ```typescript
   * const amount = client.utils.toBigInt('100.5', 6);
   * // Returns 100500000n
   * ```
   */
  toBigInt(value: number | string, decimals: number): bigint {
    if (decimals < 0 || decimals > 77) {
      throw createError('INVALID_PARAMS', 'Decimals must be between 0 and 77');
    }
    try {
      return toBigIntSafe(value, decimals);
    } catch (err) {
      throw createError(
        'INVALID_PARAMS',
        `Invalid numeric value for toBigInt: ${String(value)}`,
        err
      );
    }
  }

  /**
   * Convert a bigint to a human-readable string with specified decimals
   *
   * @param value - BigInt value to convert
   * @param decimals - Number of decimals
   * @returns String representation
   *
   * @example
   * ```typescript
   * const display = client.utils.fromBigInt(100500000n, 6);
   * // Returns '100.5'
   * ```
   */
  fromBigInt(value: bigint, decimals: number): string {
    if (decimals < 0 || decimals > 77) {
      throw createError('INVALID_PARAMS', 'Decimals must be between 0 and 77');
    }

    if (decimals === 0) {
      return value.toString();
    }

    const str = value.toString().padStart(decimals + 1, '0');
    const whole = str.slice(0, -decimals) || '0';
    const fraction = str.slice(-decimals);
    const trimmedFraction = fraction.replace(/0+$/, '');
    return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
  }
}
