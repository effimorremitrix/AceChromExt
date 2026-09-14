/**
 * The companion as a whole: adapter, transports, the command line, and the
 * local window's request handler.
 *
 * Everything here runs against saved qbXML, on any platform. What it cannot
 * cover is the one hop that needs Windows - PowerShell creating the COM
 * request processor - so that hop is reduced to a command line this test can
 * assert, and a manual procedure in docs/QUICKBOOKS-INTEGRATION.md.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { QuickBooksDesktopAdapter, parseInvoiceId } from '../companion/src/adapter/QuickBooksDesktopAdapter.js';
import { AdapterError, InvoiceNotFoundError } from '../companion/src/adapter/InvoiceSourceAdapter.js';
import { FileQbxmlTransport } from '../companion/src/transport/FileTransport.js';
import { ComQbxmlTransport, describeFailure, POWERSHELL_32 } from '../companion/src/transport/ComTransport.js';
import { requestTypeOf, TransportError } from '../companion/src/transport/QbxmlTransport.js';
import { normalizeConfig, starterConfig, type AceExportConfig } from '../companion/src/config.js';
import { parseArgs, runCli, type CliIo, type ResolvedOptions } from '../companion/src/ui/cli.js';
import { CONTENT_SECURITY_POLICY, handleRequest, type RequestContext } from '../companion/src/ui/server.js';
import { PAGE_HTML, PAGE_JS } from '../companion/src/ui/page.js';
import { renderChecklist, renderInvoiceList, renderPreview } from '../companion/src/ui/preview.js';
import { mapQbInvoiceToCanonical } from '../companion/src/mapping/qbToCanonical.js';
import { parseInvoiceQueryResponse } from '../companion/src/qbxml/parse.js';
import { validateShipment } from '../src/excel/validator.js';
import { fixture } from './qbxml.test.js';

const temporary: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ace-companion-test-'));
  temporary.push(directory);
  return directory;
}

afterEach(() => {
  while (temporary.length) rmSync(temporary.pop() as string, { recursive: true, force: true });
});

function config(overrides: Partial<AceExportConfig> = {}): AceExportConfig {
  return normalizeConfig({ ...starterConfig(), ...overrides });
}

function adapterFor(responses: Record<string, string>, overrides: Partial<AceExportConfig> = {}) {
  const transport = new FileQbxmlTransport({ responses });
  return { transport, adapter: new QuickBooksDesktopAdapter(transport, config(overrides)) };
}

const SINGLE = { InvoiceQueryRq: fixture('invoice-single-line.xml') };

describe('transports', () => {
  it('names the request type in a document', () => {
    expect(requestTypeOf('<QBXML><QBXMLMsgsRq><InvoiceQueryRq requestID="1">')).toBe('InvoiceQueryRq');
    expect(requestTypeOf('<QBXML><QBXMLMsgsRq><HostQueryRq />')).toBe('HostQueryRq');
    expect(requestTypeOf('<QBXML/>')).toBe('');
  });

  it('replays a saved response and records what was asked', async () => {
    const transport = new FileQbxmlTransport({ responses: SINGLE });
    const response = await transport.send('<QBXML><QBXMLMsgsRq><InvoiceQueryRq requestID="1"></InvoiceQueryRq>');
    expect(response).toContain('CN-1042');
    expect(transport.sent).toHaveLength(1);
  });

  it('says so rather than guessing when it has no saved response', async () => {
    const transport = new FileQbxmlTransport({ responses: SINGLE });
    await expect(transport.send('<QBXML><QBXMLMsgsRq><HostQueryRq />')).rejects.toThrow(/No saved response/);
  });

  it('reports a missing response file clearly', () => {
    expect(() => FileQbxmlTransport.fromFile('/nowhere/response.xml')).toThrow(TransportError);
  });

  it('builds a PowerShell command line that passes data by file, never by argument', () => {
    const transport = new ComQbxmlTransport({
      appName: 'ACE Export Helper',
      companyFile: 'C:\\Users\\ops\\Almonds.QBW',
      scriptPath: 'C:\\ace\\QbxmlRequest.ps1',
      powerShellPath: POWERSHELL_32,
    });
    const { command, args } = transport.commandLine('C:\\tmp\\req.xml', 'C:\\tmp\\res.xml');

    expect(command).toBe(POWERSHELL_32);
    expect(args).toContain('-NoProfile');
    expect(args).toContain('-NonInteractive');
    expect(args[args.indexOf('-File') + 1]).toBe('C:\\ace\\QbxmlRequest.ps1');
    expect(args[args.indexOf('-RequestPath') + 1]).toBe('C:\\tmp\\req.xml');
    expect(args[args.indexOf('-AppName') + 1]).toBe('ACE Export Helper');
    // localQBD, and "do not care" about the file mode.
    expect(args[args.indexOf('-ConnectionType') + 1]).toBe('1');
    expect(args[args.indexOf('-FileMode') + 1]).toBe('2');
  });

  it('asks QuickBooks to start itself only when told to', () => {
    const transport = new ComQbxmlTransport({ appName: 'x', launchQuickBooks: true, scriptPath: 'x.ps1' });
    const { args } = transport.commandLine('a', 'b');
    expect(args[args.indexOf('-ConnectionType') + 1]).toBe('3');
  });

  it('refuses to pretend it can reach QuickBooks from a non-Windows machine', async () => {
    const transport = new ComQbxmlTransport({ appName: 'x' });
    if (process.platform === 'win32') return;
    await expect(transport.send('<QBXML/>')).rejects.toThrow(/Windows/);
  });

  it('ships the PowerShell bridge it needs', () => {
    const script = join(__dirname, '..', 'companion', 'powershell', 'QbxmlRequest.ps1');
    expect(existsSync(script)).toBe(true);
    const source = readFileSync(script, 'utf8');
    expect(source).toContain('QBXMLRP2.RequestProcessor');
    expect(source).toContain('OpenConnection2');
    expect(source).toContain('BeginSession');
    expect(source).toContain('EndSession');
    expect(source).toContain('CloseConnection');
    // Values arrive as parameters; nothing from a company file becomes code.
    expect(source).toContain('param(');
    expect(source).not.toMatch(/Invoke-Expression|iex /);
  });

  it('turns COM failures into advice', () => {
    expect(describeFailure('Error 80040154')).toMatch(/32-bit PowerShell/);
    expect(describeFailure('0x80040420 certificate')).toMatch(/Admin in single-user mode/);
    expect(describeFailure('0x80040416 not allowed')).toMatch(/Integrated Applications/);
    expect(describeFailure('')).toMatch(/without a message/);
  });
});

describe('the QuickBooks adapter', () => {
  it('tells a TxnID from an invoice number', () => {
    expect(parseInvoiceId('2AB4-1758412800')).toEqual({ kind: 'txnId', value: '2AB4-1758412800' });
    expect(parseInvoiceId('CN-1042')).toEqual({ kind: 'refNumber', value: 'CN-1042' });
    expect(parseInvoiceId('ref:2AB4-1758412800').kind).toBe('refNumber');
    expect(parseInvoiceId('txn:anything').kind).toBe('txnId');
    expect(() => parseInvoiceId('  ')).toThrow(AdapterError);
  });

  it('queries by RefNumber and returns the invoice with its lines', async () => {
    const { adapter, transport } = adapterFor(SINGLE);
    const invoice = await adapter.getInvoice('CN-1042');
    expect(invoice.summary).toMatchObject({ reference: 'CN-1042', customerName: 'Aydin Kuruyemis San Ve Tic A.S', lineCount: 1 });
    expect(transport.sent[0]).toContain('<RefNumber>CN-1042</RefNumber>');
    expect(transport.sent[0]).toContain('<IncludeLineItems>true</IncludeLineItems>');
  });

  it('queries by TxnID when given one', async () => {
    const { adapter, transport } = adapterFor(SINGLE);
    await adapter.getInvoice('2AB4-1758412800');
    expect(transport.sent[0]).toContain('<TxnID>2AB4-1758412800</TxnID>');
  });

  it('says so when nothing matched', async () => {
    const { adapter } = adapterFor({ InvoiceQueryRq: fixture('no-match.xml') });
    await expect(adapter.getInvoice('CN-9999')).rejects.toThrow(InvoiceNotFoundError);
  });

  it('refuses to pick for you when two invoices share a number', async () => {
    const { adapter } = adapterFor({ InvoiceQueryRq: fixture('invoice-duplicate-refnumber.xml') });
    await expect(adapter.getInvoice('CN-1042')).rejects.toThrow(/2 invoices are numbered/);
    await expect(adapter.getInvoice('CN-1042')).rejects.toThrow(/txn:5AA1-1758672000/);
  });

  it('lists invoices without dragging every line item along', async () => {
    const { adapter, transport } = adapterFor({ InvoiceQueryRq: fixture('invoice-list.xml') });
    const summaries = await adapter.listInvoices({ referenceContains: 'CN-', limit: 25 });
    expect(summaries.map((row) => row.reference)).toEqual(['CN-1042', 'CN-1043']);
    expect(transport.sent[0]).toContain('<IncludeLineItems>false</IncludeLineItems>');
    expect(transport.sent[0]).toContain('<MatchCriterion>Contains</MatchCriterion>');
  });

  it('drops the filters when asked for one exact invoice number', async () => {
    const { adapter, transport } = adapterFor({ InvoiceQueryRq: fixture('invoice-list.xml') });
    await adapter.listInvoices({ reference: 'CN-1042', limit: 10 });
    expect(transport.sent[0]).toContain('<RefNumber>CN-1042</RefNumber>');
    expect(transport.sent[0]).not.toContain('<MaxReturned>');
  });

  it('probes with a host query and reports what answered', async () => {
    const { adapter } = adapterFor({ HostQueryRq: fixture('host-query.xml') });
    const probe = await adapter.probe();
    expect(probe.ok).toBe(true);
    expect(probe.description).toContain('QuickBooks Desktop Pro Plus 2024');
    expect(probe.details['qbXML versions']).toContain('16.0');
    expect(probe.details['warning']).toBeUndefined();
  });

  it('warns when the requested qbXML version is not on offer', async () => {
    const transport = new FileQbxmlTransport({ responses: { HostQueryRq: fixture('host-query.xml') } });
    const adapter = new QuickBooksDesktopAdapter(transport, config({ qbxmlVersion: '99.0' }));
    const probe = await adapter.probe();
    expect(probe.details['warning']).toContain('16.0');
  });

  it('reports an unreachable source instead of throwing', async () => {
    const { adapter } = adapterFor({});
    const probe = await adapter.probe();
    expect(probe.ok).toBe(false);
  });

  it('rejects an override that is not a canonical invoice field', async () => {
    const { adapter } = adapterFor(SINGLE);
    const invoice = await adapter.getInvoice('CN-1042');
    expect(() => adapter.toCanonicalInvoice(invoice, { overrides: { shipName: 'x' } })).toThrow(/not an invoice field/);
  });

  it('exports through the same path as the spreadsheet importer reads', async () => {
    const directory = scratch();
    const { adapter } = adapterFor(SINGLE);
    const invoice = await adapter.getInvoice('CN-1042');
    const mapping = adapter.toCanonicalInvoice(invoice);
    const result = await adapter.exportAceExcel({ mapping, validation: validateShipment(mapping.shipment), directory });
    expect(result.fileName).toBe('ACE_Invoice_CN-1042.xlsx');
    expect(readdirSync(directory)).toEqual(['ACE_Invoice_CN-1042.xlsx']);
  });
});

describe('the preview', () => {
  const invoice = parseInvoiceQueryResponse(fixture('invoice-single-line.xml')).results[0]!;
  const mapping = mapQbInvoiceToCanonical(invoice, config());
  const validation = validateShipment(mapping.shipment);

  it('shows the value, who supplied it, and the conversion', () => {
    const text = renderPreview(mapping, validation);
    expect(text).toContain('MSC FIRENZE V.541W');
    expect(text).toContain('custom field');
    expect(text).toContain('176000 lb -> lb x 0.45359237');
    expect(text).toContain('79,832 kg');
  });

  it('shows a long value in full rather than truncating it silently', () => {
    const text = renderPreview(mapping, validation);
    expect(text).toContain('Almond Kernels, Monterey SSR 23/25, new crop, 50 lb cartons');
  });

  it('answers the six questions in the same order every time', () => {
    const checklist = renderChecklist(mapping, validation).join('\n');
    for (const label of ['Invoice number', 'Customer', 'Invoice date', 'Commodity description', 'Amount', 'Weight']) {
      expect(checklist).toContain(label);
    }
  });

  it('calls out the ACE facts QuickBooks never holds', () => {
    const bare = mapQbInvoiceToCanonical(invoice, config({ items: {}, itemDefaults: {} }));
    const checklist = renderChecklist(bare, validateShipment(bare.shipment)).join('\n');
    expect(checklist).toContain('Schedule B missing');
    expect(checklist).toContain('Origin not set');
    expect(checklist).toContain('License Code not set');
  });

  it('has an ASCII mode for consoles that mangle check marks', () => {
    const text = renderPreview(mapping, validation, { ascii: true });
    expect(text).toContain('[ok]');
    expect(text).not.toContain('\u2713');
  });

  it('renders an invoice picker', () => {
    const text = renderInvoiceList([
      { id: 'A-1', reference: 'CN-1042', date: '2026-09-21', customerName: 'Aydin', total: 651217.6, lineCount: null },
    ]);
    expect(text).toContain('CN-1042');
    expect(text).toContain('651,217.60');
    expect(renderInvoiceList([])).toBe('No invoices matched.');
  });
});

describe('the command line', () => {
  /** A configuration with the sample item profile, as `ace-export init` writes. */
  function configFile(): string {
    const path = join(scratch(), 'ace-export.config.json');
    writeFileSync(path, JSON.stringify(starterConfig(), null, 2));
    return path;
  }

  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      makeTransport: () => new FileQbxmlTransport({ responses: { ...SINGLE, HostQueryRq: fixture('host-query.xml') } }),
    };
    return { io, out, err, text: () => out.join('\n'), errors: () => err.join('\n') };
  }

  it('parses flags, repeated values and inline values', () => {
    const args = parseArgs(['export', 'CN-1042', '--set', 'vessel=MSC', '--set=carrier=ZIM', '--force']);
    expect(args.command).toBe('export');
    expect(args.positional).toEqual(['CN-1042']);
    expect(args.flags.get('set')).toEqual(['vessel=MSC', 'carrier=ZIM']);
    expect(args.booleans.has('force')).toBe(true);
  });

  it('rejects an unknown option instead of ignoring it', () => {
    expect(() => parseArgs(['export', '--upload'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['export', '--out'])).toThrow(/needs a value/);
  });

  it('prints help when asked, and when asked for nothing', async () => {
    const first = capture();
    expect(await runCli([], first.io)).toBe(0);
    expect(first.text()).toContain('ace-export');
    expect(first.text()).toContain('Nothing is uploaded');
  });

  it('probes', async () => {
    const run = capture();
    expect(await runCli(['probe'], run.io)).toBe(0);
    expect(run.text()).toContain('QuickBooks Desktop Pro Plus 2024');
  });

  it('shows an invoice without writing anything', async () => {
    const directory = scratch();
    const run = capture();
    expect(await runCli(['show', 'CN-1042', '--out', directory, '--config', configFile()], run.io)).toBe(0);
    expect(run.text()).toContain('Aydin Kuruyemis San Ve Tic A.S');
    expect(readdirSync(directory)).toEqual([]);
  });

  it('exports, and points at the next step', async () => {
    const directory = scratch();
    const run = capture();
    expect(await runCli(['export', 'CN-1042', '--out', directory, '--config', configFile()], run.io)).toBe(0);
    expect(readdirSync(directory)).toEqual(['ACE_Invoice_CN-1042.xlsx']);
    expect(run.text()).toContain('ACE Helper panel');
  });

  it('applies values supplied on the command line', async () => {
    const directory = scratch();
    const run = capture();
    const code = await runCli(
      ['export', 'CN-1042', '--out', directory, '--config', configFile(), '--set', 'containerNumber=MSCU1234567'],
      run.io,
    );
    expect(code).toBe(0);
    expect(run.text()).toContain('MSCU1234567');
  });

  it('applies a customs fact supplied for one commodity line', async () => {
    const directory = scratch();
    const run = capture();
    const code = await runCli(
      [
        'show',
        'CN-1042',
        '--out',
        directory,
        '--config',
        configFile(),
        '--set-line',
        '1.scheduleB=0813.40.8000',
        '--set-line',
        '1.licenseCode=C33',
      ],
      run.io,
    );
    expect(code).toBe(0);
    expect(run.text()).toContain('0813.40.8000');
    expect(run.text()).toContain('supplied for this export');
  });

  it('rejects a --set-line that names no line', async () => {
    const run = capture();
    expect(await runCli(['show', 'CN-1042', '--set-line', 'scheduleB=0802.12.0000'], run.io)).toBe(1);
    expect(run.errors()).toContain('line.field=value');
  });

  it('prints ACE readiness per line, so the missing customs facts are visible', async () => {
    const run = capture();
    expect(await runCli(['show', 'CN-1042', '--config', configFile()], run.io)).toBe(0);
    expect(run.text()).toContain('ACE readiness - line 1');
    expect(run.text()).toContain('Schedule B');
    expect(run.text()).toContain('License Code');
  });

  it('exits non-zero when the customs facts are not configured', async () => {
    // No configuration file means no Schedule B, no origin and no licence
    // code, which ACE will reject. The command must say so in its exit code.
    const directory = scratch();
    const run = capture();
    expect(await runCli(['show', 'CN-1042', '--out', directory], run.io)).toBe(1);
    expect(run.text()).toContain('Schedule B');
  });

  it('writes nothing for a dry run', async () => {
    const directory = scratch();
    const run = capture();
    expect(await runCli(['export', 'CN-1042', '--out', directory, '--dry-run', '--config', configFile()], run.io)).toBe(0);
    expect(readdirSync(directory)).toEqual([]);
    expect(run.text()).toContain('nothing was written');
  });

  it('lists the custom fields QuickBooks returned, mapped or not', async () => {
    const run = capture();
    expect(await runCli(['fields', 'CN-1042'], run.io)).toBe(0);
    expect(run.text()).toContain('Vessel  ->  vessel');
    expect(run.text()).toContain('Broker  (not mapped)');
  });

  it('writes a starter configuration, and will not clobber one', async () => {
    const directory = scratch();
    const path = join(directory, 'ace-export.config.json');
    const run = capture();

    expect(await runCli(['init', '--config', path], run.io)).toBe(0);
    const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, never>;
    expect(written['customFields']!['Vessel']).toBe('vessel');
    expect(Object.keys(written['items']!)).toContain('Shelled Almonds');

    const again = capture();
    expect(await runCli(['init', '--config', path], again.io)).toBe(1);
    expect(again.errors()).toContain('already exists');
    expect(await runCli(['init', '--config', path, '--force'], capture().io)).toBe(0);
  });

  it('reads the configuration it was given', async () => {
    const directory = scratch();
    const path = join(directory, 'custom.json');
    writeFileSync(path, JSON.stringify({ customFields: { Vessel: 'vessel' }, manual: { carrier: 'ZIM LINE' } }));
    const run = capture();
    await runCli(['show', 'CN-1042', '--config', path], run.io);
    expect(run.text()).toContain('ZIM LINE');
    expect(await runCli(['show', 'CN-1042', '--config', join(directory, 'missing.json')], capture().io)).toBe(1);
  });

  it('reports a bad invoice number as a message, not a stack trace', async () => {
    const run = capture();
    const code = await runCli(['show'], run.io);
    expect(code).toBe(1);
    expect(run.errors()).toContain('Which invoice?');
  });

  it('exits non-zero when validation found errors', async () => {
    const directory = scratch();
    const out: string[] = [];
    const io: CliIo = {
      out: (text) => out.push(text),
      err: () => {},
      makeTransport: () => new FileQbxmlTransport({ responses: { InvoiceQueryRq: fixture('invoice-sparse.xml') } }),
    };
    expect(await runCli(['export', '1044', '--out', directory], io)).toBe(1);
    // The workbook is still written: the operator may want to fix it in Excel.
    expect(readdirSync(directory)).toHaveLength(1);
  });
});

