#!/usr/bin/env node
// Adapted from thetanuts-sdk cli/src/index.ts at 9e72aef1ab5c008ccc92352fa5048bd08c452ede.
// MIT License, Copyright (c) 2026 Thetanuts Finance.
// Changes: name and description. The fallback error print is redacted.
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { registerCommands } from './commands/registry.js';
import { addGlobalOptions } from './options.js';
import { renderError, redactSecrets } from './output.js';

// Resolve the CLI version from package.json at runtime so bumping
// `cli/package.json` is the only edit needed for a release. `createRequire`
// keeps package.json outside the TypeScript `rootDir` (./src) while still
// resolving relative to either `cli/src/index.ts` (dev via tsx) or
// `cli/dist/index.js` (production bin) — both reach `cli/package.json`.
const requireFromHere = createRequire(import.meta.url);
const pkg = requireFromHere('../package.json') as { version: string };

// Exit cleanly when downstream (e.g. `| head`) closes the pipe early.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const program = new Command();
program
  .name('odette')
  .description('Odette command-line interface: trade Odette orders on the Thetanuts OptionBook (Base)')
  .version(pkg.version);

// Global flags live on the root command, so `odette fill --help`
// would not list `--dry-run` / `--output` at all — making a
// present flag look missing from the help path people actually use.
program.configureHelp({ showGlobalOptions: true });

addGlobalOptions(program);
registerCommands(program);

// Commander exits 1 for every parse failure, but the CLI documents exit 2 as
// "usage error (bad flags, missing required arg)" and reserves 1 for generic
// runtime failures — network, RPC, contract revert. Without this mapping,
// automation cannot tell a typo'd flag apart from a reverted transaction.
//
// The set is Commander's own error codes for input the user got wrong. Anything
// unrecognised keeps Commander's exit code rather than being coerced, so a new
// error code in a future Commander release fails visibly instead of silently
// reporting itself as a usage error.
const USAGE_ERROR_CODES = new Set([
  'commander.missingArgument',
  'commander.missingMandatoryOptionValue',
  'commander.optionMissingArgument',
  'commander.unknownOption',
  'commander.unknownCommand',
  'commander.invalidArgument',
  'commander.excessArguments',
  'commander.conflictingOption',
  // A group command invoked with no subcommand (`odette wallet`, or bare
  // `odette`) prints help via help({ error: true }), which throws
  // `commander.help` with exitCode 1. That is an incomplete command — a usage
  // error by the README's own definition — not a runtime failure. Safe to map
  // here because successful `--help` uses the distinct `commander.helpDisplayed`
  // code with exitCode 0, which the guard below returns on before reaching this.
  'commander.help',
]);

// exitOverride is per-Command and is NOT inherited by subcommands, so walk the
// whole tree — `odette wallet approve` is a grandchild of the root command.
function mapUsageExitCodes(cmd: Command): void {
  cmd.exitOverride((err) => {
    // --help and --version are successful terminations, not failures.
    if (err.exitCode === 0) process.exit(0);
    process.exit(USAGE_ERROR_CODES.has(err.code) ? 2 : err.exitCode);
  });
  for (const sub of cmd.commands) mapUsageExitCodes(sub as Command);
}
mapUsageExitCodes(program);

program.parseAsync(process.argv).catch((err) => {
  // Try to use the structured error renderer if we can detect --json-errors,
  // otherwise print just the message — never the stack
  const jsonErrors = process.argv.includes('--json-errors');
  try {
    renderError(err, { jsonErrors });
  } catch {
    process.stderr.write(redactSecrets((err as Error)?.message ?? String(err)) + '\n');
  }
  process.exit(1);
});
