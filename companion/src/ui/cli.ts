/**
 * `ace-export` - the QuickBooks Desktop companion.
 *
 * The whole point of this command is that nobody has to look at qbXML. It
 * finds the invoice, shows what will be filed and where each value came from,
 * and writes the workbook the ACE Helper extension imports.
 *
 * `runCli` takes its argv and its output streams as arguments so the commands
 * are testable without a terminal, a QuickBooks, or a subprocess.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateShipment } from '../../../src/excel/validator.js';
import {
  DEFAULT_CONFIG,
  loadConfigFile,
  starterConfig,
  writeConfigFile,
  type AceExportConfig,
} from '../config.js';
import { QuickBooksDesktopAdapter } from '../adapter/QuickBooksDesktopAdapter.js';
import { AdapterError } from '../adapter/InvoiceSourceAdapter.js';
import { customFieldNames } from '../qbxml/parse.js';
import { ComQbxmlTransport } from '../transport/ComTransport.js';
import { FileQbxmlTransport } from '../transport/FileTransport.js';
import type { QbxmlTransport } from '../transport/QbxmlTransport.js';
import { renderInvoiceList, renderPreview } from './preview.js';
import { runGui } from './server.js';

export const DEFAULT_CONFIG_FILE = 'ace-export.config.json';

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Injected by tests so no QuickBooks or file is needed. */
  makeTransport?: (options: ResolvedOptions) => QbxmlTransport;
}

export interface ResolvedOptions {
  config: AceExportConfig;
  configPath: string | null;
  fromFile: string | null;
  launch: boolean;
  ascii: boolean;
  force: boolean;
  dryRun: boolean;
  outputDirectory: string | null;
  fileName: string | null;
  overrides: Record<string, string>;
  /** Per-commodity-line overrides, keyed by 1-based line number. */
  lineOverrides: Record<number, Record<string, string>>;
  limit: number | null;
  contains: string | null;
  customer: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  port: number | null;
}

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string[]>;
  booleans: Set<string>;
}

const BOOLEAN_FLAGS = new Set(['ascii', 'force', 'dry-run', 'launch', 'help', 'version']);

const VALUE_FLAGS = new Set([
  'config',
  'from-file',
  'out',
  'file-name',
  'set',
  'set-line',
  'limit',
  'contains',
  'customer',
  'from',
  'to',
  'company-file',
  'qbxml-version',
  'weight-uom',
  'port',
]);

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string[]>();
  const booleans = new Set<string>();
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;

    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }

    const bare = token.replace(/^--?/, '');
    const [name, inlineValue] = bare.includes('=') ? [bare.slice(0, bare.indexOf('=')), bare.slice(bare.indexOf('=') + 1)] : [bare, undefined];

    if (BOOLEAN_FLAGS.has(name)) {
      booleans.add(name);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      throw new CliError(`Unknown option "--${name}". Run "ace-export --help".`);
    }

    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith('--'))) {
      throw new CliError(`Option "--${name}" needs a value.`);
    }
    if (inlineValue === undefined) index += 1;

    const existing = flags.get(name) ?? [];
    existing.push(value);
    flags.set(name, existing);
  }

  const command = positional.shift() ?? '';
  return { command, positional, flags, booleans };
}

function single(args: ParsedArgs, name: string): string | null {
  const values = args.flags.get(name);
  if (!values || !values.length) return null;
  return values[values.length - 1] as string;
}

