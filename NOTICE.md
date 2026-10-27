# NOTICE

This repository adapts code from **thetanuts-sdk**
(<https://github.com/Thetanuts-Finance/thetanuts-sdk>), MIT License,
Copyright (c) 2026 Thetanuts Finance. Source commit:
`9e72aef1ab5c008ccc92352fa5048bd08c452ede`.

Each file below keeps the Thetanuts Finance MIT notice in its header, and the
header lists what changed.

## SDK (`packages/sdk/src`)

| File | Source in thetanuts-sdk | How |
|---|---|---|
| `abi/optionBook.ts` | `src/abis/optionBook.ts` | Copied as-is |
| `abi/erc20.ts` | `src/abis/erc20.ts` | Copied as-is |
| `chain.ts` | `src/chains/index.ts` (Base block) | Addresses only |
| `client.ts` | `src/client/ThetanutsClient.ts` | Trimmed; fixed referrer; Base only |
| `errors.ts` | `src/types/errors.ts`, `src/utils/errors.ts` | Trimmed; renamed to `OdetteError` |
| `logger.ts` | `src/utils/logger.ts`, `src/types/logger.ts` | Renamed to `OdetteLogger` |
| `types.ts` | `src/types/optionBook.ts`, `src/types/api.ts` | Trimmed to the feed order shape |
| `feed.ts` | `src/modules/api.ts` (`fetchOrders`) | Rewritten on `fetch`, strict field checks |
| `normalize.ts` | `src/modules/api.ts` (`normalizeOdetteOrder`) | Typed input; no 0 / "" fallbacks |
| `modules/optionBook.ts` | `src/modules/optionBook.ts` | Trimmed; fixed referrer; Odette sizing and checks |
| `modules/erc20.ts` | `src/modules/erc20.ts` | Trimmed (no transfer, no callStatic) |
| `modules/utils.ts` | `src/modules/utils.ts` | `toBigInt`, `fromBigInt` only |
| `utils/decimals.ts` | `src/utils/decimals.ts` | `toBigInt`, `fromBigInt` only |
| `utils/validation.ts` | `src/utils/validation.ts` | `validateAddress` only |

## CLI (`packages/cli/src`)

| File | Source in thetanuts-sdk | How |
|---|---|---|
| `index.ts` | `cli/src/index.ts` | Name and description |
| `options.ts` | `cli/src/options.ts` | No `--chain`, no `--referrer` |
| `client.ts` | `cli/src/client.ts` | `OdetteClient`; no referrer resolution; no RFQ keystore |
| `config.ts` | `cli/src/config.ts` | `~/.config/odette`; a `referrer` key is an error |
| `confirm.ts` | `cli/src/confirm.ts` | Unchanged |
| `defaults.ts` | `cli/src/defaults.ts` | Comments |
| `output.ts` | `cli/src/output.ts` | Comments |
| `format.ts` | `cli/src/format.ts` | Unchanged |
| `bookEligibility.ts` | `cli/src/bookEligibility.ts` | Import only |
| `bookMatch.ts` | `cli/src/bookMatch.ts` | Import only |
| `bookOrderIdentity.ts` | `cli/src/bookOrderIdentity.ts` | Adds `findSameInstrument` (Odette re-signs orders) |
| `bookPreview.ts` | `cli/src/bookPreview.ts` | Unchanged |
| `bookCheck.ts` | `cli/src/bookCheck.ts` | No RFQ recommendation |
| `commands/book.ts` | `cli/src/commands/book.ts` | Top-level commands; no payout block; pre-send checks |
| `commands/wallet.ts` | `cli/src/commands/wallet.ts` | No `transfer`; approve is USDC to the OptionBook only |
| `commands/setup.ts` | `cli/src/commands/setup.ts` | No referrer prompt |
| `commands/config.ts` | `cli/src/commands/config.ts` | `referrer` refused |
| `commands/registry.ts` | `cli/src/commands/registry.ts` | Odette commands only |

Test patterns (not copied code): `cli/tests/exitCodes.test.ts`.

## Ported from the Odette web app

These files port rules from `thetaverse/odette` (Thetanuts' Odette web app) at
`origin/dev` `5c3f2b0639ce07a134a0f82b7df8113dea1e744b`, checked against the
OptionBook and option contracts in `thetanuts_rfq` at
`2c830620861eefcca895fb8e2a60b8f3fa915e7f`. They carry the same MIT notice.

| File | Source |
|---|---|
| `packages/sdk/src/whitelist.ts` | `odette/config.js`: implementation constants, `isSpreadOrder`, `isDirectionalOrder`, `isRangerOrder`, `CANONICAL_ASSETS`, `COLLATERAL_TOKENS`, `filterOrdersForDailyBook`, `EXPIRY_FILTER_LIMITS`, `isAssetAvailableOnDay`; `ui_interactions.js` `isOrderExpiringSoon` |
| `packages/sdk/src/sizing.ts` | `odette/config.js`: `getContractQuantumStrike`, `getMaxRawContracts`, `validateNumContractsForContract`, `calculateMaxContracts`, `getMinimumPercentage`, `MIN_PREMIUM_USD` |
