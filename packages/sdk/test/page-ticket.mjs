// Copyright (c) 2026 Thetanuts Finance. MIT License.
// The SDK sizes a trade as the Odette web app's ticket does. Every number in
// fixtures/ticket-cases.json was measured on the page (thetaverse odette/new-slider,
// localhost, 2026-11-06, no wallet): select an order, call applyTicketAmount(amount),
// and read the numContracts the page would send. Rows where the page's quote changed
// during the measurement are not in the fixture.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  contractsForUsdc,
  chainMaxContracts,
  maxContracts,
  minContracts,
  premiumForContracts,
  checkSize,
  sizeStep,
  MIN_PREMIUM_USDC,
  MIN_RANGER_PREMIUM_USDC,
  MAX_RANGER_PREMIUM_USDC,
  productForImplementation,
} from '../src/index.ts';

const { rows } = JSON.parse(readFileSync(new URL('./fixtures/ticket-cases.json', import.meta.url), 'utf8'));
const asOrder = (r) => ({
  product: productForImplementation(r.order.implementation),
  order: { price: BigInt(r.order.price) },
  rawApiData: { strikes: r.order.strikes, maxCollateralUsable: r.order.maxCollateralUsable },
});

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

check('the fixture covers all five products', () => {
  assert.deepEqual([...new Set(rows.map((r) => asOrder(r).product))].sort(), ['CALL_SPREAD', 'LINEAR_CALL', 'PUT', 'PUT_SPREAD', 'RANGER']);
});

check('a typed amount buys the numContracts the page sends', () => {
  let compared = 0;
  for (const r of rows) {
    const o = asOrder(r);
    for (const a of r.am) {
      const size = contractsForUsdc(o, BigInt(Math.round(a.a * 1e6)));
      if (size === 0n) continue; // under the minimum: the next check
      assert.equal(size, BigInt(a.n), `${o.product} ${r.order.strikes} $${a.a}`);
      compared += 1;
    }
  }
  assert.ok(compared > 200, `compared ${compared}`);
});

check('an amount under the minimum: the SDK refuses; the page raises it to the same minimum', () => {
  let refused = 0;
  for (const r of rows) {
    const o = asOrder(r);
    for (const a of r.am) {
      if (contractsForUsdc(o, BigInt(Math.round(a.a * 1e6))) !== 0n) continue;
      assert.equal(minContracts(o), BigInt(a.n), `${o.product} ${r.order.strikes} $${a.a}`);
      refused += 1;
    }
  }
  assert.ok(refused > 50, `refused ${refused}`);
});

check('the maximum is the size the page buys with any larger amount', () => {
  for (const r of rows) {
    const o = asOrder(r);
    assert.equal(maxContracts(o), BigInt(r.am.at(-1).n), `${o.product} ${r.order.strikes}`);
  }
});

check('maximum: 99.99% of the batch, never above what the chain accepts', () => {
  for (const r of rows) {
    const o = asOrder(r);
    assert.ok(maxContracts(o) <= chainMaxContracts(o));
    if (o.product !== 'RANGER') assert.ok(maxContracts(o) < chainMaxContracts(o));
  }
  // By hand: 10,000 USDC of collateral on a 100 USD spread is 100 contracts; the page's maximum is 99.99.
  const spread = {
    product: 'CALL_SPREAD',
    order: { price: 8_00000000n },
    rawApiData: { strikes: ['230000000000', '240000000000'], maxCollateralUsable: '10000000000' },
  };
  assert.equal(chainMaxContracts(spread), 100_000000n);
  assert.equal(maxContracts(spread), 99_990000n);
});

check('a RANGER costs from 1 to 100 USDC', () => {
  const rangers = rows.map(asOrder).filter((o) => o.product === 'RANGER');
  assert.ok(rangers.length >= 2);
  for (const o of rangers) {
    const low = premiumForContracts(o, minContracts(o));
    const high = premiumForContracts(o, maxContracts(o));
    // Within one contract unit of the bound: the page rounds to nearest.
    assert.ok(low >= MIN_RANGER_PREMIUM_USDC - 1000n && low <= MIN_RANGER_PREMIUM_USDC + 1000n, `low ${low}`);
    assert.ok(high >= MAX_RANGER_PREMIUM_USDC - 1000n && high <= MAX_RANGER_PREMIUM_USDC + 1000n, `high ${high}`);
    assert.equal(contractsForUsdc(o, 999_000n), 0n);
    assert.equal(contractsForUsdc(o, 1_000_000_000_000n), maxContracts(o));
  }
});

check('a PUT or CALL minimum is a whole percent of the batch, so it can pass 0.50 USDC by a lot', () => {
  const vanilla = rows.filter((r) => ['PUT', 'LINEAR_CALL'].includes(asOrder(r).product));
  assert.ok(vanilla.length > 5);
  for (const r of vanilla) {
    // The page's slider minimum, applied to the page's maximum, is the SDK's minimum (to one step).
    const o = asOrder(r);
    const fromPage = BigInt(Math.round((r.sliderMin / 100) * r.uiMaxContracts * 1e6));
    const gap = minContracts(o) > fromPage ? minContracts(o) - fromPage : fromPage - minContracts(o);
    assert.ok(gap <= sizeStep(o), `${o.product} ${r.order.strikes}: page ${fromPage}, SDK ${minContracts(o)}`);
  }
  assert.ok(vanilla.some((r) => premiumForContracts(asOrder(r), minContracts(asOrder(r))) > 2n * MIN_PREMIUM_USDC));
});

check('every size the rules give passes checkSize, and the minimum costs at least the chain minimum', () => {
  for (const r of rows) {
    const o = asOrder(r);
    assert.deepEqual(checkSize(o, minContracts(o)), { ok: true });
    assert.deepEqual(checkSize(o, maxContracts(o)), { ok: true });
    assert.ok(premiumForContracts(o, minContracts(o)) >= MIN_PREMIUM_USDC);
    for (const a of r.am) {
      const size = contractsForUsdc(o, BigInt(Math.round(a.a * 1e6)));
      if (size !== 0n) assert.deepEqual(checkSize(o, size), { ok: true });
    }
  }
});

check('an order too small to reach 0.50 USDC cannot be traded', () => {
  const o = {
    product: 'PUT',
    order: { price: 1_00000000n },
    rawApiData: { strikes: ['200000000000'], maxCollateralUsable: '100000000' }, // 0.05 contracts x $1
  };
  assert.equal(minContracts(o), null);
  assert.equal(contractsForUsdc(o, 1_000_000n), 0n);
});

console.log(`# page-ticket: ${passed} passed`);
