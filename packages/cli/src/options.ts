// Adapted from thetanuts-sdk cli/src/options.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Changes: --chain dropped (Base only); --referrer dropped (the Odette referrer is fixed);
// env var and path names. --output accepts only its listed formats.
import { Option, type Command, type OptionValues } from 'commander';

/**
 * Global option spec for the root `odette` command.
 * implementer agents extend per-command options but should NOT add new global
 * flags without coordination.
 *
 * Note: commander emits `--no-color` automatically as the negation of
 * `--color` (default true). We declare it that way so users still see
 * `--no-color` in `--help`.
 */
export function addGlobalOptions(program: Command): void {
  program
    .addOption(new Option('-o, --output <fmt>', 'output format').choices(['table', 'json', 'csv', 'yaml']).default('table'))
    .option('--dry-run', 'simulate without sending transactions', false)
    .option('--yes', 'skip interactive confirmation prompts', false)
    .option('--rpc-url <url>', 'override the RPC endpoint for the active chain')
    .option(
      '--private-key <key>',
      'hex private key for signing. WARNING: argv lands in shell history and ps aux — ' +
        'prefer ODETTE_PRIVATE_KEY env var, or `odette wallet import` to store in the config.'
    )
    .option('--config <path>', 'path to a config file (default: ~/.config/odette/config.json)')
    .option('--json-errors', 'emit errors as JSON on stderr', false)
    .option('--color', 'enable ANSI color output', true)
    .option('--no-color', 'disable ANSI color output');
}

/**
 * Walk up `cmd.parent` to collect options from every ancestor command, so a
 * subcommand action can read both its own opts and the root global opts.
 *
 * Commander does this implicitly with `inheritedOptionValues`, but we wrap it
 * here so implementer code has a single helper to reach for and a clearer
 * call site.
 */
export function getGlobalOpts(cmd: Command): OptionValues {
  // commander supports cmd.optsWithGlobals() in v12; prefer that when
  // available, fall back to manual ancestor walk otherwise.
  const withGlobals = (cmd as unknown as { optsWithGlobals?: () => OptionValues })
    .optsWithGlobals;
  if (typeof withGlobals === 'function') {
    return withGlobals.call(cmd);
  }
  const merged: OptionValues = {};
  let cursor: Command | null = cmd;
  while (cursor) {
    Object.assign(merged, cursor.opts());
    cursor = cursor.parent;
  }
  return merged;
}
