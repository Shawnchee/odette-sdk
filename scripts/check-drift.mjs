#!/usr/bin/env node
// Copyright (c) 2026 Thetanuts Finance. MIT License.
//
// Drift check (PRD section 15, R9). Compares what this repo copied with where
// it came from, and fails when they differ. Read-only: HTTP GETs and eth_call.
//
//   1. thetanuts-sdk (GitHub main): src/abis/optionBook.ts and src/abis/erc20.ts
//      must equal our copies byte for byte (after our 4-line header). The Base
//      OptionBook and USDC addresses in src/chains/index.ts must equal ours.
//   2. Odette production (https://odette.fi): config.js constants (OptionBook,
//      referrer, minimum premium, implementations, markets, market days) and
//      the fillOrder / OrderFilled selectors in abis.js must equal ours.
//   3. Base: the OptionBook and each enabled implementation have bytecode.
//
// Remote files are parsed as text. Nothing fetched is executed.
// A source that cannot be read is a FAILURE, never a pass.
//
// Usage: npm run drift
// Env: ODETTE_RPC_URL (default https://mainnet.base.org)
//      DRIFT_UPSTREAM_REF (default main), DRIFT_ODETTE_URL (default https://odette.fi)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, JsonRpcProvider, getAddress } from 'ethers';
import {
  OPTION_BOOK_ABI,
  OPTION_BOOK_R12,
  ODETTE_REFERRER,
  USDC,
  IMPLEMENTATIONS,
  MARKETS,
  MARKET_DAYS,
  MIN_PREMIUM_USDC,
} from '@odette-fi/sdk';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = `https://raw.githubusercontent.com/Thetanuts-Finance/thetanuts-sdk/${process.env.DRIFT_UPSTREAM_REF ?? 'main'}`;
const ODETTE = process.env.DRIFT_ODETTE_URL ?? 'https://odette.fi';
const RPC = process.env.ODETTE_RPC_URL ?? 'https://mainnet.base.org';

const rows = [];
function record(source, item, ok, detail) {
  rows.push({ source, item, ok, detail });
}
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

