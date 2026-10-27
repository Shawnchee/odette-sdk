// Adapted from thetanuts-sdk src/utils/decimals.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Trimmed to toBigInt and fromBigInt (and their helper). toBigInt now rejects
// malformed input ("1.2.3", "25.0oops") instead of truncating it; upstream
// accepted both.

function toFixedPointString(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  const str = value.toString();
  // Only use toFixed when toString() produces scientific notation (e.g., "1e-7", "1e+21")
  if (/[eE]/.test(str)) {
    const fixed = value.toFixed(20);
    return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }
  return str;
}

/**
 * Convert a human-readable number to bigint with specified decimals
 *
 * Truncates (rounds toward zero) any fractional digits beyond the specified
 * decimal precision. This is standard DeFi behavior — you never want to
 * round UP a spend amount.
 *
 * @param value - Human-readable value (e.g., "1.5", 0.05, "-0.5")
 * @param decimals - Number of decimal places for the target token
 * @returns Bigint representation in smallest unit
 * @throws {Error} If the value cannot be parsed as a valid number
 *
 * @example
 * ```typescript
 * toBigInt("1.5", 6)      // 1500000n (1.5 USDC)
 * toBigInt(0.05, 8)       // 5000000n (0.05 in 8 decimals)
 * toBigInt("0.1234567", 6) // 123456n (truncated, not rounded)
 * toBigInt(1e-7, 8)       // 10n (0.0000001 in 8 decimals)
 * toBigInt("-1.5", 6)     // -1500000n
 * ```
 */
export function toBigInt(value: number | string, decimals: number): bigint {
  // Normalize: convert number to fixed-point string to handle scientific notation
  let str: string;
  if (typeof value === 'number') {
    str = toFixedPointString(value);
  } else {
    // Handle string scientific notation like "1e6"
    if (/[eE]/.test(value)) {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw new Error(`Invalid numeric string: ${value}`);
      }
      str = toFixedPointString(num);
    } else {
      str = value;
    }
  }

  // Handle negative numbers: extract sign, process magnitude, apply sign at the end
  const negative = str.startsWith('-');
  if (negative) {
    str = str.slice(1);
  }

  // Validate the WHOLE input before splitting: digits, optionally one '.'
  // and more digits. Upstream checked only the whole part, so "1.2.3" read
  // as 1.2 and "25.000000oops" as 25.
  if (!/^\d+(\.\d*)?$/.test(str)) {
    throw new Error(`Invalid numeric value: ${negative ? '-' : ''}${str}`);
  }

  // Split into whole and fraction
  const [whole = '0', fraction = ''] = str.split('.');

  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const result = BigInt(whole + paddedFraction);
  return negative ? -result : result;
}

/**
 * Convert a bigint to a human-readable number string with specified decimals
 *
 * @param value - Bigint value in smallest unit
 * @param decimals - Number of decimal places
 * @returns Human-readable string (e.g., "1.5")
 *
 * @example
 * ```typescript
 * fromBigInt(1500000n, 6)  // "1.5"
 * fromBigInt(-1500000n, 6) // "-1.5"
 * fromBigInt(0n, 6)        // "0"
 * ```
 */
export function fromBigInt(value: bigint, decimals: number): string {
  // Handle negative values: process magnitude, prepend sign
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const str = abs.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, -decimals) || '0';
  const fraction = str.slice(-decimals);
  const trimmedFraction = fraction.replace(/0+$/, '');
  const result = trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
  return negative ? `-${result}` : result;
}

