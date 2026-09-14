/**
 * The companion's `deckhand` and `package` commands: an email on disk and a
 * saved qbXML response in, a review block and a filing-package.json out.
 * No QuickBooks, no network, no browser.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { runCli } from '../companion/src/ui/cli.js';
import { extractFromFile, packageFromMapping, writeFilingPackage } from '../companion/src/package/filingPackageExport.js';
import { QuickBooksDesktopAdapter } from '../companion/src/adapter/QuickBooksDesktopAdapter.js';
import { FileQbxmlTransport } from '../companion/src/transport/FileTransport.js';
import { normalizeConfig, starterConfig, writeConfigFile } from '../companion/src/config.js';
import { parseFilingPackageJson } from '../shared/src/index.js';

const FIXTURES = join(__dirname, 'fixtures');
const QBXML = join(FIXTURES, 'qbxml', 'invoice-single-line.xml');
const EMAIL = join(FIXTURES, 'deckhand', '04-booking-confirmation.txt');
const scratchDirectories: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ace-pkg-'));
  scratchDirectories.push(directory);
  return directory;
}

afterAll(() => {
  while (scratchDirectories.length) rmSync(scratchDirectories.pop() as string, { recursive: true, force: true });
});

function io(): { out: string[]; err: string[]; io: { out: (text: string) => void; err: (text: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (text) => out.push(text), err: (text) => err.push(text) } };
}

describe('ace-export deckhand', () => {
  it('prints the review block and writes deckhand-<ref>.json', async () => {
    const directory = scratch();
    const { out, io: streams } = io();
    const code = await runCli(['deckhand', EMAIL, '--out', directory, '--ascii'], streams);
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/Booking reference\s+: EBKG18531408\s+v/);
    expect(text).toContain('MSCU1234566');
    expect(text).toContain('NOT PAIRED');
    expect(existsSync(join(directory, 'deckhand-EBKG18531408.json'))).toBe(true);
    // The same file is refused a second time without --force.
    const { err, io: again } = io();
    expect(await runCli(['deckhand', EMAIL, '--out', directory], again)).toBe(1);
    expect(err.join('\n')).toMatch(/already exists/);
  });

  it('returns 1 and writes the file when the extraction has a blocking problem', async () => {
    const directory = scratch();
    const bad = join(directory, 'bad.txt');
    writeFileSync(bad, 'Booking: X-1\nContainer TGHU7654321 | Seal No: SL-1\n');
    const { out, io: streams } = io();
    expect(await runCli(['deckhand', bad, '--out', directory, '--dry-run'], streams)).toBe(1);
    expect(out.join('\n')).toMatch(/cannot be approved/);
  });

  it('refuses a missing file and a file it cannot read, with the reason', async () => {
    const { err, io: streams } = io();
    expect(await runCli(['deckhand', '/nowhere/nothing.txt'], streams)).toBe(1);
    expect(err.join('\n')).toMatch(/No such file/);
    const directory = scratch();
    const pdf = join(directory, 'notice.pdf');
    writeFileSync(pdf, '%PDF-1.4');
    const shipment = extractFromFile(pdf);
    expect(shipment.uncertainties[0]).toMatchObject({ code: 'reader', severity: 'error' });
  });
});

describe('ace-export package', () => {
  const options = { makeTransport: () => FileQbxmlTransport.fromFile(QBXML) };

  /** A configuration with the sample item profile, as `ace-export init` writes it. */
  function configFile(): string {
    const path = join(scratch(), 'ace-export.config.json');
    writeConfigFile(path, starterConfig());
    return path;
  }

  it('writes a filing package from the invoice and the email, with Deckhand pending review', async () => {
    const directory = scratch();
    const { out, io: streams } = io();
    const code = await runCli(['package', 'CN-1042', '--deckhand', EMAIL, '--out', directory, '--ascii', '--config', configFile()], { ...streams, ...options });
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('Filing package CN-1042_EBKG18531408');
    expect(text).toMatch(/Booking\s+EBKG18531408\s+\[Deckhand, confirmed by QuickBooks\]/);
    expect(text).toMatch(/Before filling, in the extension: The Deckhand extraction has not been approved/);
    const path = join(directory, 'filing-package-CN-1042_EBKG18531408.json');
    expect(existsSync(path)).toBe(true);
    const pkg = parseFilingPackageJson(readFileSync(path, 'utf8'));
    expect(pkg.review.deckhand).toBe('pending');
    expect(pkg.commercialSource?.id).toBe('quickbooks-export');
    expect(pkg.containers).toHaveLength(3);
    expect(pkg.cargo[0]?.weightKg.value).toBe('79832');
    expect(pkg.containers[0]?.cargoDescription.value).toContain('Almond');
  });

  it('writes a commercial-only package without --deckhand, and nothing on --dry-run', async () => {
    const directory = scratch();
    const { out, io: streams } = io();
    const config = configFile();
    expect(await runCli(['package', 'CN-1042', '--out', directory, '--dry-run', '--config', config, '--set', 'containerNumber=MSCU1234566', '--set', 'sealNumber=SL-1'], { ...streams, ...options })).toBe(0);
    expect(out.join('\n')).toMatch(/--dry-run: nothing was written/);
    // The starter configuration maps the Booking custom field, so the id carries it.
    const fileName = 'filing-package-CN-1042_EBKG18531408.json';
    expect(existsSync(join(directory, fileName))).toBe(false);
    const { io: again } = io();
    expect(await runCli(['package', 'CN-1042', '--out', directory, '--config', config, '--set', 'containerNumber=MSCU1234566', '--set', 'sealNumber=SL-1'], { ...again, ...options })).toBe(0);
    const pkg = parseFilingPackageJson(readFileSync(join(directory, fileName), 'utf8'));
    expect(pkg.review.deckhand).toBe('not-applicable');
    expect(pkg.containers[0]?.containerNumber).toMatchObject({ value: 'MSCU1234566', source: 'quickbooks' });
  });

  it('needs an invoice, and --deckhand needs a value', async () => {
    const { err, io: streams } = io();
    expect(await runCli(['package'], streams)).toBe(1);
    expect(err.join('\n')).toMatch(/Which invoice/);
    const { err: err2, io: streams2 } = io();
    expect(await runCli(['package', 'CN-1042', '--deckhand'], streams2)).toBe(2);
    expect(err2.join('\n')).toMatch(/needs a value/);
  });

  it('lists the new commands in --help', async () => {
    const { out, io: streams } = io();
    await runCli(['--help'], streams);
    expect(out.join('\n')).toMatch(/ace-export package <invoice>/);
    expect(out.join('\n')).toMatch(/ace-export deckhand <file>/);
  });

  it('builds the same package through the library functions', async () => {
    const adapter = new QuickBooksDesktopAdapter(FileQbxmlTransport.fromFile(QBXML), normalizeConfig(starterConfig()));
    const mapping = adapter.toCanonicalInvoice(await adapter.getInvoice('CN-1042'));
    const pkg = packageFromMapping({ mapping, shipment: extractFromFile(EMAIL), generatedBy: 'test', now: new Date('2026-09-14T00:00:00Z') });
    const written = writeFilingPackage(pkg, { directory: scratch() });
    expect(written.fileName).toBe('filing-package-CN-1042_EBKG18531408.json');
    expect(parseFilingPackageJson(readFileSync(written.path, 'utf8'))).toEqual(pkg);
    await adapter.close();
  });
});