async function get(url) {
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

/** Our copied ABI file without its 4-line provenance header. */
function localAbiBody(name) {
  return readFileSync(join(root, 'packages/sdk/src/abi', `${name}.ts`), 'utf8').split('\n').slice(4).join('\n');
}

// ---------------------------------------------------------------- upstream
async function checkUpstream() {
  for (const [name, path] of [['optionBook', 'src/abis/optionBook.ts'], ['erc20', 'src/abis/erc20.ts']]) {
    try {
      const remote = await get(`${UPSTREAM}/${path}`);
      const ok = remote === localAbiBody(name);
      record('thetanuts-sdk', path, ok, ok ? 'identical' : 'differs from packages/sdk/src/abi copy');
    } catch (e) {
      record('thetanuts-sdk', path, false, `unreadable: ${e.message}`);
    }
  }
  try {
    const chains = await get(`${UPSTREAM}/src/chains/index.ts`);
    const base = chains.slice(chains.indexOf('8453: {'), chains.indexOf('\n  },\n', chains.indexOf('8453: {')));
    const book = /optionBook:\s*'(0x[0-9a-fA-F]{40})'/.exec(base)?.[1];
    const usdc = /USDC:\s*\{\s*address:\s*'(0x[0-9a-fA-F]{40})'/.exec(base)?.[1];
    record('thetanuts-sdk', 'chains Base optionBook', same(book, OPTION_BOOK_R12), `${book ?? 'not found'} vs ${OPTION_BOOK_R12}`);
    record('thetanuts-sdk', 'chains Base USDC', same(usdc, USDC.address), `${usdc ?? 'not found'} vs ${USDC.address}`);
  } catch (e) {
    record('thetanuts-sdk', 'src/chains/index.ts', false, `unreadable: ${e.message}`);
  }
}

// ------------------------------------------------------------ odette.fi
function constant(src, name) {
  return new RegExp(`^const ${name}\\s*=\\s*["']?([^"';\\s]+)["']?;`, 'm').exec(src)?.[1];
}

async function checkOdette() {
  let cfg;
  try {
    cfg = await get(`${ODETTE}/config.js`);
  } catch (e) {
    record('odette.fi', 'config.js', false, `unreadable: ${e.message}`);
    cfg = null;
  }
  if (cfg) {
    const pairs = [
      ['OPTION_BOOK_ADDRESS', OPTION_BOOK_R12],
      ['ODETTE_REFERRER_ADDRESS', ODETTE_REFERRER],
      ['PUT_OPTION_IMPLEMENTATION', IMPLEMENTATIONS.PUT],
      ['LINEAR_CALL_IMPLEMENTATION', IMPLEMENTATIONS.LINEAR_CALL],
      ['RANGER_OPTION_IMPLEMENTATION', IMPLEMENTATIONS.RANGER],
    ];
    for (const [name, ours] of pairs) {
      const theirs = constant(cfg, name);
      record('odette.fi', name, same(theirs, ours), `${theirs ?? 'not found'} vs ${ours}`);
    }
    // Spreads are hidden in the SDK; still flag a changed address.
    for (const [name, ours] of [['CALL_SPREAD_IMPLEMENTATION', IMPLEMENTATIONS.CALL_SPREAD], ['PUT_SPREAD_IMPLEMENTATION', IMPLEMENTATIONS.PUT_SPREAD]]) {
      const theirs = constant(cfg, name);
      record('odette.fi', name, theirs === undefined || same(theirs, ours), theirs === undefined ? 'not in production (hidden here too)' : `${theirs} vs ${ours}`);
    }
    const minUsd = Number(constant(cfg, 'MIN_PREMIUM_USD'));
    record('odette.fi', 'MIN_PREMIUM_USD', minUsd * 1e6 === Number(MIN_PREMIUM_USDC), `${minUsd} USD vs ${Number(MIN_PREMIUM_USDC) / 1e6} USDC`);

    const start = cfg.indexOf('const CANONICAL_ASSETS = {');
    const block = start >= 0 ? cfg.slice(start, cfg.indexOf('\n};', start)) : '';
    const theirs = {};
    const days = {};
    for (const m of block.matchAll(/\n {4}([A-Z]+): \{([\s\S]*?)\n {4}\}/g)) {
      theirs[m[1]] = /priceFeed:\s*"(0x[0-9a-fA-F]{40})"/.exec(m[2])?.[1];
      const weekly = /availability:\s*\{\s*type:\s*"weekly",\s*days:\s*\[([^\]]*)\]/.exec(m[2]);
      if (weekly) days[m[1]] = weekly[1].split(',').map((d) => d.trim().replace('DAY_NAME_TO_INDEX.', ''));
    }
    const symbols = [...new Set([...Object.keys(theirs), ...Object.keys(MARKETS)])].sort();
    if (symbols.length === 0) record('odette.fi', 'CANONICAL_ASSETS', false, 'not found');
    for (const s of symbols) {
      record('odette.fi', `market ${s}`, same(theirs[s], MARKETS[s]), `${theirs[s] ?? 'absent'} vs ${MARKETS[s] ?? 'absent'}`);
    }
    const INDEX = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    for (const s of [...new Set([...Object.keys(days), ...Object.keys(MARKET_DAYS)])].sort()) {
      const t = (days[s] ?? []).map((d) => INDEX[d]).sort().join(',');
      const o = [...(MARKET_DAYS[s] ?? [])].sort().join(',');
      record('odette.fi', `market days ${s}`, t === o, `[${t}] vs [${o}]`);
    }
  }

  try {
    const abis = await get(`${ODETTE}/abis.js`);
    const at = abis.indexOf('OPTION_BOOK_ABI');
    const open = abis.indexOf('[', at);
    const close = abis.indexOf('];', open);
    const theirs = new Interface(JSON.parse(abis.slice(open, close + 1)));
    const ours = new Interface(OPTION_BOOK_ABI);
    for (const fn of ['fillOrder', 'swapAndFillOrder', 'referrerFeeSplitBps', 'hashOrder']) {
      const a = theirs.getFunction(fn)?.selector;
      const b = ours.getFunction(fn)?.selector;
      record('odette.fi', `abis.js ${fn}`, a !== undefined && a === b, `${a ?? 'absent'} vs ${b}`);
    }
    const a = theirs.getEvent('OrderFilled')?.topicHash;
    const b = ours.getEvent('OrderFilled')?.topicHash;
    record('odette.fi', 'abis.js OrderFilled', a !== undefined && a === b, `${a ?? 'absent'} vs ${b}`);
  } catch (e) {
    record('odette.fi', 'abis.js', false, `unreadable: ${e.message}`);
  }
}

// ----------------------------------------------------------------- chain
async function checkChain() {
  const provider = new JsonRpcProvider(RPC, 8453, { staticNetwork: true });
  const targets = [['OptionBook r12', OPTION_BOOK_R12], ...['PUT', 'LINEAR_CALL', 'RANGER'].map((k) => [k, IMPLEMENTATIONS[k]])];
  for (const [label, address] of targets) {
    try {
      const code = await provider.getCode(getAddress(address));
      record('base', `${label} bytecode`, code.length > 2, `${(code.length - 2) / 2} bytes at ${address}`);
    } catch (e) {
      record('base', `${label} bytecode`, false, `unreadable: ${e.message}`);
    }
  }
}

await checkUpstream();
await checkOdette();
await checkChain();

const width = Math.max(...rows.map((r) => r.item.length));
for (const r of rows) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.source.padEnd(13)} ${r.item.padEnd(width)}  ${r.detail}`);
}
const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} match`);
if (failed.length > 0) {
  console.log('Drift found. Review each FAIL: update the copy, or record why it differs.');
  process.exit(1);
}
