# Odette SDK and CLI

Buy Odette options on Base from your terminal or your own code.

- **`odette`**, the command-line tool: `@thetanuts-finance/odette-cli`
- **The SDK**, a TypeScript library: `@thetanuts-finance/odette-sdk`

Odette runs on Thetanuts Finance contracts on Base. You sign every trade with your
own wallet. No trade goes through a server: `odette` only reads the public order
list and sends your signed transaction straight to Base.

## What you can do

- See the options Odette lists right now: PUT, CALL (LINEAR_CALL) and RANGER.
- Check a trade before you make it.
- Buy an option with USDC.

The tools only **buy**. They do not sell or close positions. Odette options are
cash-settled in USDC at expiry, so there is nothing to close.

## Before you start

- [Node.js](https://nodejs.org) 20 or newer
- A wallet on **Base** with:
  - **USDC**, to pay for the option (the minimum trade is 0.50 USDC)
  - a little **ETH**, for gas (a trade costs a few cents)

## Install

```sh
npm install -g @thetanuts-finance/odette-cli
```

## Set up your wallet (once)

Use the wallet you already have:

```sh
odette wallet import
```

Paste your private key when asked. You won't see it as you paste, and that's expected.

Don't have one? `odette wallet create` makes a new wallet. Then send it USDC and some ETH on Base.

Your key is saved only on your computer, in `~/.config/odette/config.json`, and only you
can read that file. **Never share your private key or paste it into a chat.**

Check it worked:

```sh
odette wallet show       # your address
odette wallet balance    # your ETH and USDC
```

## Make a trade

**1. See what's on offer.**

```sh
odette orders --underlying ETH --type PUT
```

Each row is one option: its strike price, the expiry date and time, and the price of one contract.
`--type` can be `PUT`, `CALL` or `RANGER`.

**2. Check the trade.** Pick a strike and expiry from the list. `--collateral` is how
much USDC you want to spend. (The strike and expiry below are examples: copy real
ones from `odette orders`, because options expire every day.)

```sh
odette preview --underlying ETH --type PUT --strike 2200 --expiry 1793174400 --collateral 5
```

This shows how many contracts you get, and runs safety checks:
does the seller have the funds, do you have enough USDC, is the quote still live.
Nothing is sent.

**3. Buy.**

```sh
odette fill --underlying ETH --type PUT --strike 2200 --expiry 1793174400 --collateral 5
```

The first time, `odette` asks you to let the Odette contract take your USDC. That
permission is called an approval. Then it asks you to confirm the trade. Answer `y`
to both. When it's done, it prints the transaction link.

Prices update about once a minute. If the price moves while you're deciding, `odette`
shows the new price and asks you again.

Want to see the transaction without sending it? Add `--dry-run`. With `--yes` (no
questions), `--collateral` is required, so `odette` never buys a maximum size by itself.

**Buying a RANGER.** A RANGER pays out if the price ends inside a range. It has
four strikes, so use `--type RANGER` with `--strikes`:

```sh
odette orders --underlying BTC --type RANGER
odette preview --underlying BTC --type RANGER --strikes 78500,79000,80000,80500 --expiry 1793174400 --collateral 5
```

`preview` shows what you pay (`premium`) and the most you can be paid at expiry (`maxPayout`). In `-o json`
output the premium is the `totalCollateral` field (the name upstream uses).

## Useful flags

| Flag | What it does |
|---|---|
| `--dry-run` | Show what would happen. Send nothing. |
| `--yes` | Skip the questions (the safety checks still run). |
| `-o json` | Print JSON, for scripts. |
| `--rpc-url <url>` | Use your own Base RPC instead of the public one. |

Exit codes for scripts: `0` ok, `1` the trade or a check failed, `2` a wrong command or flag,
`3` you said no, `4` a wallet or config problem.

## For developers: the SDK

```sh
npm install @thetanuts-finance/odette-sdk ethers
```

```ts
import { JsonRpcProvider, Wallet } from 'ethers';
import { OdetteClient } from '@thetanuts-finance/odette-sdk';

const provider = new JsonRpcProvider('https://mainnet.base.org');
const signer = new Wallet(process.env.ODETTE_PRIVATE_KEY!, provider);
const client = new OdetteClient({ provider, signer });

const orders = await client.api.fetchOrders();
const order = orders.find((o) => o.product === 'PUT' && o.underlying === 'ETH')!;

const usdc = 5_000000n; // 5 USDC (USDC has 6 decimals)
const preview = client.optionBook.previewFillOrder(order, usdc);
const checks = await client.optionBook.checkFill(order, usdc); // reads only, never sends

await client.erc20.ensureAllowance(preview.collateralToken, preview.optionBook, preview.totalCollateral);
const receipt = await client.optionBook.fillOrder(order, usdc); // refuses if a check fails
```

Amounts: USDC and contract sizes have 6 decimals. Prices and strikes are in USD with 8 decimals.
The amount you pass is the USDC you want to spend, not a number of contracts.

## Good to know

- **Base only** (chain 8453).
- **Found a security problem?** Don't open a public issue. See `SECURITY.md`.
- **Every trade is tagged with Odette's referrer**, `0x94D784e81A5c8cA6E19629C73217b61a256Ea1c7`.
  You can't change it in these tools. The contract itself does not enforce the tag.
- Orders and contracts come from Thetanuts Finance. Odette is the app on top.

## License

MIT, Copyright (c) 2026 Thetanuts Finance. Parts are adapted from
[thetanuts-sdk](https://github.com/Thetanuts-Finance/thetanuts-sdk); see `NOTICE.md`.
