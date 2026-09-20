/**
 * Readiness on the dashboard: the ACE Helper's checks and mapping status,
 * the INTTRA Helper's screens and grid, the operator's step list, and the
 * provenance table - all computed from the same package the extensions read.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../src/core/settings.js';
import { ALL_MAPPINGS } from '../../src/ace/mappings/index.js';
import { GRID_COLUMNS } from '../../inttra-extension/src/mappings/index.js';
import { approveDeckhand, parseFilingPackageJson, setManualContainer } from '../../shared/src/index.js';
import { approveExtraction, buildPackage, extractDocument, importPackage, importWorkbook, newShipment, packageText, replacePackage } from '../../web/src/workflow.js';
import { aceReadiness, filterProvenance, inttraReadiness, nextActions, provenanceRows } from '../../web/src/readiness.js';
import { deckhandText, handFilledWorkbook, handRow, NOW, quickBooksWorkbook, type QuickBooksWorkbook } from './fixtures.js';
import type { ShipmentRecord } from '../../web/src/state.js';

let quickbooks: QuickBooksWorkbook;
let ready: ShipmentRecord;

beforeAll(async () => {
  quickbooks = await quickBooksWorkbook();
  let record = importWorkbook(newShipment('', NOW), quickbooks.bytes, quickbooks.fileName, DEFAULT_SETTINGS, NOW);
  record = extractDocument(record, { kind: 'text', text: deckhandText('04-booking-confirmation.txt'), name: 'booking email' }, NOW);
  ready = approveExtraction(buildPackage(record, NOW), NOW);
});

describe('ACE readiness', () => {
  it('is unavailable without commercial data, and says what to import', () => {
    const empty = aceReadiness(newShipment('', NOW));
    expect(empty.status).toBe('unavailable');
    expect(empty.reason).toMatch(/Import the ACE workbook/);
    const transportOnly = extractDocument(newShipment('', NOW), { kind: 'text', text: deckhandText('04-booking-confirmation.txt'), name: 'email' }, NOW);
    expect(aceReadiness(buildPackage(transportOnly, NOW)).status).toBe('unavailable');
  });

  it('runs the ACE Helper checks and mapping status over the package view', () => {
    const ace = aceReadiness(ready);
    expect(ace.status).toBe('review');
    expect(ace.data?.fromPackage).toBe(true);
    expect(ace.preflight?.blocking).toEqual([]);
    expect(ace.mapping).toHaveLength(ALL_MAPPINGS.length);
    // Renamed on 2026-09-16: ACE Step 4 files the booking number in its
    // Transportation Reference Number box.
    const booking = ace.mapping.find((row) => row.key === 'TransportationReferenceNumber');
    expect(booking?.aceValue).toBe('EBKG18531408');
    expect(booking?.source).toContain('Deckhand');
    const weight = ace.mapping.find((row) => row.key === 'ShippingWeight');
    expect(weight?.aceValue).toBe('79832');
    // The companion writes the pounds in the cell and the unit beside it; the transform names both.
    expect(weight?.transform).toContain('0.45359237');
    expect(weight?.original).toBe('176000');
    // Three containers, one ACE container box: left for the operator and said so.
    expect(ace.data?.view.notes.some((note) => /3 containers/.test(note.message))).toBe(true);
    expect(ace.summary?.total).toBe(ALL_MAPPINGS.length);
    expect(ace.summary?.blocked).toBe(0);
  });

  it('goes blocked on a blocking data quality issue, before any file leaves the dashboard', () => {
    const bad = handFilledWorkbook(handRow({ 2: '' }));
    const record = importWorkbook(newShipment('', NOW), bad.bytes, bad.fileName, DEFAULT_SETTINGS, NOW);
    const ace = aceReadiness(record);
    expect(ace.status).toBe('blocked');
    expect(ace.data?.fromPackage).toBe(false);
    expect(ace.preflight?.checks.find((check) => check.id === 'scheduleB')?.status).toBe('fail');
    expect(ace.mapping.find((row) => row.key === 'ScheduleB')?.status).toBe('MISSING');
  });
});

describe('INTTRA readiness', () => {
  it('is unavailable until a package exists', () => {
    const record = importWorkbook(newShipment('', NOW), quickbooks.bytes, quickbooks.fileName, DEFAULT_SETTINGS, NOW);
    const inttra = inttraReadiness(record);
    expect(inttra.status).toBe('unavailable');
    expect(inttra.reason).toMatch(/Build the filing package/);
    expect(inttra.grid.columns).toEqual(GRID_COLUMNS.map((column) => column.label));
    expect(inttra.unverifiedFields).toBeGreaterThan(0);
  });

  it('reads the INTTRA Helper mappings against the package, screen by screen', () => {
    const inttra = inttraReadiness(ready);
    // Review, not ready, and correctly so: the Shipper Seal # is the seal an
    // unattributed "Seal" column feeds and the one the operator applies, so it
    // is an expected grid column. MSDU7654322 carries only a carrier seal in
    // this document, which is a real cell for the operator to fill rather than
    // something to invent. The gate still passes: the package is fillable.
    expect(inttra.status).toBe('review');
    expect(inttra.gate?.ok).toBe(true);
    expect(inttra.grid.rows[1]?.cells.find((cell) => cell.key === 'ShipperSeal')?.status).toBe('missing');
    const general = inttra.screens.find((screen) => screen.page === 'generalDetails')!;
    expect(general.label).toBe('Create Shipping Instruction');
    const booking = general.fields.find((field) => field.key === 'BookingNumber')!;
    expect(booking).toMatchObject({ value: 'EBKG18531408', status: 'ready' });
    expect(booking.provenance).toContain('Deckhand, confirmed by QuickBooks');
    expect(general.fields.find((field) => field.key === 'Vessel')?.value).toBe('MSC FIRENZE');
    expect(general.fields.find((field) => field.key === 'PortOfDischarge')?.value).toBe('Derince');
    expect(general.missing).toBe(0);

    const cargo = inttra.screens.filter((screen) => screen.page === 'containerCargo');
    expect(cargo.map((screen) => screen.containerIndex)).toEqual([0, 1, 2]);
    const first = cargo[0]!;
    expect(first.fields.find((field) => field.key === 'ContainerNumber')?.value).toBe('MSCU1234566');
    expect(first.fields.find((field) => field.key === 'CarrierSeal')?.value).toBe('SL-4471209');
    expect(first.fields.find((field) => field.key === 'ShipperSeal')?.value).toBe('SH-001');
    expect(first.fields.find((field) => field.key === 'CargoDescription')?.provenance).toContain('QuickBooks');
    // Three containers and one invoice weight: not split, so missing, with the reason.
    const weight = first.fields.find((field) => field.key === 'GrossWeight')!;
    expect(weight.status).not.toBe('ready');
    expect(weight.provenance).toContain('total across 3 containers');

    expect(inttra.grid.rows).toHaveLength(3);
    expect(inttra.grid.rows.map((row) => row.containerNumber)).toEqual(['MSCU1234566', 'MSDU7654322', 'TGHU7654320']);
    // Container 3's seal is headed just "Seal:", so it is read as the shipper's.
    expect(inttra.grid.rows[2]?.cells.find((cell) => cell.key === 'ShipperSeal')?.value).toBe('SL-9');
    expect(inttra.grid.rows[0]?.cells.find((cell) => cell.key === 'ShipperSeal')?.value).toBe('SH-001');
    expect(inttra.grid.rows[0]?.cells.find((cell) => cell.key === 'HsCode')?.value).toBe('0802.12');
  });

  it('is blocked while the Deckhand half is pending, and turns a typed value ready', () => {
    const pending = parseFilingPackageJson(packageText(ready)!.replace('"deckhand": "approved"', '"deckhand": "pending"'));
    const record = importPackage(newShipment('', NOW), JSON.stringify(pending), 'filing-package.json', NOW);
    expect(inttraReadiness(record).status).toBe('blocked');
    expect(inttraReadiness(record).gate?.reasons[0]).toContain('not been approved');

    let typed = replacePackage(record, approveDeckhand(record.pkg!, NOW), 'approved', NOW);
    typed = replacePackage(typed, setManualContainer(typed.pkg!, 0, 'packageType', 'CT'), 'typed', NOW);
    const first = inttraReadiness(typed).screens.find((screen) => screen.page === 'containerCargo' && screen.containerIndex === 0)!;
    expect(first.fields.find((field) => field.key === 'PackageType')).toMatchObject({ value: 'CT', status: 'ready' });
    expect(first.fields.find((field) => field.key === 'PackageType')?.provenance).toContain('Manual');
  });
});

describe('what the operator still has to do', () => {
  it('starts with the import and ends in the two portals, with the operator submitting', () => {
    const steps = nextActions(newShipment('', NOW));
    expect(steps[0]?.done).toBe(false);
    expect(steps[0]?.tab).toBe('import');
    expect(steps.at(-2)?.step).toMatch(/ACE Helper/);
    expect(steps.at(-2)?.step).toMatch(/submit in ACE yourself/);
    expect(steps.at(-1)?.step).toMatch(/INTTRA Helper/);
    expect(steps.at(-1)?.step).toMatch(/submit in INTTRA yourself/);
    expect(steps.every((step) => !/automatic|auto-fill|auto fill/i.test(step.step))).toBe(true);
  });

  it('ticks off what is done and names what is missing', () => {
    const steps = nextActions(ready);
    expect(steps.filter((step) => step.done).map((step) => step.tab)).toEqual(['import', 'deckhand', 'deckhand', 'package', 'ace']);
    const missing = steps.find((step) => /no source holds/.test(step.step))!;
    expect(missing.done).toBe(false);
    expect(missing.detail).toContain('MSCU1234566: Package type');
    expect(missing.detail).toContain('Gross weight (kg)');
    const firstOpen = steps.find((step) => !step.done)!;
    expect(firstOpen.step).toMatch(/no source holds/);
  });

  it('puts the conflict before everything else once a package disagrees with itself', async () => {
    const other = await quickBooksWorkbook({ bookingNumber: 'EBKG00000001', vessel: 'MSC FIRENZE V.541W' });
    let record = importWorkbook(newShipment('', NOW), other.bytes, other.fileName, DEFAULT_SETTINGS, NOW);
    record = extractDocument(record, { kind: 'text', text: deckhandText('04-booking-confirmation.txt'), name: 'booking email' }, NOW);
    record = approveExtraction(buildPackage(record, NOW), NOW);
    const firstOpen = nextActions(record).find((step) => !step.done)!;
    expect(firstOpen.step).toMatch(/Resolve 1 conflict/);
    expect(firstOpen.tab).toBe('package');
    expect(firstOpen.detail).toContain('EBKG00000001');
  });

  it('flags a blocking data quality issue as work to do at the source', () => {
    const bad = handFilledWorkbook(handRow({ 2: '' }));
    const record = importWorkbook(newShipment('', NOW), bad.bytes, bad.fileName, DEFAULT_SETTINGS, NOW);
    const step = nextActions(record).find((item) => /blocking data quality/.test(item.step))!;
    expect(step.done).toBe(false);
    expect(step.detail).toContain('Schedule B');
  });
});

describe('where did this value come from?', () => {
  it('answers for every header, cargo and container value', () => {
    const { rows, preview } = provenanceRows(ready);
    expect(preview).toBe(false);
    const booking = rows.find((row) => row.field === 'bookingReference')!;
    expect(booking).toMatchObject({ where: 'Header', value: 'EBKG18531408', source: 'deckhand', description: 'Deckhand, confirmed by QuickBooks' });
    const weight = rows.find((row) => row.where === 'Line 1' && row.field === 'weightKg')!;
    expect(weight).toMatchObject({ value: '79832', source: 'quickbooks', original: '176000' });
    expect(weight.transform).toContain('0.45359237');
    const hs = rows.find((row) => row.where === 'Line 1' && row.field === 'hsCode')!;
    expect(hs).toMatchObject({ value: '0802.12', source: 'derived', original: '0802.12.0000' });
    const seal = rows.find((row) => row.where.startsWith('Container 3') && row.field === 'shipperSeal')!;
    expect(seal).toMatchObject({ value: 'SL-9', source: 'deckhand' });
    const packageType = rows.find((row) => row.where.startsWith('Container 1') && row.field === 'packageType')!;
    expect(packageType).toMatchObject({ value: '', source: 'missing' });
    expect(packageType.detail).toContain('not held by any source');
  });

  it('previews from the sources before the package is built, and filters', () => {
    const record = importWorkbook(newShipment('', NOW), quickbooks.bytes, quickbooks.fileName, DEFAULT_SETTINGS, NOW);
    const { rows, preview } = provenanceRows(record);
    expect(preview).toBe(true);
    expect(rows.find((row) => row.field === 'customerName')?.source).toBe('quickbooks');
    expect(provenanceRows(newShipment('', NOW)).rows).toEqual([]);
    expect(filterProvenance(rows, 'almond').every((row) => /almond/i.test(`${row.value} ${row.detail} ${row.original}`))).toBe(true);
    expect(filterProvenance(rows, 'almond').length).toBeGreaterThan(0);
    expect(filterProvenance(rows, '')).toEqual(rows);
  });
});
