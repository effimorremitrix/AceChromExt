/**
 * The filing package: building it from one source or both, matching,
 * conflicts, provenance, the fill gate, the ACE view and the JSON round trip.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { extractWithRules, withCheckDigit, type DeckhandShipment } from '../deckhand/src/index.js';
import { readWorkbookBytes } from '../src/excel/excelReader.js';
import { TEMPLATE_COLUMNS } from '../src/excel/columnAliases.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { loadWorkbook, sourceForWorkbook } from '../src/sources/index.js';
import { FilingPackageSource, loadFilingPackageText } from '../src/sources/FilingPackageSource.js';
import { SourceError } from '../src/sources/InvoiceDataSource.js';
import type { CanonicalShipment } from '../src/models/CanonicalInvoice.js';
import {
  aceShipmentFromPackage,
  approveDeckhand,
  buildFilingPackage,
  describeProvenance,
  fillGate,
  filingPackageFileName,
  FilingPackageError,
  FilingPackageParseError,
  looksLikeFilingPackage,
  parseFilingPackageJson,
  rebuildFilingPackage,
  resolveConflict,
  serializeFilingPackage,
  setManualContainer,
  setManualHeader,
  type CommercialSource,
} from '../shared/src/index.js';

const NOW = new Date('2026-09-14T12:00:00Z');
const C1 = withCheckDigit('MSCU123456'); // MSCU1234566
const C2 = withCheckDigit('MSDU765432'); // MSDU7654322
const EMAIL = readFileSync(join(__dirname, 'fixtures', 'deckhand', '04-booking-confirmation.txt'), 'utf8');

const ROW: Array<string | number> = [
  1, 'OS', '0802.12.0000', 'SHELLED ALMONDS', 79832, 'KG', '', '', 'D', 651217.6, 176000, 'lb', 'EAR99', 'C33',
  'Aydin Kuruyemis San Ve Tic A.S', 'CN-1042', '2026-09-21', 'Organize Sanayi Bolgesi 3. Cadde No 14', '', 'Aydin', '', '09100', 'TR', 'CA', 'CIF', 'NET 120', '2027-01-19',
  '3993', 'MSC Line', 'MSC FIRENZE V.541W', 'EBKG18531408', C1, 'SL-4471209', 'TR',
];

function invoiceFromRows(rows: Array<Array<string | number>>): { shipment: CanonicalShipment; source: CommercialSource } {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS, ...rows]), 'Shipment');
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  const workbook = readWorkbookBytes(bytes, 'ACE_Invoice_CN-1042.xlsx');
  const loaded = loadWorkbook(workbook, { settings: DEFAULT_SETTINGS });
  const descriptor = sourceForWorkbook(workbook).describe(workbook);
  return { shipment: loaded.shipment, source: { id: 'excel', label: descriptor.label, detail: descriptor.detail } };
}

/**
 * ROW with named columns replaced.
 *
 * Addressed by column name rather than by position: these fixtures used to
 * carry raw indices, and adding OriginState to the template on 2026-09-16
 * silently shifted every override past BillToCountry onto the wrong field.
 */
const invoice = (overrides: Partial<Record<(typeof TEMPLATE_COLUMNS)[number], string | number>> = {}): ReturnType<typeof invoiceFromRows> => {
  const row = [...ROW];
  for (const [column, value] of Object.entries(overrides)) {
    const index = TEMPLATE_COLUMNS.indexOf(column as (typeof TEMPLATE_COLUMNS)[number]);
    if (index < 0) throw new Error(`No template column named "${column}".`);
    row[index] = value as string | number;
  }
  return invoiceFromRows([row]);
};

const deckhand = (text = EMAIL): DeckhandShipment => extractWithRules(text);

