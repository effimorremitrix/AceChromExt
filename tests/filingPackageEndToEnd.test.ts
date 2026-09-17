/**
 * One shipment, both destinations.
 *
 *   QuickBooks fixture (qbXML CN-1042: Shelled Almonds, 176,000 lb, $651,217.60)
 *     + Deckhand fixture (a sanitized booking confirmation: EBKG18531408,
 *       MSC FIRENZE / 541W, three containers with their seals)
 *       -> FilingPackage (matched, no conflict)
 *          -> filing-package.json (written and re-read)
 *             -> ACE Helper: the canonical model, the Commodities line and
 *                the Transportation step, from the package
 *             -> INTTRA Helper: General Details and the container grid
 *
 * Nothing is stubbed between the ends. The ACE Transportation ids and every
 * INTTRA id are placeholders (never captured from a live portal), so what
 * this proves is that one package feeds both fill paths correctly - not that
 * the selectors are right.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { QuickBooksDesktopAdapter } from '../companion/src/adapter/QuickBooksDesktopAdapter.js';
import { FileQbxmlTransport } from '../companion/src/transport/FileTransport.js';
import { normalizeConfig, starterConfig } from '../companion/src/config.js';
import { extractFromFile, packageFromMapping, writeFilingPackage } from '../companion/src/package/filingPackageExport.js';
import { approveDeckhand, fillGate, parseFilingPackageJson, serializeFilingPackage, type FilingPackage } from '../shared/src/index.js';
import { buildReview } from '../deckhand/src/index.js';
import { loadFilingPackageText } from '../src/sources/FilingPackageSource.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { buildPreflight } from '../src/ui/preflight.js';
import { detectPage } from '../src/content/pageDetector.js';
import { fillFields } from '../src/content/filler.js';
import { detectInttraPage } from '../inttra-extension/src/content/pageDetector.js';
import { fillInttraFields } from '../inttra-extension/src/content/filler.js';
import { fillContainerGrid } from '../inttra-extension/src/content/gridWriter.js';

const FIXTURES = join(__dirname, 'fixtures');
const html = (name: string): string => readFileSync(join(FIXTURES, `${name}.html`), 'utf8');
const NOW = new Date('2026-09-14T09:00:00Z');
let directory = '';
let pkg: FilingPackage;
let json = '';

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'ace-e2e-pkg-'));
  const adapter = new QuickBooksDesktopAdapter(FileQbxmlTransport.fromFile(join(FIXTURES, 'qbxml', 'invoice-single-line.xml')), normalizeConfig(starterConfig()));
  const invoice = await adapter.getInvoice('CN-1042');
  // QuickBooks holds the booking in a custom field on a real company file; the
  // fixture does not, so it is supplied the way the export screen supplies it.
  const mapping = adapter.toCanonicalInvoice(invoice, { overrides: { bookingNumber: 'EBKG18531408', vessel: 'MSC FIRENZE V.541W' } });
  const shipment = extractFromFile(join(FIXTURES, 'deckhand', '04-booking-confirmation.txt'));
  const pending = packageFromMapping({ mapping, shipment, generatedBy: adapter.label, now: NOW });
  const written = writeFilingPackage(pending, { directory });
  await adapter.close();

  // The operator reviews and approves in the panel; here the approval is the API call.
  const reread = parseFilingPackageJson(readFileSync(written.path, 'utf8'));
  pkg = approveDeckhand(reread, NOW);
  json = serializeFilingPackage(pkg);
  writeFileSync(written.path, json);
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('the package', () => {
  it('matches the QuickBooks and Deckhand identifiers with no conflict', () => {
    expect(pkg.conflicts).toEqual([]);
    expect(pkg.header.bookingReference).toMatchObject({ value: 'EBKG18531408', source: 'deckhand', confirmedBy: 'quickbooks' });
    expect(pkg.header.vessel).toMatchObject({ value: 'MSC FIRENZE', confirmedBy: 'quickbooks' });
    expect(pkg.header.customerName).toMatchObject({ value: 'Aydin Kuruyemis San Ve Tic A.S', source: 'quickbooks' });
    expect(pkg.containers.map((container) => container.containerNumber.value)).toEqual(['MSCU1234566', 'MSDU7654322', 'TGHU7654320']);
    // The first two rows come from the document's explicit "Carrier Seal"
    // column; TGHU7654320's seal is headed just "Seal:", so it is read as the
    // shipper's.
    expect(pkg.containers.map((container) => container.carrierSeal.value)).toEqual(['SL-4471209', 'SL-4471210', '']);
    expect(pkg.containers.map((container) => container.shipperSeal.value)).toEqual(['SH-001', '', 'SL-9']);
    expect(pkg.cargo[0]?.weightKg).toMatchObject({ value: '79832', source: 'quickbooks' });
    expect(pkg.cargo[0]?.weightKg.transform).toContain('0.45359237');
    expect(buildReview(pkg.shipment!).blocking).toEqual([]);
    expect(fillGate(pkg).ok).toBe(true);
    // QuickBooks' container field says "See Ocean B/L": the placeholder Deckhand exists to replace, noted and set aside.
    expect(pkg.notes.some((note) => /See Ocean B\/L/.test(note.message) && /not a container number/.test(note.message))).toBe(true);
  });

  it('survives the file', () => {
    expect(parseFilingPackageJson(json)).toEqual(pkg);
  });
});

describe('into ACE', () => {
  it('loads as the ACE source and passes the data quality checks', () => {
    const loaded = loadFilingPackageText(json, { settings: DEFAULT_SETTINGS });
    expect(loaded.source.id).toBe('filing-package');
    expect(loaded.shipment.invoice.bookingNumber).toBe('EBKG18531408');
    expect(loaded.shipment.invoice.vessel).toBe('MSC FIRENZE');
    expect(loaded.shipment.commodities[0]?.shippingWeight).toBe(79832);
    const check = buildPreflight(loaded.shipment, loaded.validation, loaded.notes);
    expect(check.blocking).toEqual([]);
    // Three containers, one ACE container field: left for the operator, and said so.
    expect(loaded.notes.some((note) => /3 containers/.test(note.message))).toBe(true);
  });

  it('fills the Commodities line exactly as the workbook path does', () => {
    document.body.innerHTML = html('ace-commodities');
    const loaded = loadFilingPackageText(json, { settings: DEFAULT_SETTINGS });
    const report = fillFields({ shipment: loaded.shipment, page: 'commodities', scope: 'commodityLine', line: 1, settings: DEFAULT_SETTINGS }, document);
    expect(report.errors).toBe(0);
    const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;
    expect(value('scheduleBNumber')).toBe('0802.12.0000');
    expect(value('commodityLines[0].shipmentWeight.stringField')).toBe('79832');
    expect(value('commodityLines[0].goodsValue.stringField')).toBe('651218');
  });

  it('fills the Transportation step with the booking and vessel from Deckhand', () => {
    document.body.innerHTML = html('ace-transportation');
    expect(detectPage(document).page).toBe('transportation');
    const loaded = loadFilingPackageText(json, { settings: DEFAULT_SETTINGS });
    const report = fillFields({ shipment: loaded.shipment, page: 'transportation', scope: 'shipment', settings: DEFAULT_SETTINGS }, document);
    expect(report.errors).toBe(0);
    const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;
    // The booking number is filed in ACE's Transportation Reference Number box
    // (id refNbrValue): for a vessel shipment they are the same data element.
    expect(value('refNbrValue')).toBe('EBKG18531408');
    expect(value('shipmentInfo.conveyanceName.stringField')).toBe('MSC FIRENZE');
    // Carrier SCAC/IATA takes a code, so the mapping upper-cases it. The live
    // value on this box is "MSCU"; whether ACE accepts a carrier name at all
    // is still open, which is why the validator warns on anything that is not
    // a short code.
    expect(value('carrierScacIata')).toBe('MSC LINE');
    // Container and seal are not on the ACE step at all, so there is nothing
    // to clear: the three containers in the package go to INTTRA instead.
    expect(document.getElementById('containerNumber')).toBeNull();
    expect(document.getElementById('sealNumber')).toBeNull();
    const booking = report.outcomes.find((outcome) => outcome.key === 'TransportationReferenceNumber');
    expect(booking?.original).toBe('EBKG18531408');
  });
});

describe('into INTTRA', () => {
  it('fills General Details', () => {
    document.body.innerHTML = html('inttra-general-details');
    expect(detectInttraPage(document).page).toBe('generalDetails');
    const report = fillInttraFields({ pkg, page: 'generalDetails', scope: 'shipment' }, document);
    // One error, and it is the honest one: see the carrier assertion below.
    expect(report.errors).toBe(1);
    const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;
    expect(value('bookingNumber')).toBe('EBKG18531408');
    expect(value('shipperReference')).toBe('SID-2026-0042');
    expect(value('vessel')).toBe('MSC FIRENZE');
    expect(value('voyage')).toBe('541W');
    expect(value('portOfDischarge')).toBe('Derince');
    expect(report.outcomes.find((outcome) => outcome.key === 'BookingNumber')?.provenance).toContain('confirmed by QuickBooks');
    // The carrier from QuickBooks ("MSC Line") matches no option in the mock dropdown: reported, not forced.
    expect(report.outcomes.find((outcome) => outcome.key === 'Carrier')?.status).toBe('error');
  });

  it('fills the container grid with one row per container, cargo from QuickBooks, seals from Deckhand', () => {
    document.body.innerHTML = html('inttra-container-grid-aria');
    const report = fillContainerGrid(pkg, { doc: document });
    expect(report.rowsNeeded).toBe(3);
    expect(report.containersFilled).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.unresolved).toBe(0);
    const rows = Array.from(document.querySelectorAll('[role="row"]')).slice(1);
    expect(rows.map((row) => row.children[0]?.textContent)).toEqual(['MSCU1234566', 'MSDU7654322', 'TGHU7654320']);
    // Column 1 is Carrier Seal #, column 2 Shipper Seal #. The first two rows
    // come from the document's explicit "Carrier Seal" column; TGHU7654320's
    // seal is headed just "Seal:", so it is the shipper's.
    expect(rows.map((row) => row.children[1]?.textContent)).toEqual(['SL-4471209', 'SL-4471210', '']);
    expect(rows.map((row) => row.children[2]?.textContent)).toEqual(['SH-001', '', 'SL-9']);
    expect(rows[2]?.children[3]?.textContent).toContain('Almond');
    expect(rows[2]?.children[4]?.textContent).toBe('0802.12');
    expect(report.verifiedCells).toBe(3 + 3 + 1 + 3 + 3);
    const description = report.cells.find((cell) => cell.row === 1 && cell.column === 'CargoDescription');
    expect(description?.provenance).toContain('QuickBooks');
    const seal = report.cells.find((cell) => cell.column === 'ShipperSeal' && cell.expected !== '');
    expect(seal?.provenance).toContain('Deckhand');
  });

  it('refuses to fill until the Deckhand half is approved', () => {
    const pending = parseFilingPackageJson(json.replace('"deckhand": "approved"', '"deckhand": "pending"'));
    expect(fillGate(pending).ok).toBe(false);
  });
});
