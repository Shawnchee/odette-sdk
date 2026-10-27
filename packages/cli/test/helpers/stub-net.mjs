// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Preload for CLI subprocess tests: node --import tsx --import <this> src/index.ts ...
// - Pins the clock to the feed recording time.
// - Answers the order feed fetch with the recorded fixture.
// - Answers JSON-RPC through ethers' FetchRequest.registerGetUrl hook (no server).
// Reads are encoded with the real ethers Interface. Sending is refused.
//
// Env: STUB_TAKER_USDC (6 dp, default 100000000), STUB_TAKER_ALLOWANCE (default 0).
//      STUB_REQUOTE=up|down: every feed read after the first re-signs each order
//        and moves its price 1% up or down (Odette re-quotes about once a minute).
//      STUB_SENT_FILE: a signed raw transaction is decoded and written here as
//        JSON { to, referrer, numContracts }, then refused. Nothing is broadcast.

import { readFileSync, writeFileSync } from 'node:fs';
import { AbiCoder, FetchRequest, Interface, Transaction, getAddress, toBeHex } from 'ethers';

const NOW = 1793085599; // 2026-10-27T07:19:59Z
const realNow = Date.now;
const offset = NOW * 1000 - realNow();
Date.now = () => realNow() + offset;

const fixture = readFileSync(new URL('../../../sdk/test/fixtures/feed-sample.json', import.meta.url), 'utf8');
let feedReads = 0;
globalThis.fetch = async () => {
  feedReads += 1;
  const body = JSON.parse(fixture);
  const move = process.env.STUB_REQUOTE;
  if (feedReads > 1 && (move === 'up' || move === 'down')) {
    for (const e of body.data.orders) {
      e.signature = '0x' + '22'.repeat(65);
      const p = BigInt(e.order.price);
      e.order.price = String(move === 'up' ? (p * 101n) / 100n : (p * 99n) / 100n);
    }
  }
  return { ok: true, status: 200, json: async () => body };
};

const fill = new Interface([
  'function fillOrder((address,uint256,address,bool,address,address,bool,uint256,uint256[],uint256,uint256,uint256,bytes),bytes,address)',
]);
function recordSent(raw) {
  const tx = Transaction.from(raw);
  const args = fill.decodeFunctionData('fillOrder', tx.data);
  if (process.env.STUB_SENT_FILE) {
    writeFileSync(process.env.STUB_SENT_FILE, JSON.stringify({ to: tx.to, referrer: args[2], numContracts: args[0][11].toString(), price: args[0][10].toString() }));
  }
}

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const erc20 = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address,uint256) returns (bool)',
]);
const book = new Interface([
  'function computeNonce((address,uint256,address,bool,address,address,bool,uint256,uint256[],uint256,uint256,uint256,bytes)) pure returns (uint256)',
  'function amountFilled(uint256) view returns (uint256)',
]);
const MAKER = '0xecda1d002fbc55f2fd3386bb4b9b95f859f3c39e';
const takerUsdc = BigInt(process.env.STUB_TAKER_USDC ?? '100000000');
const takerAllowance = BigInt(process.env.STUB_TAKER_ALLOWANCE ?? '0');

function answerCall({ to, data }) {
  const target = getAddress(to);
  const e = erc20.parseTransaction({ data });
  if (e && target === USDC) {
    // ethers Result throws on an out-of-range index, so read args only when present.
    if (e.name === 'decimals') return erc20.encodeFunctionResult('decimals', [6]);
    const who = String(e.args[0]).toLowerCase();
    if (e.name === 'balanceOf') return erc20.encodeFunctionResult('balanceOf', [who === MAKER ? 1_000_000_000000n : takerUsdc]);
    if (e.name === 'allowance') return erc20.encodeFunctionResult('allowance', [who === MAKER ? 1_000_000_000000n : takerAllowance]);
  }
  const b = book.parseTransaction({ data });
  if (b?.name === 'computeNonce') return AbiCoder.defaultAbiCoder().encode(['uint256'], [7n]);
  if (b?.name === 'amountFilled') return AbiCoder.defaultAbiCoder().encode(['uint256'], [0n]);
  throw new Error(`stub-net: no answer for eth_call ${data.slice(0, 10)} to ${target}`);
}

const ZERO32 = '0x' + '00'.repeat(32);
function answer(method, params) {
  switch (method) {
    case 'eth_chainId': return '0x2105';
    case 'net_version': return '8453';
    case 'eth_blockNumber': return '0x1';
    case 'eth_getBlockByNumber':
      return {
        hash: '0x' + '11'.repeat(32), parentHash: ZERO32, number: '0x1', timestamp: toBeHex(NOW),
        nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x0',
        miner: '0x' + '00'.repeat(20), extraData: '0x', baseFeePerGas: '0x1', transactions: [],
      };
    case 'eth_call': return answerCall(params[0]);
    case 'eth_estimateGas': return toBeHex(400_000n);
    case 'eth_getBalance': return toBeHex(10n ** 16n);
    case 'eth_getTransactionCount': return '0x0';
    case 'eth_gasPrice': return '0x1';
    case 'eth_maxPriorityFeePerGas': return '0x1';
    case 'eth_sendRawTransaction':
      recordSent(params[0]);
      throw new Error('stub-net: sending is refused in tests');
    case 'eth_sendTransaction':
      throw new Error('stub-net: sending is refused in tests');
    default:
      throw new Error(`stub-net: no answer for ${method}`);
  }
}

FetchRequest.registerGetUrl(async (req) => {
  const payload = JSON.parse(Buffer.from(req.body).toString('utf8'));
  const one = (p) => {
    try { return { jsonrpc: '2.0', id: p.id, result: answer(p.method, p.params ?? []) }; }
    catch (err) { return { jsonrpc: '2.0', id: p.id, error: { code: -32000, message: err.message } }; }
  };
  const out = Array.isArray(payload) ? payload.map(one) : one(payload);
  return {
    statusCode: 200,
    statusMessage: 'OK',
    headers: { 'content-type': 'application/json' },
    body: new TextEncoder().encode(JSON.stringify(out)),
  };
});
