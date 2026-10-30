// Adapted from thetanuts-sdk cli/src/config.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Changes: path ~/.config/odette; no referrer or rfqKeysDir fields; a config
// that holds a `referrer` key is an error (exit 4), not ignored. `--dry-run`
// never writes or deletes the file (stopForDryRun). saveConfig chmods the
// directory only when it created it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Persisted CLI configuration. Stored at `~/.config/odette/config.json` by
 * default. The file is written 0o600; the parent directory is created 0o700.
 *
 * version: 1 is the current schema. Bump and add a migration when fields
 * change incompatibly.
 */
export interface Config {
  version: 1;
  chainId: number;
  rpcUrl: string;
  privateKey?: string;
}

/**
 * `--dry-run` never writes or deletes the config file. Every command that
 * changes it calls this first and returns when it gives true. Upstream checked
 * dry-run only inside confirm(), which `--force` skips: `wallet create --force
 * --dry-run` replaced the key and `config unset privateKey --dry-run` deleted it.
 * Output goes to stderr so `-o json` stdout stays empty.
 */
export function stopForDryRun(dryRun: unknown, action: string, configPath: string): boolean {
  if (!dryRun) return false;
  process.stderr.write(`Dry-run: ${action} would change ${configPath}. Nothing was written.\n`);
  return true;
}

/** Thrown for a config file the CLI must not use. Commands exit with `exitCode` (4). */
export class ConfigError extends Error {
  readonly exitCode = 4;
}

export function defaultConfigPath(): string {
  // Honor XDG_CONFIG_HOME if set, else ~/.config.
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), '.config');
  return path.join(base, 'odette', 'config.json');
}

export function loadConfig(configPath?: string): Config | null {
  const p = configPath ?? defaultConfigPath();
  if (!fs.existsSync(p)) return null;
  // Open with O_NOFOLLOW so a pre-planted symlink cannot redirect the read to
  // an attacker-controlled path (TNU-AUDIT-0078). O_NOFOLLOW is unsupported
  // on Windows — fall back to the previous read path there.
  let raw: string;
  if (process.platform !== 'win32') {
    const NOFOLLOW = (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
    if (typeof NOFOLLOW === 'number') {
      const fd = fs.openSync(p, fs.constants.O_RDONLY | NOFOLLOW);
      try {
        raw = fs.readFileSync(fd, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
    } else {
      raw = fs.readFileSync(p, 'utf8');
    }
  } else {
    raw = fs.readFileSync(p, 'utf8');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`Config file ${p} is not valid JSON. Fix it, or run \`odette setup\`.`);
  }
  // Valid JSON is not enough: `123`, `"x"`, `[]` or `null` would reach
  // `wallet create` / `import`, which spread it and save a corrupted file.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`Config file ${p} must be a JSON object. Fix it, or run \`odette setup\`.`);
  }
  // The Odette referrer is a constant. A `referrer` key means the file was
  // written for another tool (or edited by hand); refuse it rather than
  // silently ignore an address the user thinks is in effect.
  if ('referrer' in parsed) {
    throw new ConfigError(
      `Config file ${p} has a "referrer" key. The Odette referrer is fixed and cannot be configured. Remove the key.`
    );
  }
  // Auto-tighten loose perms rather than just warning to stderr — CI piping
  // stderr to /dev/null silently swallowed the warning (TNU-AUDIT-0079).
  if (process.platform !== 'win32') {
    try {
      const stat = fs.statSync(p);
      if ((stat.mode & 0o077) !== 0) {
        const oct = (stat.mode & 0o777).toString(8);
        try {
          fs.chmodSync(p, 0o600);
          process.stderr.write(
            `notice: tightened ${p} from mode ${oct} → 600 (was world/group-readable).\n`,
          );
        } catch {
          // chmod may fail on non-owned file or unusual FS — keep the warning.
          process.stderr.write(
            `warning: ${p} has loose permissions (mode ${oct}); run 'chmod 600 <path>' to tighten\n`,
          );
        }
      }
    } catch {
      // best-effort; never block load on a stat failure
    }
  }
  return parsed as Config;
}

export function saveConfig(cfg: Config, configPath?: string): void {
  const p = configPath ?? defaultConfigPath();
  const dir = path.dirname(p);
  // Tighten the directory only when we create it: `--config ./config.json`
  // must not chmod the user's current directory (upstream chmod'ed any parent).
  const createdDir = !fs.existsSync(dir);
  if (createdDir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Write atomically: temp file in the same directory, then rename(2).
  //
  // `wallet create` discards the BIP-39 mnemonic and tells the user this file
  // is now the ONLY copy of their key. A crash, SIGINT, or ENOSPC partway
  // through an in-place writeFileSync would leave a truncated config and
  // permanently destroy that key. rename(2) within a filesystem is atomic, so
  // a reader sees either the old file or the new one — never a partial write.
  //
  // Writing to a fresh temp path also means we never follow a symlink planted
  // at `p`: rename replaces the link itself rather than writing through it,
  // which closes the write-side gap left by the O_NOFOLLOW read in loadConfig.
  const tempPath = `${p}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
    // `mode` on writeFileSync is honored only at creation and is masked by
    // umask. Force it before the rename so the key is never briefly readable.
    try {
      fs.chmodSync(tempPath, 0o600);
    } catch {
      // ignore (Windows / unsupported FS)
    }
    fs.renameSync(tempPath, p);
  } catch (err) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore cleanup errors — the original file is still intact
    }
    throw err;
  }

  if (createdDir) {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // ignore (Windows / unsupported FS)
    }
  }
}
