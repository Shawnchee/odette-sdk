# Changelog

All notable changes to `@odette-fi/sdk` and `@odette-fi/cli`.
Both packages share one version.

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
