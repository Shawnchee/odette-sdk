// Adapted from thetanuts-sdk src/utils/validation.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Trimmed to validateAddress. Code unchanged.

import { getAddress, isAddress } from 'ethers';
import { createError } from '../errors.js';

/**
 * Validate that a value is a valid Ethereum address. Returns the EIP-55
 * checksummed form so callers can normalize at the boundary (TNU-AUDIT-0055).
 *
 * Existing callsites that ignore the return value remain correct — they
 * just keep using their lowercase/mixed-case input. New code should consume
 * the return value to ensure consistent checksum casing in calldata and
 * round-trip equality with checksummed config strings.
 */
export function validateAddress(address: string, fieldName: string): string {
  if (!isAddress(address)) {
    const invalidAddress = address as string;
    throw createError(
      'INVALID_PARAMS',
      `Invalid ${fieldName}: ${invalidAddress} is not a valid Ethereum address`
    );
  }
  return getAddress(address);
}
