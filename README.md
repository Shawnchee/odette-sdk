# Odette SDK and CLI

Trade Odette options on Base from a terminal or from your own code.

| Package | For | Install |
|---|---|---|
| [`@thetanuts-finance/odette-cli`](https://www.npmjs.com/package/@thetanuts-finance/odette-cli) | Traders: the `odette` command | `npm install -g @thetanuts-finance/odette-cli` |
| [`@thetanuts-finance/odette-sdk`](https://www.npmjs.com/package/@thetanuts-finance/odette-sdk) | Builders: bots, apps, scripts, AI agents | `npm install @thetanuts-finance/odette-sdk ethers` |

- **CLI guide:** [packages/cli/README.md](packages/cli/README.md): wallet setup, browsing orders, and your first trade.
- **SDK guide:** [packages/sdk/README.md](packages/sdk/README.md): quick start and main methods.

## How it works

1. Read the public order list (the same one the Odette app uses).
2. Check the trade against Base: your balance, the seller's funds, a simulation.
3. Send `OptionBook.fillOrder` on Base, signed with **your** wallet.

No trade goes through a server. Every fill carries Odette's referrer,
`0x94D784e81A5c8cA6E19629C73217b61a256Ea1c7`, so it counts as an Odette trade.
The tools only buy PUT, CALL and RANGER options with USDC. They settle in cash at expiry.

## Repository

- `packages/sdk`: the SDK.
- `packages/cli`: the CLI, built on the SDK.
- `npm test` runs every test suite. `npm run drift` compares the copied contract data with Thetanuts and Base.
- Changes are listed in [CHANGELOG.md](CHANGELOG.md).
- Security problems: [SECURITY.md](SECURITY.md). Please don't open public issues for them.

## License

MIT, Copyright (c) 2026 Thetanuts Finance. Parts are adapted from
[thetanuts-sdk](https://github.com/Thetanuts-Finance/thetanuts-sdk); see [NOTICE.md](NOTICE.md).
