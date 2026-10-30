# Odette SDK

Buy Odette options on Base from your own code: trading bots, apps, scripts and AI agents.

Just want to trade from a terminal? Use the CLI,
[`@odette-fi/cli`](https://www.npmjs.com/package/@odette-fi/cli).

The SDK reads the public order list, then calls the OptionBook contract on Base
(`fillOrder`) with your own signer. You don't need to know the contract: the SDK
handles the order format, sizing and units, safety checks and approvals.
**Every fill carries Odette's referrer**, `0x94D784e81A5c8cA6E19629C73217b61a256Ea1c7`.
It is fixed; no option changes it.

Products: PUT, CALL (LINEAR_CALL) and RANGER, paid in USDC. The SDK only **buys**.
Odette options are cash-settled in USDC at expiry.

## Install

```sh
npm install @odette-fi/sdk ethers
```

Node.js 20 or newer, ethers v6. ESM and CommonJS both work.

## Quick start

```ts
import { JsonRpcProvider, Wallet } from 'ethers';
import { OdetteClient } from '@odette-fi/sdk';

const provider = new JsonRpcProvider('https://mainnet.base.org');
const signer = new Wallet(process.env.ODETTE_PRIVATE_KEY!, provider);
const client = new OdetteClient({ provider, signer });

const orders = await client.api.fetchOrders();
const order = orders.find((o) => o.product === 'PUT' && o.underlying === 'ETH')!;

const usdc = 5_000000n; // 5 USDC (USDC has 6 decimals)
const preview = client.optionBook.previewFillOrder(order, usdc);
const checks = await client.optionBook.checkFill(order, usdc); // reads only, never sends

await client.erc20.ensureAllowance(preview.collateralToken, preview.optionBook, preview.totalCollateral);
const receipt = await client.optionBook.fillOrder(order, usdc, {
  onSent: (hash) => console.log('sent', hash), // the tx hash, before it is mined
});
console.log(client.optionBook.decodeOrderFilled(receipt));
```

## Main methods

| Method | What it does |
|---|---|
| `new OdetteClient({ provider, signer? })` | Base (8453) only. Refuses a `referrer` option. |
| `client.api.fetchOrders()` | The orders the Odette app lists now (PUT, LINEAR_CALL, RANGER). |
| `client.optionBook.previewFillOrder(order, usdc?)` | Contracts, premium (`totalCollateral`), `maxPayout`, step, min, max. No network. |
| `client.optionBook.checkFill(order, usdc?)` | The pre-send checks against Base: chain, order, size, maker funds, your balance and allowance, simulation. Never sends. |
| `client.optionBook.encodeFillOrder(order, usdc?)` | `{ to, data }` for any wallet library (for example a smart wallet). |
| `client.optionBook.fillOrder(order, usdc?, { onSent? })` | Runs the checks, then sends `fillOrder`. Refuses to send if a check fails. |
| `client.optionBook.decodeOrderFilled(receipt)` | The `OrderFilled` event: option address, premium, fee, referrer. |
| `client.erc20.ensureAllowance(token, spender, amount)` | Approves USDC if needed. |

Without `usdc`, preview, encode and fill use the order's **maximum** size.

## Units

- USDC amounts and contract sizes have 6 decimals (`5_000000n` = 5 USDC).
- Prices and strikes are USD with 8 decimals.
- The amount you pass is the USDC premium you want to spend, not a number of
  contracts. Sizes round down to the contract's step; the minimum premium is 0.50 USDC.

## Errors

Errors are `OdetteError` with a `code`, for example `CHECK_FAILED`, `SIGNER_REQUIRED`,
`INVALID_ORDER` or `TRANSACTION_CANCELLED`. A fill that was sent never reports as failed
because of a callback or a logger.

## Good to know

- **Base only** (chain 8453).
- The contracts and the order feed are Thetanuts Finance's. Odette is the app on top.
- The referrer tag is a default in this SDK, not enforced by the contract.
- **Found a security problem?** Don't open a public issue. See [SECURITY.md](https://github.com/Shawnchee/odette-sdk/blob/main/SECURITY.md).

## License

MIT, Copyright (c) 2026 Thetanuts Finance. Parts are adapted from
[thetanuts-sdk](https://github.com/Thetanuts-Finance/thetanuts-sdk); see [NOTICE.md](https://github.com/Shawnchee/odette-sdk/blob/main/NOTICE.md).