describe('commercial data only', () => {
  it('builds a package with booking, vessel, container and seal from the workbook', () => {
    const { shipment, source } = invoice();
    const pkg = buildFilingPackage({ invoice: shipment, commercialSource: source, now: NOW });
    expect(pkg.review.deckhand).toBe('not-applicable');
    expect(pkg.header.bookingReference).toMatchObject({ value: 'EBKG18531408', source: 'excel' });
    expect(pkg.header.invoiceNumber.value).toBe('CN-1042');
    expect(pkg.header.totalWeightKg).toMatchObject({ value: '79832', source: 'derived' });
    expect(pkg.containers).toHaveLength(1);
    expect(pkg.containers[0]).toMatchObject({ containerNumber: { value: C1, source: 'excel' }, carrierSeal: { value: 'SL-4471209' }, status: 'valid' });
    expect(pkg.containers[0]?.cargoDescription.value).toBe('SHELLED ALMONDS');
    expect(pkg.containers[0]?.hsCode).toMatchObject({ value: '0802.12', source: 'derived' });
    expect(pkg.containers[0]?.grossWeightKg).toMatchObject({ value: '79832', source: 'derived' });
    expect(pkg.containers[0]?.packageType.source).toBe('missing');
    expect(pkg.conflicts).toEqual([]);
    expect(fillGate(pkg).ok).toBe(true);
    expect(pkg.packageId).toBe('CN-1042_EBKG18531408');
    expect(filingPackageFileName(pkg)).toBe('filing-package-CN-1042_EBKG18531408.json');
  });

  it('carries the weight provenance through: lb x 0.45359237', () => {
    const { shipment, source } = invoice();
    const pkg = buildFilingPackage({ invoice: shipment, commercialSource: source, now: NOW });
    const weight = pkg.cargo[0]?.weightKg;
    expect(weight?.value).toBe('79832');
    expect(weight?.original).toContain('176000');
    expect(weight?.transform).toContain('0.45359237');
    expect(describeProvenance(weight!)).toContain('0.45359237');
  });

  it('labels a QuickBooks export as QuickBooks', () => {
    const { shipment } = invoice();
    const pkg = buildFilingPackage({ invoice: shipment, commercialSource: { id: 'quickbooks-export', label: 'QuickBooks export', detail: 'x' }, now: NOW });
    expect(pkg.header.customerName.source).toBe('quickbooks');
  });
});

describe('Deckhand only', () => {
  it('builds a package with transport identifiers and nothing invented for the cargo', () => {
    const pkg = buildFilingPackage({ shipment: deckhand(), now: NOW });
    expect(pkg.invoice).toBeNull();
    expect(pkg.review.deckhand).toBe('pending');
    expect(pkg.header.bookingReference).toMatchObject({ value: 'EBKG18531408', source: 'deckhand', confidence: 'high' });
    expect(pkg.header.vessel.value).toBe('MSC FIRENZE');
    expect(pkg.header.voyage.value).toBe('541W');
    expect(pkg.header.customerName.source).toBe('missing');
    expect(pkg.containers).toHaveLength(3);
    expect(pkg.containers[0]?.cargoDescription.source).toBe('missing');
    expect(pkg.containers[0]?.carrierSeal.value).toBe('SL-4471209');
    expect(pkg.containers[0]?.shipperSeal.value).toBe('SH-001');
    expect(fillGate(pkg)).toEqual({ ok: false, reasons: ['The Deckhand extraction has not been approved.'] });
    expect(() => aceShipmentFromPackage(pkg)).toThrow(/no commercial data/);
  });

  it('is fillable once approved, and approval is refused while the extraction has blocking problems', () => {
    const pkg = approveDeckhand(buildFilingPackage({ shipment: deckhand(), now: NOW }), NOW);
    expect(pkg.review).toEqual({ deckhand: 'approved', approvedAt: NOW.toISOString() });
    expect(fillGate(pkg).ok).toBe(true);
    const bad = buildFilingPackage({ shipment: deckhand('Container TGHU7654321 | Seal No: SL-1'), now: NOW });
    expect(() => approveDeckhand(bad)).toThrow(FilingPackageError);
    expect(fillGate(bad).reasons.some((reason) => /check digit/.test(reason))).toBe(true);
  });

  it('refuses to build from nothing', () => {
    expect(() => buildFilingPackage({})).toThrow(FilingPackageError);
  });
});

