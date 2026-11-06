# Changelog

All notable changes to `@odette-fi/sdk` and `@odette-fi/cli`.
Both packages share one version.

## Unreleased

### Breaking

Two changes below can break SDK code: `fetchOrders()` now returns CALL_SPREAD and PUT_SPREAD by
default, and `maxContracts` now means the page's maximum, not the chain's (use `chainMaxContracts`).

### Changed

- SDK: CALL_SPREAD and PUT_SPREAD are listed by default. The Odette app shows them in
  its Chain view (and the Chart and Slider views pick them), so `fetchOrders()` now
  returns the same list the page does. `enableSpreads: false` hides them.
- CLI: `--type` takes `CALL_SPREAD` and `PUT_SPREAD` with `--strikes <strike>,<cap>`.
  The selector matches by product: `--type CALL` never picks a spread, and a spread
  needs exactly two strikes. `orders`, `preview`, `max-contracts` and `fill` agree, so
  `--order-index` indexes the same list `orders` prints.
- CLI: `orders` rows and `preview` carry `label`, the order in the app's own words
  ("Above 2,400 from 2,300 · 11.3×", "Between 79,000 and 80,000 · 1.64×", "Below 2,180").
  `preview` adds the app's `breakeven` for calls, puts and spreads.
- SDK and CLI: one RANGER per asset, expiry and zone, the best multiple, as the Odette app
  shows. The other orders in that zone are no longer listed, previewed or filled by selector.
- SDK and CLI: trade sizes follow the Odette ticket, measured on the page. Maximum is 99.99%
  of the batch. A RANGER costs 1 to 100 USDC. A PUT or CALL minimum is a whole percent of the
  batch (at least 1%, enough to cost 0.50 USDC). A typed amount rounds to the nearest contract
  unit, so the premium can pass it by under one step. `chainMaxContracts` is the old maximum.
  An amount under the minimum is still refused, where the page raises it to its minimum.
- CLI: `fill --collateral` approves the amount plus one step of premium by default. If a
  re-quote before send still needs more, `fill` asks for one more approval. An amount named with
  `--approve-amount <n>` is not raised: the fill is refused instead.
- CLI: `odette orders spread` lists both spreads, and `--type SPREAD` does the same. A wrong
  product or an extra word exits 2. `orders` and `preview` show `minCost` and `maxCost`.
- CLI: a `--collateral` under the minimum exits 2 with the order's minimum and an amount that
  works, before any approval.

## 0.1.1 — 2026-10-30

### Fixed

- CLI: `config set privateKey`, `wallet import` and `setup` reject a key that is not a
  usable secp256k1 key (for example all zeros). A bad key no longer replaces a saved one.
- CLI: `config validate` masks the RPC URL, on success and on error. It no longer prints
  an API key that is part of the URL.
- CLI: a config file that is valid JSON but not an object (`123`, `"x"`, `[]`, `null`)
  now fails with exit 4. Before, `wallet create` could save over it with a broken file.
- SDK: `erc20.getDecimals()` returns a `number`, as its type says. It returned a
  `bigint`, so `utils.fromBigInt(value, decimals)` threw.
- SDK: a logger or `onSent` callback that returns a rejected promise can no longer crash
  the process after a fill is sent.

## 0.1.0 — 2026-10-30

First release under the `@odette-fi` scope.

### SDK (`@odette-fi/sdk`)

- `OdetteClient` for Base (8453). The referrer is fixed to Odette's address; the
  constructor refuses a `referrer` option.
- `api.fetchOrders()` returns the orders the Odette app lists: PUT, LINEAR_CALL and
  RANGER on USDC, daily expiries 1 hour to 3 days out, buy side, OptionBook r12.
  CALL_SPREAD and PUT_SPREAD are hidden unless `enableSpreads` is set.
- Sizing from each contract's collateral rule: step, 0.50 USDC minimum, maximum and
  `maxPayout` (RANGER pays at most k per contract).
- `optionBook.checkFill()` runs the pre-send checks against Base: chain, order,
  size, maker funding (`MIN(allowance, balance)` and the order's remaining capacity),
  your balance and allowance, and a simulation.
- `optionBook.fillOrder()` refuses to send when a check fails, reports the tx hash at
  broadcast (`onSent`), handles a re-priced replacement, and checks the referrer the
  chain recorded.

### CLI (`@odette-fi/cli`)

- `odette setup`, `wallet` (create, import, show, balance, allowance, approve,
  reset), `config`, `orders`, `check`, `preview`, `max-contracts` and `fill`.
- Keys come from `ODETTE_PRIVATE_KEY` or `~/.config/odette/config.json` (0600) only.
  There is no `--private-key` or `--referrer` flag.
- `fill` runs the checks before any prompt, fetches the order again before sending,
  and asks again if the price moved. `--yes` needs `--collateral`.
- `--dry-run` never sends a transaction and never changes the config file.

### Docs

- Each package has its own README on npm: the CLI page is the trading guide, the
  SDK page is the developer guide.

Parts are adapted from [thetanuts-sdk](https://github.com/Thetanuts-Finance/thetanuts-sdk)
at `9e72aef`; see NOTICE.md.
