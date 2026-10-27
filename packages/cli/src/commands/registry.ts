// Adapted from thetanuts-sdk cli/src/commands/registry.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Changes: Odette commands only. The book commands register at top level.
import type { Command } from 'commander';
import * as setup from './setup.js';
import * as config from './config.js';
import * as wallet from './wallet.js';
import * as book from './book.js';

/**
 * Centralized command registration. Each module under `commands/` exports a
 * `register(program)` function that attaches its subcommand tree to the root.
 */
export function registerCommands(program: Command): void {
  setup.register(program);
  config.register(program);
  wallet.register(program);
  book.register(program);
}
