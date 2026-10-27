// Copyright (c) 2026 Thetanuts Finance. MIT License.
// In-memory Base for tests. Answers the eth_call reads the SDK makes, encoded
// and decoded with the real ethers Interface. No network.

import { Interface, getAddress } from 'ethers';
import { OPTION_BOOK_ABI, ERC20_ABI } from '../../src/index.ts';

const book = new Interface(OPTION_BOOK_ABI);
const erc20 = new Interface(ERC20_ABI);
const key = (...parts) => parts.map((p) => String(p).toLowerCase()).join('|');

/**
 * state:
 *   chainId     bigint (default 8453n)
 *   now         unix seconds of the latest block
 *   balances    Map key(token, owner) -> bigint
 *   allowances  Map key(token, owner, spender) -> bigint
 *   amountFilled bigint for any nonce (default 0n)
 *   gas         bigint returned by estimateGas, or an Error to throw
 */
export function fakeChain(init = {}) {
  const state = {
    chainId: 8453n,
    now: 1793085599,
    balances: new Map(),
    allowances: new Map(),
    amountFilled: 0n,
    gas: 400_000n,
    calls: [],
    ...init,
  };

  const provider = {
    state,
    async getNetwork() {
      return { chainId: state.chainId, name: 'fake' };
    },
    async getBlock() {
      return { timestamp: state.now, number: 1 };
    },
    async estimateGas(tx) {
      state.calls.push({ method: 'estimateGas', tx });
      if (state.gas instanceof Error) throw state.gas;
      return state.gas;
    },
    async call(tx) {
      const to = getAddress(tx.to);
      const data = tx.data;
      state.calls.push({ method: 'call', to, data });
      // ethers v6 parseTransaction returns null for an unknown selector.
      const asErc20 = erc20.parseTransaction({ data });
      const iface = asErc20 ? erc20 : book;
      const f = asErc20 ?? book.parseTransaction({ data });
      if (!f) throw new Error(`fake chain: unknown selector ${data.slice(0, 10)}`);
      switch (f.name) {
        case 'balanceOf':
          return iface.encodeFunctionResult('balanceOf', [state.balances.get(key(to, f.args[0])) ?? 0n]);
        case 'allowance':
          return iface.encodeFunctionResult('allowance', [state.allowances.get(key(to, f.args[0], f.args[1])) ?? 0n]);
        case 'decimals':
          return iface.encodeFunctionResult('decimals', [6]);
        case 'computeNonce':
          return iface.encodeFunctionResult('computeNonce', [123n]);
        case 'amountFilled':
          return iface.encodeFunctionResult('amountFilled', [state.amountFilled]);
        case 'referrerFeeSplitBps':
          return iface.encodeFunctionResult('referrerFeeSplitBps', [0n]);
        default:
          throw new Error(`fake chain: no answer for ${f.name}`);
      }
    },
  };

  return {
    provider,
    state,
    setBalance(token, owner, amount) { state.balances.set(key(getAddress(token), owner), amount); },
    setAllowance(token, owner, spender, amount) { state.allowances.set(key(getAddress(token), owner, spender), amount); },
  };
}

/** A signer that records what it would send and never sends. */
export function recordingSigner(provider, address = '0x1111111111111111111111111111111111111111') {
  const sent = [];
  return {
    provider,
    sent,
    async getAddress() { return address; },
    async estimateGas(tx) { return provider.estimateGas({ ...tx, from: address }); },
    async call(tx) { return provider.call(tx); },
    async resolveName(n) { return n; },
    async sendTransaction(tx) {
      sent.push(tx);
      throw new Error('recordingSigner: not sent (test)');
    },
  };
}
