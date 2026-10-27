// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Run the CLI as a subprocess against the stubbed network. Returns { code, stdout, stderr }.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../src/index.ts', import.meta.url));
const stub = new URL('./stub-net.mjs', import.meta.url).href;

/** A fresh temp dir per suite, so no test touches ~/.config/odette. */
export function tempDir() {
  return mkdtempSync(join(tmpdir(), 'odette-cli-test-'));
}

/** Write a config file with mode 0600 and return its path. */
export function writeConfig(dir, cfg, name = 'config.json') {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(cfg), { mode: 0o600 });
  return p;
}

export function runCli(args, { env = {}, input = '' } = {}) {
  const r = spawnSync(process.execPath, ['--conditions=odette-source', '--import', 'tsx', '--import', stub, entry, ...args], {
    input,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NO_COLOR: '1',
      COLUMNS: '200',
      ...env,
    },
  });
  if (r.error) throw r.error;
  return { code: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
}
