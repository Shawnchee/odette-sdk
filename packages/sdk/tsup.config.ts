// Copyright (c) 2026 Thetanuts Finance. MIT License.
// Same build as thetanuts-sdk tsup.config.ts: CJS + ESM + type declarations, ethers external.
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  target: 'es2022',
  outDir: 'dist',
  external: ['ethers'],
});
