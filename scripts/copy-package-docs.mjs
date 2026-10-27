#!/usr/bin/env node
// Copyright (c) 2026 Thetanuts Finance. MIT License.
// prepack: copy the repo LICENSE and NOTICE.md into the package being packed,
// so each npm tarball carries them. Each package keeps its own README.md
// (packages/cli/README.md, packages/sdk/README.md). Run from a package directory.
import { copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd(), '..', '..');
for (const name of ['LICENSE', 'NOTICE.md']) {
  copyFileSync(join(root, name), join(process.cwd(), name));
}
// stderr, so `npm pack --json` stdout stays parseable.
console.error(`copied LICENSE and NOTICE.md into ${process.cwd()}`);