describe('QuickBooks + Deckhand', () => {
  it('confirms matching identifiers rather than duplicating them', () => {
    const { shipment, source } = invoice();
    const pkg = buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), deckhandApproved: true, now: NOW });
    expect(pkg.header.bookingReference).toMatchObject({ value: 'EBKG18531408', source: 'deckhand', confirmedBy: 'excel' });
    // "MSC FIRENZE V.541W" agrees with vessel "MSC FIRENZE" + voyage "541W".
    expect(pkg.header.vessel).toMatchObject({ value: 'MSC FIRENZE', source: 'deckhand', confirmedBy: 'excel' });
    const first = pkg.containers.find((container) => container.containerNumber.value === C1);
    expect(first?.containerNumber.confirmedBy).toBe('excel');
    expect(first?.carrierSeal).toMatchObject({ value: 'SL-4471209', source: 'deckhand', confirmedBy: 'excel' });
    expect(pkg.conflicts).toEqual([]);
  });

  it('gives Deckhand the containers and the invoice the cargo, without splitting a total weight', () => {
    const { shipment, source } = invoice();
    const pkg = buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), deckhandApproved: true, now: NOW });
    expect(pkg.containers).toHaveLength(3);
    for (const container of pkg.containers) {
      expect(container.cargoDescription).toMatchObject({ value: 'SHELLED ALMONDS', source: 'excel' });
      expect(container.hsCode.value).toBe('0802.12');
      expect(container.grossWeightKg.source).toBe('missing');
      expect(container.grossWeightKg.detail).toMatch(/total across 3 containers/);
    }
    expect(pkg.notes.some((note) => /not split/.test(note.message))).toBe(true);
  });

  it('flags a vessel conflict, follows Deckhand until resolved, and blocks filling', () => {
    const { shipment, source } = invoice({ Vessel: 'MSC FIRENZE II' });
    let pkg = buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), deckhandApproved: true, now: NOW });
    expect(pkg.conflicts).toHaveLength(1);
    expect(pkg.conflicts[0]).toMatchObject({ field: 'vessel', material: true, commercialValue: 'MSC FIRENZE II', deckhandValue: 'MSC FIRENZE', resolution: 'unresolved' });
    expect(pkg.header.vessel.value).toBe('MSC FIRENZE');
    expect(pkg.header.vessel.confirmedBy).toBeUndefined();
    expect(fillGate(pkg).ok).toBe(false);

    pkg = resolveConflict(pkg, 'vessel', 'commercial');
    expect(pkg.header.vessel).toMatchObject({ value: 'MSC FIRENZE II', source: 'excel' });
    expect(pkg.header.vessel.detail).toMatch(/chosen by the operator/);
    expect(pkg.conflicts[0]?.resolution).toBe('commercial');
    expect(fillGate(pkg).ok).toBe(true);

    pkg = resolveConflict(pkg, 'vessel', 'deckhand');
    expect(pkg.header.vessel.value).toBe('MSC FIRENZE');
    expect(() => resolveConflict(pkg, 'nothing', 'deckhand')).toThrow(FilingPackageError);
  });

  it('flags a booking conflict and a container the document does not carry', () => {
    const { shipment, source } = invoice({ BookingNumber: 'OTHER-BOOKING', ContainerNumber: withCheckDigit('HLXU999999') });
    let pkg = buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), deckhandApproved: true, now: NOW });
    expect(pkg.conflicts.map((conflict) => conflict.field).sort()).toEqual(['bookingReference', 'containers']);
    expect(pkg.header.bookingReference.value).toBe('EBKG18531408');
    expect(pkg.containers).toHaveLength(3);
    pkg = resolveConflict(pkg, 'containers', 'commercial');
    expect(pkg.containers).toHaveLength(1);
    expect(pkg.containers[0]?.containerNumber).toMatchObject({ value: withCheckDigit('HLXU999999'), source: 'excel' });
  });

  it('flags a seal conflict on the matching container', () => {
    const { shipment, source } = invoice({ SealNumber: 'SL-DIFFERENT' });
    const pkg = buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), deckhandApproved: true, now: NOW });
    const conflict = pkg.conflicts.find((item) => item.field === 'carrierSeal');
    expect(conflict).toMatchObject({ container: C1, commercialValue: 'SL-DIFFERENT', deckhandValue: 'SL-4471209', material: true });
    expect(pkg.containers.find((container) => container.containerNumber.value === C1)?.carrierSeal.value).toBe('SL-4471209');
  });

  it('never silently overwrites: both values stay in the package', () => {
    const { shipment, source } = invoice({ Vessel: 'MSC FIRENZE II' });
    const pkg = buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), now: NOW });
    const json = serializeFilingPackage(pkg);
    expect(json).toContain('MSC FIRENZE II');
    expect(json).toContain('"MSC FIRENZE"');
  });

  it('lets the operator type a value no source holds, and records it as manual', () => {
    const { shipment, source } = invoice();
    let pkg = buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), deckhandApproved: true, now: NOW });
    pkg = setManualContainer(pkg, 0, 'packageType', 'CT');
    pkg = setManualHeader(pkg, 'portOfLoading', 'Long Beach, CA');
    expect(pkg.containers[0]?.packageType).toMatchObject({ value: 'CT', source: 'manual' });
    expect(pkg.header.portOfLoading).toMatchObject({ value: 'Long Beach, CA', source: 'manual' });
    pkg = setManualHeader(pkg, 'portOfLoading', '');
    expect(pkg.header.portOfLoading.source).toBe('deckhand');
  });

  it('rebuilds deterministically from its two halves and its decisions', () => {
    const { shipment, source } = invoice({ Vessel: 'MSC FIRENZE II' });
    const pkg = resolveConflict(buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), deckhandApproved: true, approvedAt: NOW.toISOString(), now: NOW }), 'vessel', 'deckhand');
    expect(rebuildFilingPackage(pkg)).toEqual(pkg);
  });
});

