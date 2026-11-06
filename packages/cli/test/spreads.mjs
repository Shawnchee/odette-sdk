// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Spreads in the CLI: listed by default, --type CALL_SPREAD / PUT_SPREAD with
// two strikes, --type CALL never picks a spread, the page's words in `label`,
// and a spread fill's calldata decoded by the REAL ethers Interface.
// Network is stubbed; nothing is sent.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Interface, Wallet } from 'ethers';
import { runCli, tempDir } from './helpers/run-cli.mjs';

const dir = tempDir();
const noCfg = ['--config', join(dir, 'absent.json')];
const ODETTE = '0x94D784e81A5c8cA6E19629C73217b61a256Ea1c7';
const CALL_SPREAD_IMPL = '0xfaeD63f7040E65b79cF0Ae29706fDc423eE249A9';
const PUT_SPREAD_IMPL = '0x02Fe0d9635e0139DBB3768a5d5Db404Fd84d9134';
// The fixture (2026-10-27T07:19:59Z) holds one USDC BTC call spread 80000/81000
// and one USDC BTC put spread 78000/77000, both expiring 1793174400.
const EXP = '1793174400';
const CS = ['--underlying', 'BTC', '--type', 'CALL_SPREAD', '--strikes', '80000,81000', '--expiry', EXP];
const PS = ['--underlying', 'BTC', '--type', 'PUT_SPREAD', '--strikes', '78000,77000', '--expiry', EXP];
const key = Wallet.createRandom().privateKey; // generated per run, never printed

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
const json = (args, env = {}) => {
  const r = runCli([...noCfg, '-o', 'json', ...args], { env });
  assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
  return JSON.parse(r.stdout);
};

check('orders lists both spreads by default, with the page wording in label', () => {
  const rows = json(['orders']);
  const cs = rows.find((r) => r.product === 'CALL_SPREAD');
  const ps = rows.find((r) => r.product === 'PUT_SPREAD');
  assert.ok(cs && ps, 'both spreads listed');
  assert.equal(cs.underlying, 'BTC');
  assert.equal(cs.strikes, '8000000000000,8100000000000');
  // 317.06 USD premium on a 1,000 USD width: the page prints 3.2x.
  assert.equal(cs.label, 'Above 81,000 from 80,000 · 3.2×');
  assert.equal(ps.strikes, '7800000000000,7700000000000');
  assert.equal(ps.label, 'Below 77,000 from 78,000 · 9.8×');
  // Every row has a label; vanillas and RANGER use the page's words too.
  for (const r of rows) assert.ok(typeof r.label === 'string' && r.label.length > 0, r.product);
  assert.equal(rows.find((r) => r.product === 'RANGER').label, 'Between 79,000 and 80,000 · 1.64×');
  assert.equal(rows.find((r) => r.product === 'PUT').label, 'Below 2,180');
});

check('orders --type CALL_SPREAD / PUT_SPREAD list that product only; CALL and PUT exclude spreads', () => {
  const cs = json(['orders', '--type', 'CALL_SPREAD']);
  assert.ok(cs.length >= 1 && cs.every((r) => r.product === 'CALL_SPREAD'));
  const ps = json(['orders', '--type', 'put_spread']);
  assert.ok(ps.length >= 1 && ps.every((r) => r.product === 'PUT_SPREAD'));
  assert.ok(json(['orders', '--type', 'CALL']).every((r) => r.product === 'LINEAR_CALL'));
  assert.ok(json(['orders', '--type', 'PUT']).every((r) => r.product === 'PUT'));
});

check('orders table shows the spread ticker and label', () => {
  const r = runCli([...noCfg, 'orders', '--type', 'CALL_SPREAD']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /BTC-28OCT26-80000\/81000-CALL_SPREAD/);
  assert.match(r.stdout, /Above 81,000 from 80,000/);
});

check('preview --type CALL_SPREAD: max payout is the width per contract, breakeven is strike + premium', () => {
  const p = json(['preview', ...CS, '--collateral', '5']);
  assert.equal(p.product, 'CALL_SPREAD');
  assert.equal(p.referrer, ODETTE);
  assert.deepEqual(p.strikes.map(String), ['8000000000000', '8100000000000']);
  // 1,000 USD width: payout = numContracts x 1000 (6 dp), and that is what the maker posts.
  assert.equal(BigInt(p.maxPayout), (BigInt(p.numContracts) * 1000_00000000n) / 100000000n);
  assert.equal(BigInt(p.makerCollateral), BigInt(p.maxPayout));
  assert.ok(BigInt(p.totalCollateral) <= 5_000000n);
  const t = runCli([...noCfg, 'preview', ...CS, '--collateral', '5']);
  assert.equal(t.code, 0, t.stderr);
  assert.match(t.stdout, /label\s+.*Above 81,000 from 80,000/);
  assert.match(t.stdout, /breakeven\s+.*\$80,317\.06/);
});

