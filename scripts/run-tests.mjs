#!/usr/bin/env node
// Copyright (c) 2026 Thetanuts Finance. MIT License.
//
// Run every test suite in packages/*/test and judge each one by its EXIT CODE.
// Output text is never read to decide pass or fail. A suite that dies at
// import, is killed by a signal, or times out is a failure. Zero suites found
// is a failure.
//
// Suites are listed by globbing every script extension, so a .ts or .cjs suite
// is not skipped by accident. Files in subdirectories (fixtures/) are not suites.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUITE_EXT = /\.(mjs|cjs|js|mts|cts|ts)$/;
const TIMEOUT_MS = 120_000;

function listSuites() {
  const suites = [];
  const ignored = [];
  const packagesDir = join(root, 'packages');
  for (const pkg of readdirSync(packagesDir).sort()) {
    const testDir = join(packagesDir, pkg, 'test');
    let entries;
    try {
      entries = readdirSync(testDir).sort();
    } catch {
      continue;
    }
    for (const name of entries) {
      const path = join(testDir, name);
      if (!statSync(path).isFile()) continue;
      if (SUITE_EXT.test(name) && !name.endsWith('.d.ts')) suites.push(path);
      else ignored.push(path);
    }
  }
  return { suites, ignored };
}

const { suites, ignored } = listSuites();
for (const path of ignored) console.log(`note: not a suite, skipped: ${relative(root, path)}`);

if (suites.length === 0) {
  console.error('FAIL: no test suites found under packages/*/test.');
  process.exit(1);
}

const results = [];
for (const path of suites) {
  const name = relative(root, path);
  console.log(`\n=== ${name}`);
  const started = Date.now();
  const r = spawnSync(process.execPath, ['--conditions=odette-source', '--import', 'tsx', path], {
    cwd: root,
    stdio: 'inherit',
    timeout: TIMEOUT_MS,
    env: process.env,
  });
  const ms = Date.now() - started;
  let verdict;
  if (r.error) verdict = `FAIL (could not run: ${r.error.message})`;
  else if (r.signal) verdict = `FAIL (killed by ${r.signal})`;
  else if (r.status !== 0) verdict = `FAIL (exit ${r.status})`;
  else verdict = 'PASS';
  results.push({ name, verdict, ms });
}

console.log('\n=== summary');
for (const { name, verdict, ms } of results) console.log(`${verdict.padEnd(28)} ${name} (${ms} ms)`);
const failed = results.filter((r) => r.verdict !== 'PASS').length;
console.log(`${results.length - failed}/${results.length} suites passed`);
process.exit(failed === 0 ? 0 : 1);
