// Adapted from thetanuts-sdk cli/src/format.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
/**
 * Shared formatting helpers for humanized CLI output.
 *
 * These render values for table-mode display only; JSON/CSV/YAML output paths
 * must continue to emit the raw bigint strings the SDK returns so that
 * scripting consumers stay byte-stable across patch releases.
 *
 * Centralized here (not inlined per-command) so `book` and `rfq` agree on the
 * exact ticker string and money formatting — users compare them across
 * commands and any drift is confusing.
 */

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

/**
 * Format an option ticker in the dApp-canonical style:
 *   ETH-19MAY26-2100-P
 *   ETH-19MAY26-2050/2100-P  (multi-leg)
 * `strikesUsd` are USD floats (already divided by 1e8 if you started from raw).
 */
export function formatTicker(
  underlying: string,
  expirySec: number,
  strikesUsd: number[],
  type: 'PUT' | 'CALL'
): string {
  const d = new Date(expirySec * 1000);
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear().toString().slice(-2);
  const strikeStr =
    strikesUsd.length === 1 ? `${strikesUsd[0]}` : strikesUsd.join('/');
  return `${underlying}-${day}${month}${year}-${strikeStr}-${type === 'PUT' ? 'P' : 'C'}`;
}

/**
 * Render a strike (or comma-separated multi-leg strikes) in `$2100` form.
 * Inputs are USD floats.
 */
export function formatStrikeUsd(strikesUsd: number[]): string {
  if (strikesUsd.length === 0) return '';
  if (strikesUsd.length === 1) return `$${formatNumber(strikesUsd[0]!)}`;
  return strikesUsd.map((s) => `$${formatNumber(s)}`).join(',');
}

/**
 * Render a USD dollar amount with up to 2 decimals and thousands separators.
 * Used for premium / available / collateral surfacing in table mode.
 */
export function formatUsd(amount: number, maxFractionDigits = 2): string {
  return `$${formatNumber(amount, maxFractionDigits)}`;
}

function formatNumber(n: number, maxFractionDigits = 2): string {
  // Drop trailing zeros: $2100 not $2,100.00 for clean strikes, but $1.77
  // still renders.
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  };
  return new Intl.NumberFormat('en-US', opts).format(n);
}

/**
 * Format an expiry timestamp as `<unix> (<iso-date>)`. ISO is UTC-trimmed to
 * minutes — the seconds are always zero for option expiries and the user
 * rarely cares about exact-second granularity at the orderbook level.
 */
export function formatExpiry(expirySec: number): string {
  const d = new Date(expirySec * 1000);
  const iso = d.toISOString().slice(0, 16) + 'Z'; // YYYY-MM-DDTHH:mmZ
  return `${expirySec} (${iso})`;
}

/**
 * Reverse-lookup helper: given a token address and a chain config tokens map,
 * return the symbol (USDC, WETH, ...). Returns undefined when unmatched.
 *
 * Typed loosely on purpose — different SDK consumer shapes have slightly
 * different tokens map types; we only need `{ address, ... }`.
 */
export function tokenSymbolByAddress(
  address: string | undefined,
  tokens: Record<string, { address: string }>
): string | undefined {
  if (!address) return undefined;
  const lower = address.toLowerCase();
  for (const [sym, cfg] of Object.entries(tokens)) {
    if (cfg.address.toLowerCase() === lower) return sym;
  }
  return undefined;
}

/**
 * Reverse-lookup helper: given a price-feed address and a price-feeds map
 * (symbol -> feed address), return the underlying symbol ('ETH', 'BTC', ...).
 */
export function underlyingSymbolByPriceFeed(
  priceFeed: string | undefined,
  priceFeeds: Record<string, string>
): string | undefined {
  if (!priceFeed) return undefined;
  const lower = priceFeed.toLowerCase();
  for (const [sym, addr] of Object.entries(priceFeeds)) {
    if (addr.toLowerCase() === lower) return sym;
  }
  return undefined;
}

/**
 * A price the way the Odette app prints one (revamp.js V2U.price): about four
 * figures, so 78,716 · 2,475 · 697.8 · 106.7 · 7.41 · 1.475.
 */
export function formatPagePrice(v: number): string {
  const digits = v >= 1000 ? 0 : v >= 100 ? 1 : v >= 10 ? 2 : 3;
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** A payout multiple the way the app prints one (revamp.js V2Wells.mult): 12.5× or 1.75×. */
export function formatPageMultiple(m: number): string {
  if (!Number.isFinite(m)) return '—';
  return `${m.toFixed(m >= 2 ? 1 : 2)}×`;
}

/**
 * One order in the words the Odette app uses for it. Nothing here is new: the
 * app's ticket asks "Will ETH close above 2,240" for a call spread and reads
 * "Above 2,240 from 2,220" (revamp.js:3855, :6414); a range asks "close between
 * lo and hi" (revamp.js:4031); the Chain's columns are "CALLS — PAY ABOVE" and
 * "PUTS — PAY BELOW" (revamp.js:3283). The multiple is width / premium for a
 * spread and k / premium for a range, as the Chart cells print it
 * (revamp.js readSpreads, readRanges).
 *
 * `strikesUsd` are in the order's own order; `premiumUsd` is the price per contract.
 */
export function formatPageLabel(
  product: string,
  strikesUsd: number[],
  isCall: boolean,
  premiumUsd: number
): string {
  const p = formatPagePrice;
  const side = isCall ? 'Above' : 'Below';
  switch (product) {
    case 'CALL_SPREAD':
    case 'PUT_SPREAD': {
      if (strikesUsd.length !== 2) return `${side} ${strikesUsd.map(p).join(' / ')}`;
      const [strike, cap] = strikesUsd as [number, number];
      const width = Math.abs(cap - strike);
      return `${side} ${p(cap)} from ${p(strike)} · ${formatPageMultiple(width / premiumUsd)}`;
    }
    case 'RANGER': {
      if (strikesUsd.length !== 4) return `Between ${strikesUsd.map(p).join(' / ')}`;
      const [callLower, zoneStart, zoneEnd] = strikesUsd as [number, number, number, number];
      const k = zoneStart - callLower;
      return `Between ${p(zoneStart)} and ${p(zoneEnd)} · ${formatPageMultiple(k / premiumUsd)}`;
    }
    default:
      return `${side} ${strikesUsd.map(p).join(' / ')}`;
  }
}

/**
 * Ticker for a structure (spread / fly / condor / ranger). Multi-leg orders
 * must never render with a bare `-C` / `-P` suffix: `book check` used to label
 * a 4-strike RANGER `ETH-28AUG26-2150-C`, which reads as a vanilla call and
 * misled callers into pricing it as one.
 *
 * Falls back to `formatTicker` for single-leg orders, or when the structure
 * name is unknown (an implementation address absent from chain config).
 * Strikes are rendered in the order the order stores them — that same order is
 * what `book preview --strikes` expects back.
 */
export function formatStructureTicker(
  underlying: string,
  expirySec: number,
  strikesUsd: number[],
  type: 'PUT' | 'CALL',
  structureName?: string
): string {
  if (strikesUsd.length <= 1 || !structureName) {
    return formatTicker(underlying, expirySec, strikesUsd, type);
  }
  const d = new Date(expirySec * 1000);
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear().toString().slice(-2);
  return `${underlying}-${day}${month}${year}-${strikesUsd.join('/')}-${structureName}`;
}