describe('the local window', () => {
  function context(): RequestContext {
    const transport = new FileQbxmlTransport({
      responses: { ...SINGLE, HostQueryRq: fixture('host-query.xml') },
    });
    const adapter = new QuickBooksDesktopAdapter(transport, config());
    const options: ResolvedOptions = {
      config: config(),
      configPath: null,
      fromFile: null,
      launch: false,
      ascii: false,
      force: true,
      dryRun: false,
      outputDirectory: null,
      fileName: null,
      overrides: {},
      lineOverrides: {},
      limit: null,
      contains: null,
      customer: null,
      dateFrom: null,
      dateTo: null,
      port: null,
    };
    return { adapter, token: 'secret-token', options };
  }

  const query = (extra: Record<string, string> = {}, token = 'secret-token'): URLSearchParams =>
    new URLSearchParams({ t: token, ...extra });

  it('serves a page that loads nothing from the internet', async () => {
    const reply = await handleRequest(context(), 'GET', '/', new URLSearchParams(), '');
    expect(reply.status).toBe(200);
    expect(reply.body).toBe(PAGE_HTML);
    expect(PAGE_HTML).not.toMatch(/https?:\/\//);
    expect(PAGE_JS).not.toMatch(/https?:\/\//);
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
  });

  it('returns ACE readiness per line so the form can render it', async () => {
    const reply = await handleRequest(context(), 'GET', '/api/invoice', query({ id: 'CN-1042' }), '');
    const payload = JSON.parse(reply.body) as Record<string, never>;
    const readiness = payload['readiness'] as unknown as Array<{ line: number; ready: boolean; items: Array<{ field: string; ok: boolean; editable: boolean }> }>;

    expect(readiness).toHaveLength(1);
    const scheduleB = readiness[0]!.items.find((item) => item.field === 'scheduleB');
    expect(scheduleB?.editable).toBe(true);
    const weight = readiness[0]!.items.find((item) => item.field === 'shippingWeight');
    expect(weight?.editable).toBe(false);
  });

  it('accepts a customs fact typed into the form for one line', async () => {
    const reply = await handleRequest(
      context(),
      'GET',
      '/api/invoice',
      query({ id: 'CN-1042', lineOverrides: JSON.stringify({ 1: { scheduleB: '0813.40.8000' } }) }),
      '',
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('0813.40.8000');
  });

  it('refuses a form value aimed at a field the invoice owns', async () => {
    const reply = await handleRequest(
      context(),
      'GET',
      '/api/invoice',
      query({ id: 'CN-1042', lineOverrides: JSON.stringify({ 1: { shippingWeight: '1' } }) }),
      '',
    );
    expect(reply.status).toBe(400);
    expect(reply.body).toContain('cannot be supplied per line');
  });

  it('ignores a nonsense line key instead of trusting it', async () => {
    const reply = await handleRequest(
      context(),
      'GET',
      '/api/invoice',
      query({ id: 'CN-1042', lineOverrides: JSON.stringify({ '__proto__': { scheduleB: 'x' }, '-3': { scheduleB: 'y' } }) }),
      '',
    );
    expect(reply.status).toBe(200);
    expect(({} as Record<string, unknown>)['scheduleB']).toBeUndefined();
  });

  it('refuses every API call without the run token', async () => {
    const reply = await handleRequest(context(), 'GET', '/api/invoices', new URLSearchParams(), '');
    expect(reply.status).toBe(403);
    const wrong = await handleRequest(context(), 'GET', '/api/invoices', query({}, 'guessed'), '');
    expect(wrong.status).toBe(403);
  });

  it('previews an invoice as JSON', async () => {
    const reply = await handleRequest(context(), 'GET', '/api/invoice', query({ id: 'CN-1042' }), '');
    expect(reply.status).toBe(200);
    const payload = JSON.parse(reply.body) as Record<string, never>;
    expect(payload['invoice']!['customerName']).toBe('Aydin Kuruyemis San Ve Tic A.S');
    expect(payload['itemCount']).toBe(1);
    expect(payload['errors']).toBe(0);
    expect(String(payload['preview'])).toContain('79,832 kg');
  });

  it('applies the values typed into the form', async () => {
    const overrides = JSON.stringify({ vessel: 'MSC NAPOLI' });
    const reply = await handleRequest(context(), 'GET', '/api/invoice', query({ id: 'CN-1042', overrides }), '');
    const payload = JSON.parse(reply.body) as Record<string, never>;
    expect(payload['invoice']!['vessel']).toBe('MSC NAPOLI');
  });

  it('exports to disk on POST', async () => {
    const directory = scratch();
    const ctx = context();
    ctx.options.outputDirectory = directory;
    const reply = await handleRequest(ctx, 'POST', '/api/export', query(), JSON.stringify({ id: 'CN-1042' }));
    expect(reply.status).toBe(200);
    expect(readdirSync(directory)).toEqual(['ACE_Invoice_CN-1042.xlsx']);
  });

  it('answers an unknown path and an unusable method', async () => {
    expect((await handleRequest(context(), 'GET', '/api/nope', query(), '')).status).toBe(404);
    expect((await handleRequest(context(), 'DELETE', '/api/invoice', query(), '')).status).toBe(405);
  });

  it('turns an adapter failure into a message, not a crash', async () => {
    const reply = await handleRequest(context(), 'GET', '/api/invoice', query({ id: '' }), '');
    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body)['error']).toContain('Which invoice?');
  });
});
