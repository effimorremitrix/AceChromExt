/**
 * Entry point for the bundled `ace-export` command.
 *
 * Nothing but wiring: argv in, exit code out.
 */

import { runCli } from './ui/cli.js';

const code = await runCli(process.argv.slice(2), {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
});

process.exitCode = code;
