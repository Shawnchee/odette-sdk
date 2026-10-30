#!/usr/bin/env node
// Copyright (c) 2026 Thetanuts Finance. MIT License.
//
// Install smoke test: pack both packages exactly as `npm publish` would, install
// the tarballs into a fresh project, and use them the way a user does:
//   - `odette --help` and `odette --version` from the installed bin
//   - `import` (ESM) and `require` (CJS) of the SDK
//   - TypeScript typecheck of a consumer file against the published .d.ts
//   - the tarballs contain dist, LICENSE, NOTICE.md, README.md and no src
// Offline except for `npm install` of the public dependencies. Never publishes.
// Run after `npm run build`. Exits non-zero on any failure.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'odette-smoke-'));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let failures = 0;
function step(name, fn) {
  try {
    const note = fn();
    console.log(`ok   ${name}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    failures += 1;
    console.log(`FAIL ${name}: ${(e.stderr || e.message || String(e)).toString().trim().split('\n').slice(-5).join(' | ')}`);
  }
}

const tarballs = {};
for (const pkg of ['sdk', 'cli']) {
  step(`npm pack packages/${pkg}`, () => {
    const out = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', work], join(root, 'packages', pkg)));
    const files = out[0].files.map((f) => f.path);
    for (const need of ['LICENSE', 'NOTICE.md', 'README.md', 'package.json']) {
      if (!files.includes(need)) throw new Error(`${need} missing from tarball`);
    }
    if (!files.some((f) => f.startsWith('dist/'))) throw new Error('dist/ missing from tarball (run npm run build)');
    if (files.some((f) => f.startsWith('src/') || f.startsWith('test/'))) throw new Error('src/ or test/ shipped in tarball');
    tarballs[pkg] = join(work, out[0].filename);
    return `${out[0].filename}, ${files.length} files, ${out[0].size} bytes`;
  });
}

const app = join(work, 'app');
step('install both tarballs into a fresh project', () => {
  execFileSync('mkdir', ['-p', app]);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'odette-smoke-app', private: true, type: 'module' }));
  run(npm, ['install', '--no-audit', '--no-fund', tarballs.sdk, tarballs.cli], app);
  return readdirSync(join(app, 'node_modules', '@odette-fi')).join(', ');
});

const bin = join(app, 'node_modules', '.bin', 'odette');
step('odette --version', () => run(bin, ['--version'], app).trim());
step('odette --help lists the Odette commands', () => {
  const help = run(bin, ['--help'], app);
  for (const c of ['orders', 'preview', 'check', 'fill', 'wallet', 'setup', 'config']) {
    if (!help.includes(c)) throw new Error(`help is missing ${c}`);
  }
  if (help.includes('--referrer')) throw new Error('help offers --referrer');
});

step('ESM import of the SDK', () => {
  writeFileSync(join(app, 'esm.mjs'), `
    import { OdetteClient, ODETTE_REFERRER, OPTION_BOOK_R12 } from '@odette-fi/sdk';
    import { JsonRpcProvider } from 'ethers';
    const c = new OdetteClient({ provider: new JsonRpcProvider('https://mainnet.base.org', 8453, { staticNetwork: true }) });
    if (c.referrer !== ODETTE_REFERRER || c.optionBook.contractAddress !== OPTION_BOOK_R12) process.exit(1);
    console.log(c.referrer);`);
  return run(process.execPath, ['esm.mjs'], app).trim();
});

step('CJS require of the SDK', () => {
  writeFileSync(join(app, 'cjs.cjs'), `
    const { ODETTE_REFERRER, contractsForUsdc } = require('@odette-fi/sdk');
    if (typeof contractsForUsdc !== 'function') process.exit(1);
    console.log(ODETTE_REFERRER);`);
  return run(process.execPath, ['cjs.cjs'], app).trim();
});

step('TypeScript consumer typechecks against the published types', () => {
  writeFileSync(join(app, 'consumer.ts'), `
    import { OdetteClient, type OdetteOrder, type FillPreview } from '@odette-fi/sdk';
    import { JsonRpcProvider } from 'ethers';
    export async function demo(): Promise<FillPreview | undefined> {
      const client = new OdetteClient({ provider: new JsonRpcProvider('https://mainnet.base.org') });
      const orders: OdetteOrder[] = await client.api.fetchOrders();
      return orders[0] ? client.optionBook.previewFillOrder(orders[0], 25_000000n) : undefined;
    }
    // @ts-expect-error the referrer is not a config option
    new OdetteClient({ provider: new JsonRpcProvider('x'), referrer: '0x0' });`);
  writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false, types: [] },
    files: ['consumer.ts'],
  }));
  run(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], app);
});

console.log(failures === 0 ? `\nsmoke install passed (${work})` : `\n${failures} step(s) failed (${work})`);
process.exit(failures === 0 ? 0 : 1);
