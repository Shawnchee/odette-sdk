// Adapted from thetanuts-sdk cli/src/client.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Changes: OdetteClient; Base only; referrer resolution removed (the referrer is
// the constant ODETTE_REFERRER); RFQ keystore removed; ODETTE_FEED_URL.
import { ethers } from 'ethers';
import { OdetteClient, ODETTE_REFERRER } from '@thetanuts-finance/odette-sdk';
import type { OptionValues } from 'commander';
import { loadConfig, ConfigError, type Config } from './config.js';
import { DEFAULT_CHAIN_ID, DEFAULT_RPC_URL } from './defaults.js';

/**
 * Resolution order for any setting (descending priority):
 *   1. CLI global flag (e.g. --rpc-url, --private-key)
 *   2. Environment variable (ODETTE_RPC_URL, ODETTE_PRIVATE_KEY, ODETTE_FEED_URL)
 *   3. Config file at --config or ~/.config/odette/config.json
 *   4. Hardcoded default (see defaults.ts — Base mainnet by default)
 *
 * `getClient` always returns a read-capable client. The signer is only attached
 * when a private key resolves; modules that need a signer should call
 * `requireSigner(client)` for a clearer error message.
 *
 * The referrer is not a setting. It is always ODETTE_REFERRER.
 */

export interface GetClientResult {
  client: OdetteClient;
  /** True iff a signer was attached (a private key resolved). */
  hasSigner: boolean;
  chainId: number;
  rpcUrl: string;
  /** Always ODETTE_REFERRER. Commands report it; nothing can change it. */
  referrer: string;
}

function resolveChainId(cfg: Config | null): number {
  // The CLI is Base-only. A config for another chain is a config error.
  if (cfg?.chainId !== undefined && cfg.chainId !== DEFAULT_CHAIN_ID) {
    throw new ConfigError(`Config chainId is ${cfg.chainId}. Odette trades on Base (${DEFAULT_CHAIN_ID}) only.`);
  }
  return DEFAULT_CHAIN_ID;
}

function resolveRpcUrl(opts: OptionValues, cfg: Config | null, _chainId: number): string {
  const fromFlag = opts.rpcUrl as string | undefined;
  let rpcUrl: string;
  if (fromFlag) {
    rpcUrl = fromFlag;
  } else {
    const fromEnv = process.env.ODETTE_RPC_URL;
    if (fromEnv) {
      rpcUrl = fromEnv;
    } else {
      rpcUrl = cfg?.rpcUrl ?? DEFAULT_RPC_URL;
    }
  }
  // Reject non-https RPC URLs unless the host is localhost. Signed tx
  // broadcasts over plain http are vulnerable to MITM tampering of gas /
  // nonce / data. Localhost is the only sane dev escape hatch.
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error(`odette: RPC URL is not a valid URL (got ${rpcUrl})`);
  }
  const host = parsed.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !isLocal) {
    throw new Error(
      `odette: RPC URL must use https:// (got ${rpcUrl}); pass an https URL or use a localhost RPC for dev`
    );
  }
  return rpcUrl;
}

// Defined inline (not imported) to avoid pulling a command module into client bootstrap
const PRIVATE_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;

/**
 * Best-effort wipe of `--private-key <value>` from `process.argv` so the key
 * does not persist in `/proc/PID/cmdline` for longer than necessary
 * (TNU-AUDIT-0016).
 *
 * Note: this cannot redact shell history, `ps aux` snapshots, or
 * Node-internal copies — pass the key via env, stdin, or config instead.
 */
function scrubPrivateKeyFromArgv(): void {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--private-key' || arg === '-p') {
      if (i + 1 < argv.length) {
        argv[i + 1] = '[REDACTED]';
      }
    } else if (typeof arg === 'string' && arg.startsWith('--private-key=')) {
      argv[i] = '--private-key=[REDACTED]';
    }
  }
}

function resolvePrivateKey(opts: OptionValues, cfg: Config | null): string | undefined {
  let key: string | undefined;
  let source: string | undefined;
  const fromFlag = opts.privateKey as string | undefined;
  if (fromFlag) {
    key = fromFlag;
    source = '--private-key flag';
    // Emit one-time warning so users see this risk surface — argv is visible
    // via `ps aux` and persists in shell history (TNU-AUDIT-0016).
    if (!process.env.ODETTE_SUPPRESS_PRIVATE_KEY_WARNING) {
      process.stderr.write(
        'odette: warning — passing --private-key on the command line exposes ' +
          'the key in shell history and process listings. Prefer ODETTE_PRIVATE_KEY ' +
          'env var or `odette wallet import` for persistent storage.\n',
      );
    }
    scrubPrivateKeyFromArgv();
  } else {
    const fromEnv = process.env.ODETTE_PRIVATE_KEY;
    if (fromEnv) {
      key = fromEnv;
      source = 'ODETTE_PRIVATE_KEY env var';
    } else if (cfg?.privateKey) {
      key = cfg.privateKey;
      source = 'config file';
    }
  }
  if (key === undefined) return undefined;
  // Validate BEFORE handing to ethers — a malformed key would otherwise be echoed verbatim in ethers' "invalid BytesLike value" error message
  if (!PRIVATE_KEY_REGEX.test(key)) {
    throw new Error(`Invalid private key from ${source}. Expected 0x-prefixed 64-char hex string.`);
  }
  return key;
}

/**
 * Build an `OdetteClient` from the merged CLI options object.
 *
 * Pass `opts` from `getGlobalOpts(cmd)`. The function does not touch the
 * network; it constructs an ethers `JsonRpcProvider` (which is lazy) and
 * returns immediately.
 */
export function getClient(opts: OptionValues): GetClientResult {
  const configPath = opts.config as string | undefined;
  const cfg = loadConfig(configPath);

  const chainId = resolveChainId(cfg);
  const rpcUrl = resolveRpcUrl(opts, cfg, chainId);
  const privateKey = resolvePrivateKey(opts, cfg);
  const feedUrl = process.env.ODETTE_FEED_URL;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = privateKey ? new ethers.Wallet(privateKey, provider) : undefined;

  const client = new OdetteClient({
    chainId: 8453,
    provider,
    ...(signer ? { signer } : {}),
    ...(feedUrl ? { feedUrl } : {}),
  });

  return {
    client,
    hasSigner: Boolean(signer),
    chainId,
    rpcUrl,
    referrer: ODETTE_REFERRER,
  };
}

/**
 * Throw a friendly error when a command needs a signer but none was supplied.
 * Implementer agents call this at the top of any write-op action.
 */
export function requireSigner(result: GetClientResult): void {
  if (!result.hasSigner) {
    // Exit 4: a wallet error (PRD 7.2), not a runtime failure.
    throw Object.assign(
      new Error('This command requires a signer. Provide --private-key, set ODETTE_PRIVATE_KEY, or run `odette setup`.'),
      { exitCode: 4 }
    );
  }
}