check('preview --type PUT_SPREAD with strikes in either order', () => {
  const a = json(['preview', ...PS]);
  assert.equal(a.product, 'PUT_SPREAD');
  const b = json(['preview', '--underlying', 'BTC', '--type', 'PUT_SPREAD', '--strikes', '77000,78000', '--expiry', EXP]);
  assert.deepEqual(b.strikes, a.strikes);
});

check('--type CALL with two strikes is a usage error that points at CALL_SPREAD (exit 2)', () => {
  const r = runCli([...noCfg, 'preview', '--underlying', 'BTC', '--type', 'CALL', '--strikes', '80000,81000', '--expiry', EXP]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--type CALL needs 1 strike/);
  assert.match(r.stderr, /pass --type CALL_SPREAD/);
});

check('--type CALL_SPREAD with one strike is a usage error (exit 2)', () => {
  const r = runCli([...noCfg, 'preview', '--underlying', 'BTC', '--type', 'CALL_SPREAD', '--strike', '80000', '--expiry', EXP]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--type CALL_SPREAD needs 2 strikes/);
});

check('--type CALL --strike 80000 does not pick the 80000/81000 call spread (exit 4, no match)', () => {
  const r = runCli([...noCfg, 'preview', '--underlying', 'BTC', '--type', 'CALL', '--strike', '80000', '--expiry', EXP]);
  assert.equal(r.code, 4);
  assert.match(r.stderr, /No live order matches underlying=BTC type=CALL/);
});

check('max-contracts on both spreads: exit 0 and a positive size', () => {
  for (const sel of [CS, PS]) {
    const m = json(['max-contracts', ...sel]);
    assert.ok(BigInt(m.maxContracts) > 0n);
  }
});

check('check --type CALL --strike 81000 reports the call spread as a structure match', () => {
  const c = json(['check', '--underlying', 'BTC', '--type', 'CALL', '--strike', '81000', '--expiry', EXP, '--direction', 'buy']);
  const m = c.structureMatches.find((s) => s.structure === 'CALL_SPREAD');
  assert.ok(m, JSON.stringify(c.structureMatches));
  assert.deepEqual(m.strikes, [80000, 81000]);
});

check('fill --dry-run of a spread: the real encoder puts the spread implementation, both strikes and ODETTE_REFERRER in calldata', () => {
  const hand = new Interface([
    'function fillOrder((address maker,uint256 orderExpiryTimestamp,address collateral,bool isCall,address priceFeed,address implementation,bool isLong,uint256 maxCollateralUsable,uint256[] strikes,uint256 expiry,uint256 price,uint256 numContracts,bytes extraOptionData) order, bytes signature, address referrer) returns (address)',
  ]);
  for (const [sel, impl, strikes, isCall] of [
    [CS, CALL_SPREAD_IMPL, ['8000000000000', '8100000000000'], true],
    [PS, PUT_SPREAD_IMPL, ['7800000000000', '7700000000000'], false],
  ]) {
    const j = json(['--dry-run', 'fill', ...sel, '--collateral', '5'], { ODETTE_PRIVATE_KEY: key });
    assert.equal(j.dryRun, true);
    assert.equal(j.referrer, ODETTE);
    assert.equal(j.fill.data.slice(0, 10), '0xa4761ec1');
    const args = hand.decodeFunctionData('fillOrder', j.fill.data);
    assert.equal(args.referrer, ODETTE);
    assert.equal(args.order.implementation.toLowerCase(), impl.toLowerCase());
    assert.deepEqual(args.order.strikes.map(String), strikes);
    assert.equal(args.order.isCall, isCall);
    assert.equal(args.order.isLong, false);
    assert.ok(args.order.numContracts > 0n);
    // Premium never exceeds the 5 USDC budget.
    assert.ok((args.order.price * args.order.numContracts) / 100000000n <= 5_000000n);
    assert.equal(j.preview.product, sel === CS ? 'CALL_SPREAD' : 'PUT_SPREAD');
  }
});

check('--order-index is consistent with the orders list, spreads included', () => {
  const rows = json(['orders']);
  const cs = rows.find((r) => r.product === 'CALL_SPREAD');
  const p = json(['preview', '--order-index', String(cs.index)]);
  assert.equal(p.product, 'CALL_SPREAD');
  assert.deepEqual(p.strikes.map(String), cs.strikes.split(','));
});

console.log(`# spreads: ${passed} passed`);