function integer(args: ParsedArgs, name: string): number | null {
  const raw = single(args, name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new CliError(`--${name} must be a positive whole number; got "${raw}".`);
  return value;
}

export function resolveOptions(args: ParsedArgs): ResolvedOptions {
  // For `init`, --config names the file to *write*, so it must not exist yet.
  const writingConfig = args.command === 'init';
  const explicitConfig = single(args, 'config');
  let configPath: string | null = null;
  if (explicitConfig) {
    configPath = resolve(explicitConfig);
    if (!writingConfig && !existsSync(configPath)) throw new CliError(`No configuration file at "${configPath}".`);
  } else if (existsSync(DEFAULT_CONFIG_FILE)) {
    configPath = resolve(DEFAULT_CONFIG_FILE);
  }

  const config = configPath && !writingConfig ? loadConfigFile(configPath) : structuredClone(DEFAULT_CONFIG);

  const version = single(args, 'qbxml-version');
  if (version) config.qbxmlVersion = version;
  const companyFile = single(args, 'company-file');
  if (companyFile) config.companyFile = companyFile;
  const weightUom = single(args, 'weight-uom');
  if (weightUom) {
    if (weightUom !== 'kg' && weightUom !== 'lb') throw new CliError('--weight-uom must be kg or lb.');
    config.output.weightUom = weightUom;
  }

  const overrides: Record<string, string> = {};
  for (const entry of args.flags.get('set') ?? []) {
    const split = entry.indexOf('=');
    if (split < 1) throw new CliError(`--set expects field=value; got "${entry}".`);
    overrides[entry.slice(0, split).trim()] = entry.slice(split + 1);
  }

  // --set-line 1.scheduleB=0802.12.0000
  const lineOverrides: Record<number, Record<string, string>> = {};
  for (const entry of args.flags.get('set-line') ?? []) {
    const split = entry.indexOf('=');
    if (split < 1) throw new CliError(`--set-line expects line.field=value; got "${entry}".`);
    const target = entry.slice(0, split).trim();
    const dot = target.indexOf('.');
    if (dot < 1) throw new CliError(`--set-line expects line.field=value; got "${entry}".`);
    const line = Number(target.slice(0, dot));
    if (!Number.isInteger(line) || line < 1) {
      throw new CliError(`--set-line needs a commodity line number; got "${target.slice(0, dot)}".`);
    }
    const field = target.slice(dot + 1).trim();
    const existing = lineOverrides[line] ?? {};
    existing[field] = entry.slice(split + 1);
    lineOverrides[line] = existing;
  }

  return {
    config,
    configPath,
    fromFile: single(args, 'from-file'),
    launch: args.booleans.has('launch'),
    ascii: args.booleans.has('ascii'),
    force: args.booleans.has('force'),
    dryRun: args.booleans.has('dry-run'),
    outputDirectory: single(args, 'out'),
    fileName: single(args, 'file-name'),
    overrides,
    lineOverrides,
    limit: integer(args, 'limit'),
    contains: single(args, 'contains'),
    customer: single(args, 'customer'),
    dateFrom: single(args, 'from'),
    dateTo: single(args, 'to'),
    port: integer(args, 'port'),
  };
}

export function makeTransport(options: ResolvedOptions): QbxmlTransport {
  if (options.fromFile) return FileQbxmlTransport.fromFile(options.fromFile);
  return new ComQbxmlTransport({
    appName: options.config.appName,
    appId: options.config.appId,
    companyFile: options.config.companyFile,
    launchQuickBooks: options.launch,
  });
}

export function buildAdapter(options: ResolvedOptions, io: CliIo): QuickBooksDesktopAdapter {
  const transport = (io.makeTransport ?? makeTransport)(options);
  return new QuickBooksDesktopAdapter(transport, options.config);
}

const HELP = `ace-export - QuickBooks Desktop -> ACE Helper import workbook

Usage
  ace-export probe                          check that QuickBooks is reachable
  ace-export list [filters]                 list invoices
  ace-export show <invoice>                 preview one invoice, export nothing
  ace-export fields <invoice>               list the custom fields QuickBooks returns
  ace-export export <invoice> [options]     write ACE_Invoice_<number>.xlsx
  ace-export gui [--port N]                 the local ACE Export Helper form
  ace-export init [--config path]           write a starter configuration file

<invoice> is an invoice number ("CN-1042"), or a QuickBooks TxnID. Prefix with
ref: or txn: when a number could be either.

List filters
  --contains TEXT       invoice number contains TEXT
  --customer NAME       Customer:Job full name
  --from YYYY-MM-DD     transaction date from
  --to YYYY-MM-DD       transaction date to
  --limit N             at most N invoices

Export options
  --out DIR             directory to write into (default: config output.directory)
  --file-name NAME      file name, overriding the configured pattern
  --set field=value     supply a header field QuickBooks does not hold, e.g.
                        --set vessel="MSC FIRENZE" --set containerNumber=MSCU1234567
  --set-line N.field=V  supply an ACE-only field on one commodity line, e.g.
                        --set-line 1.scheduleB=0802.12.0000 --set-line 1.licenseCode=C33
                        (Schedule B, origin, licence code, ECCN, export info
                        code, description and the second quantity/unit. Quantity
                        1, the value and the weight come from the invoice and
                        cannot be overridden here.)
  --force               replace an existing file
  --dry-run             preview and validate, write nothing

Everywhere
  --config PATH         configuration file (default: ./ace-export.config.json)
  --from-file PATH      replay a saved qbXML response instead of calling QuickBooks
  --company-file PATH   company file to open (default: the one already open)
  --qbxml-version V     qbXML version to request (default: 16.0)
  --weight-uom kg|lb    unit written to the ShippingWeight column
  --launch              let QuickBooks start itself if it is closed
  --ascii               plain markers instead of check marks
  --help                this text

Nothing is uploaded. Every request goes to the QuickBooks running on this
machine, and the workbook is written to this machine.`;

async function commandProbe(options: ResolvedOptions, io: CliIo): Promise<number> {
  const adapter = buildAdapter(options, io);
  try {
    const probe = await adapter.probe();
    io.out(`Source: ${adapter.label}`);
    if (!probe.ok) {
      io.err(`Not reachable: ${probe.description}`);
      return 1;
    }
    io.out(`Connected: ${probe.description}`);
    for (const [key, value] of Object.entries(probe.details)) io.out(`  ${key}: ${value}`);
    return probe.details['warning'] ? 1 : 0;
  } finally {
    await adapter.close();
  }
}

async function commandList(options: ResolvedOptions, io: CliIo): Promise<number> {
  const adapter = buildAdapter(options, io);
  try {
    const summaries = await adapter.listInvoices({
      ...(options.contains ? { referenceContains: options.contains } : {}),
      ...(options.customer ? { customerName: options.customer } : {}),
      ...(options.dateFrom ? { dateFrom: options.dateFrom } : {}),
      ...(options.dateTo ? { dateTo: options.dateTo } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
    });
    io.out(renderInvoiceList(summaries));
    return 0;
  } finally {
    await adapter.close();
  }
}

async function commandShow(invoiceId: string, options: ResolvedOptions, io: CliIo): Promise<number> {
  const adapter = buildAdapter(options, io);
  try {
    const invoice = await adapter.getInvoice(invoiceId);
    const mapping = adapter.toCanonicalInvoice(invoice, {
      overrides: options.overrides,
      lineOverrides: options.lineOverrides,
    });
    const validation = validateShipment(mapping.shipment);
    io.out(renderPreview(mapping, validation, { ascii: options.ascii }));
    return validation.errors > 0 ? 1 : 0;
  } finally {
    await adapter.close();
  }
}

async function commandFields(invoiceId: string, options: ResolvedOptions, io: CliIo): Promise<number> {
  const adapter = buildAdapter(options, io);
  try {
    const invoice = await adapter.getInvoice(invoiceId);
    const names = customFieldNames(invoice.raw);
    io.out(`Invoice ${invoice.summary.reference} (${invoice.summary.id})`);
    if (!names.length) {
      io.out('');
      io.out('QuickBooks returned no custom fields for this invoice.');
      io.out('Either none are defined, or they are not on this transaction. See');
      io.out('docs/QUICKBOOKS-INTEGRATION.md, "Custom fields", for how to define one.');
      return 0;
    }
    io.out('');
    io.out('Custom fields QuickBooks returned:');
    for (const name of names) {
      const claimed = options.config.customFields[name] ?? options.config.itemCustomFields[name];
      io.out(`  ${name}${claimed ? `  ->  ${claimed}` : '  (not mapped)'}`);
    }
    io.out('');
    io.out('Map one by adding it to customFields in the configuration file, e.g.');
    io.out('  "customFields": { "Vessel": "vessel" }');
    return 0;
  } finally {
    await adapter.close();
  }
}

async function commandExport(invoiceId: string, options: ResolvedOptions, io: CliIo): Promise<number> {
  const adapter = buildAdapter(options, io);
  try {
    const invoice = await adapter.getInvoice(invoiceId);
    const mapping = adapter.toCanonicalInvoice(invoice, {
      overrides: options.overrides,
      lineOverrides: options.lineOverrides,
    });
    const validation = validateShipment(mapping.shipment);
    io.out(renderPreview(mapping, validation, { ascii: options.ascii }));
    io.out('');

    if (options.dryRun) {
      io.out('--dry-run: nothing was written.');
      return validation.errors > 0 ? 1 : 0;
    }

    const result = await adapter.exportAceExcel({
      mapping,
      validation,
      ...(options.outputDirectory ? { directory: options.outputDirectory } : {}),
      ...(options.fileName ? { fileName: options.fileName } : {}),
      failIfExists: !options.force,
    });

    io.out(`Wrote ${result.path} (${(result.bytes / 1024).toFixed(1)} kB)`);
    io.out('');
    io.out('Next: open the ACE Helper panel in Chrome, Import, and choose that file.');
    io.out('Review every field in the preview before you fill, and submit in ACE yourself.');
    return validation.errors > 0 ? 1 : 0;
  } finally {
    await adapter.close();
  }
}

function commandInit(options: ResolvedOptions, io: CliIo): number {
  const path = options.configPath ?? resolve(DEFAULT_CONFIG_FILE);
  if (existsSync(path) && !options.force) {
    io.err(`"${path}" already exists. Pass --force to replace it.`);
    return 1;
  }
  writeConfigFile(path, starterConfig());
  io.out(`Wrote ${path}`);
  io.out('');
  io.out('Edit it to match your company file:');
  io.out('  customFields  - the QuickBooks custom fields that carry vessel, booking, container, seal');
  io.out('  items         - the Schedule B number, origin and licence code for each item you export');
  io.out('');
  io.out('Run "ace-export fields <invoice>" to see the custom-field names QuickBooks actually returns.');
  return 0;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.err((error as Error).message);
    return 2;
  }

  if (args.booleans.has('help') || args.command === '' || args.command === 'help') {
    io.out(HELP);
    return 0;
  }

  try {
    const options = resolveOptions(args);
    const first = args.positional[0];

    switch (args.command) {
      case 'probe':
        return await commandProbe(options, io);
      case 'list':
        return await commandList(options, io);
      case 'show':
        if (!first) throw new CliError('Which invoice? e.g. "ace-export show CN-1042".');
        return await commandShow(first, options, io);
      case 'fields':
        if (!first) throw new CliError('Which invoice? e.g. "ace-export fields CN-1042".');
        return await commandFields(first, options, io);
      case 'export':
        if (!first) throw new CliError('Which invoice? e.g. "ace-export export CN-1042".');
        return await commandExport(first, options, io);
      case 'init':
        return commandInit(options, io);
      case 'gui':
        return await runGui(options, io);
      default:
        io.err(`Unknown command "${args.command}". Run "ace-export --help".`);
        return 2;
    }
  } catch (error) {
    const problem = error as Error;
    io.err(problem instanceof AdapterError ? problem.message : `${problem.name}: ${problem.message}`);
    return 1;
  }
}