describe('serialization', () => {
  it('round-trips through filing-package.json and rebuilds the merged values from the sources', () => {
    const { shipment, source } = invoice({ Vessel: 'MSC FIRENZE II' });
    const pkg = resolveConflict(approveDeckhand(buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), now: NOW }), NOW), 'vessel', 'commercial');
    const json = serializeFilingPackage(pkg);
    expect(looksLikeFilingPackage(json)).toBe(true);
    const back = parseFilingPackageJson(json);
    expect(back).toEqual(pkg);
  });

  it('ignores a hand-edited merged value: only the sources and the decisions are trusted', () => {
    const { shipment, source } = invoice();
    const pkg = buildFilingPackage({ invoice: shipment, commercialSource: source, now: NOW });
    const forged = JSON.parse(serializeFilingPackage(pkg)) as { header: { bookingReference: { value: string } } };
    forged.header.bookingReference.value = 'FORGED';
    expect(parseFilingPackageJson(JSON.stringify(forged)).header.bookingReference.value).toBe('EBKG18531408');
  });

  it('rejects garbage', () => {
    expect(() => parseFilingPackageJson('nope')).toThrow(FilingPackageParseError);
    expect(() => parseFilingPackageJson('{"schemaVersion":"2.0"}')).toThrow(/schema version/);
    expect(() => parseFilingPackageJson('{"schemaVersion":"1.0"}')).toThrow(FilingPackageError);
    expect(looksLikeFilingPackage('{"a":1}')).toBe(false);
  });
});

describe('the ACE view', () => {
  it('overlays the approved transport identifiers onto the canonical model with Deckhand provenance', () => {
    const { shipment, source } = invoice({ Vessel: '', BookingNumber: '', ContainerNumber: '', SealNumber: '' });
    const one = deckhand(`Booking: EBKG18531408\nVessel: MSC FIRENZE\n${C2} | Seal: SL-77`);
    const pkg = approveDeckhand(buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: one, now: NOW }), NOW);
    const view = aceShipmentFromPackage(pkg);
    expect(view.shipment.invoice).toMatchObject({ bookingNumber: 'EBKG18531408', vessel: 'MSC FIRENZE', containerNumber: C2, sealNumber: 'SL-77', invoiceNumber: 'CN-1042' });
    expect(view.shipment.provenance.invoice['containerNumber']?.column).toContain('Deckhand');
    expect(view.shipment.commodities).toEqual(shipment.commodities);
    expect(view.notes).toEqual([]);
  });

  it('leaves the container fields alone with several containers, and says so', () => {
    const { shipment, source } = invoice();
    const pkg = approveDeckhand(buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), now: NOW }), NOW);
    const view = aceShipmentFromPackage(pkg);
    expect(view.shipment.invoice.containerNumber).toBe(C1);
    expect(view.notes[0]?.message).toMatch(/3 containers/);
  });

  it('does not apply unapproved Deckhand values', () => {
    const { shipment, source } = invoice({ Vessel: '', BookingNumber: '' });
    const pkg = buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), now: NOW });
    const view = aceShipmentFromPackage(pkg);
    expect(view.shipment.invoice.bookingNumber).toBe('');
    expect(view.notes[0]?.message).toMatch(/not been approved/);
  });

  it('loads through the FilingPackageSource into the same StoredImport shape the workbook path produces', () => {
    const { shipment, source } = invoice();
    const pkg = approveDeckhand(buildFilingPackage({ invoice: shipment, commercialSource: source, shipment: deckhand(), now: NOW }), NOW);
    const loaded = loadFilingPackageText(serializeFilingPackage(pkg), { settings: DEFAULT_SETTINGS });
    expect(loaded.source.id).toBe('filing-package');
    expect(loaded.source.detail).toContain('Deckhand approved');
    expect(loaded.shipment.commodities[0]?.shippingWeight).toBe(79832);
    expect(loaded.validation.errors).toBe(0);
    expect(loaded.package.packageId).toBe(pkg.packageId);
    expect(() => loadFilingPackageText('{"schemaVersion":"1.0","header":{},"containers":[]}', { settings: DEFAULT_SETTINGS })).toThrow(SourceError);
    expect(() => new FilingPackageSource().load(buildFilingPackage({ shipment: deckhand(), now: NOW }), { settings: DEFAULT_SETTINGS })).toThrow(SourceError);
  });
});
