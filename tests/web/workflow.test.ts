/**
 * The dashboard workflow, end to end, in the browser's own terms:
 *
 *   the companion's workbook (from the qbXML fixture)  ->  import
 *   the sanitized booking email                        ->  extract, approve
 *   ->  package  ->  filing-package.json  ->  re-import  ->  the same values
 *   ->  the ACE workbook  ->  the ACE Helper's reader  ->  the same values
 *
 * Nothing is stubbed: the same source registry, extractor, builder and
 * parser the extensions run.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { loadFromBytes } from '../../src/sources/index.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';
import { fillGate, resolveConflict, setManualContainer, setManualHeader } from '../../shared/src/index.js';
import {
  aceData,
  approveExtraction,
  attachExtraction,
  buildPackage,
  canBuild,
  discardExtraction,
  discardPackage,
  extractDocument,
  importFile,
  importPackage,
  importWorkbook,
  newShipment,
  packageFileName,
  packageText,
  renameShipment,
  replacePackage,
  shipmentLabel,
  WorkflowError,
} from '../../web/src/workflow.js';
import { buildDashboardWorkbook, DASHBOARD_WORKBOOK_BANNER } from '../../web/src/exportExcel.js';
import { provenanceRows } from '../../web/src/readiness.js';
import { extractShipment } from '../../deckhand/src/index.js';
import { deckhandText, handFilledWorkbook, handRow, NOW, quickBooksWorkbook, type QuickBooksWorkbook } from './fixtures.js';

let quickbooks: QuickBooksWorkbook;

beforeAll(async () => {
  quickbooks = await quickBooksWorkbook();
});

describe('a shipment', () => {
  it('starts empty and is named from its data', () => {
    const record = newShipment('', NOW);
    expect(record.commercial).toBeNull();
    expect(record.extraction).toBeNull();
    expect(record.pkg).toBeNull();
    expect(shipmentLabel(record)).toBe('New shipment');
    expect(canBuild(record).ok).toBe(false);
    expect(shipmentLabel(renameShipment(record, ' Almonds to Derince '))).toBe('Almonds to Derince');
  });

  it('is never mutated by a step', () => {
    const record = newShipment('', NOW);
    const before = JSON.stringify(record);
    importWorkbook(record, quickbooks.bytes, quickbooks.fileName, DEFAULT_SETTINGS, NOW);
    expect(JSON.stringify(record)).toBe(before);
  });
});

describe('importing', () => {
  it('reads the companion workbook through the extension source registry, labelled as a QuickBooks export', () => {
    const record = importWorkbook(newShipment('', NOW), quickbooks.bytes, quickbooks.fileName, DEFAULT_SETTINGS, NOW);
    expect(record.commercial?.source.id).toBe('quickbooks-export');
    expect(record.commercial?.shipment.invoice.invoiceNumber).toBe('CN-1042');
    expect(record.commercial?.shipment.commodities[0]?.shippingWeight).toBe(79832);
    expect(record.commercial?.shipment.provenance.commodities[1]?.['shippingWeight']?.transform).toContain('0.45359237');
    expect(shipmentLabel(record)).toBe('CN-1042');
    expect(record.activity.at(-1)?.message).toContain('QuickBooks export imported');
  });

  it('reads a hand-filled template exactly as the ACE Helper does', () => {
    const hand = handFilledWorkbook();
    const record = importWorkbook(newShipment('', NOW), hand.bytes, hand.fileName, DEFAULT_SETTINGS, NOW);
    const direct = loadFromBytes(hand.bytes, hand.fileName, { settings: DEFAULT_SETTINGS });
    expect(record.commercial?.source.id).toBe('excel');
    const stamped = (shipment: typeof direct.shipment) => ({ ...shipment, source: { ...shipment.source, importedAt: '' } });
    expect(stamped(record.commercial!.shipment)).toEqual(stamped(direct.shipment));
    expect(record.commercial?.validation).toEqual(direct.validation);
  });

  it('refuses what the ACE Helper refuses, with the same message', () => {
    expect(() => importWorkbook(newShipment('', NOW), new TextEncoder().encode('a,b,c'), 'rows.csv')).toThrow(WorkflowError);
    expect(() => importWorkbook(newShipment('', NOW), new TextEncoder().encode('a,b,c'), 'rows.csv')).toThrow(/\.xlsx workbook/);
    expect(() => importPackage(newShipment('', NOW), '{"hello":"world"}', 'notes.json')).toThrow(/not a filing package/);
    expect(() => importFile(newShipment('', NOW), new TextEncoder().encode('{"schemaVersion":"1.0","header":{},"containers":[]}'), 'broken.json')).toThrow(WorkflowError);
  });
});

describe('the whole chain: fixture -> dashboard -> package -> file -> dashboard', () => {
  it('keeps every canonical value through export and re-import', () => {
    let record = importWorkbook(newShipment('', NOW), quickbooks.bytes, quickbooks.fileName, DEFAULT_SETTINGS, NOW);
    record = extractDocument(record, { kind: 'text', text: deckhandText('04-booking-confirmation.txt'), name: 'booking email' }, NOW);
    expect(record.extraction?.approvedAt).toBeNull();
    expect(record.pkg).toBeNull();

    record = buildPackage(record, NOW);
    expect(record.pkg?.review.deckhand).toBe('pending');
    expect(fillGate(record.pkg!).ok).toBe(false);

    record = approveExtraction(record, NOW);
    expect(record.extraction?.approvedAt).toBe(NOW.toISOString());
    // The package was rebuilt with the approval, not edited.
    expect(record.pkg?.review.deckhand).toBe('approved');
    expect(record.pkg?.conflicts).toEqual([]);
    expect(fillGate(record.pkg!).ok).toBe(true);
    expect(record.pkg?.header.bookingReference).toMatchObject({ value: 'EBKG18531408', source: 'deckhand', confirmedBy: 'quickbooks' });
    expect(record.pkg?.containers.map((container) => container.containerNumber.value)).toEqual(['MSCU1234566', 'MSDU7654322', 'TGHU7654320']);
    expect(record.pkg?.containers.map((container) => container.carrierSeal.value)).toEqual(['SL-4471209', 'SL-4471210', 'SL-9']);

    const json = packageText(record)!;
    expect(packageFileName(record)).toBe('filing-package-CN-1042_EBKG18531408.json');

    const reopened = importPackage(newShipment('', NOW), json, packageFileName(record), NOW);
    expect(reopened.pkg).toEqual(record.pkg);
    expect(reopened.commercial?.shipment).toEqual(record.commercial?.shipment);
    expect(reopened.commercial?.source.id).toBe('quickbooks-export');
    expect(reopened.extraction?.shipment).toEqual(record.extraction?.shipment);
    expect(reopened.extraction?.approvedAt).toBe(NOW.toISOString());
    expect(shipmentLabel(reopened)).toBe('CN-1042_EBKG18531408');

    // And the same file is what the ACE Helper reads: its view matches the dashboard's.
    const ace = aceData(reopened)!;
    expect(ace.fromPackage).toBe(true);
    expect(ace.view.shipment.invoice.bookingNumber).toBe('EBKG18531408');
    expect(ace.view.shipment.invoice.vessel).toBe('MSC FIRENZE');
    expect(ace.view.shipment.commodities).toEqual(record.commercial?.shipment.commodities);
  });

  it('writes an ACE workbook the ACE Helper reads back to the same canonical values, as an Excel workbook', () => {
    let record = importWorkbook(newShipment('', NOW), quickbooks.bytes, quickbooks.fileName, DEFAULT_SETTINGS, NOW);
    record = extractDocument(record, { kind: 'text', text: deckhandText('04-booking-confirmation.txt'), name: 'booking email' }, NOW);
    record = approveExtraction(buildPackage(record, NOW), NOW);
    const ace = aceData(record)!;
    const workbook = buildDashboardWorkbook(ace.view.shipment, ace.validation, provenanceRows(record).rows, ace.source.detail, NOW);
    expect(workbook.fileName).toBe('ACE_Invoice_CN-1042.xlsx');

    const reread = loadFromBytes(workbook.bytes, workbook.fileName, { settings: DEFAULT_SETTINGS });
    // Not a QuickBooks export: the dashboard wrote it, and the ACE Helper must not say otherwise.
    expect(reread.source.id).toBe('excel');
    expect(reread.shipment.invoice).toEqual(ace.view.shipment.invoice);
    expect(reread.shipment.commodities).toEqual(ace.view.shipment.commodities);
    expect(reread.validation.errors).toBe(0);

    // The provenance sheet is there for the human, under its own banner.
    const parsed = XLSX.read(workbook.bytes, { type: 'array' });
    expect(parsed.SheetNames).toEqual(['Shipment', 'Provenance', 'Checks']);
    const banner = (parsed.Sheets['Provenance']?.['A1'] as { v: string } | undefined)?.v;
    expect(banner).toBe(DASHBOARD_WORKBOOK_BANNER);
    const rows = XLSX.utils.sheet_to_json<string[]>(parsed.Sheets['Provenance']!, { header: 1 }) as string[][];
    expect(rows.some((row) => row[1] === 'Booking reference' && row[2] === 'EBKG18531408' && String(row[3]).includes('Deckhand'))).toBe(true);
  });
});

describe('conflicts and decisions', () => {
  it('surfaces a disagreement, lets the operator pick, and keeps the pick through rebuilds and files', async () => {
    const other = await quickBooksWorkbook({ bookingNumber: 'EBKG00000001', vessel: 'MSC FIRENZE V.541W' });
    let record = importWorkbook(newShipment('', NOW), other.bytes, other.fileName, DEFAULT_SETTINGS, NOW);
    record = extractDocument(record, { kind: 'text', text: deckhandText('04-booking-confirmation.txt'), name: 'booking email' }, NOW);
    record = approveExtraction(buildPackage(record, NOW), NOW);
    const conflict = record.pkg!.conflicts.find((item) => item.field === 'bookingReference')!;
    expect(conflict).toMatchObject({ material: true, resolution: 'unresolved', commercialValue: 'EBKG00000001', deckhandValue: 'EBKG18531408' });
    expect(fillGate(record.pkg!).ok).toBe(false);

    record = replacePackage(record, resolveConflict(record.pkg!, conflict.id, 'commercial'), 'Conflict resolved.', NOW);
    expect(record.pkg?.header.bookingReference.value).toBe('EBKG00000001');
    expect(fillGate(record.pkg!).ok).toBe(true);

    record = replacePackage(record, setManualHeader(record.pkg!, 'portOfDischarge', 'Derince, TR'), 'Typed.', NOW);
    record = replacePackage(record, setManualContainer(record.pkg!, 0, 'packageType', 'CT'), 'Typed.', NOW);
    expect(record.pkg?.header.portOfDischarge).toMatchObject({ value: 'Derince, TR', source: 'manual' });
    expect(record.pkg?.containers[0]?.packageType).toMatchObject({ value: 'CT', source: 'manual' });

    // A rebuild from the sources keeps the decisions.
    const rebuilt = buildPackage(record, NOW);
    expect(rebuilt.pkg?.decisions).toEqual(record.pkg?.decisions);
    expect(rebuilt.pkg?.header.bookingReference.value).toBe('EBKG00000001');
    expect(rebuilt.pkg?.containers[0]?.packageType.value).toBe('CT');

    // So does the file.
    const reopened = importPackage(newShipment('', NOW), packageText(rebuilt)!, 'filing-package.json', NOW);
    expect(reopened.pkg?.conflicts[0]?.resolution).toBe('commercial');
    expect(reopened.pkg?.header.portOfDischarge.source).toBe('manual');
  });

  it('rebuilds the package when a source changes, and demands approval again after a new extraction', () => {
    let record = importWorkbook(newShipment('', NOW), quickbooks.bytes, quickbooks.fileName, DEFAULT_SETTINGS, NOW);
    record = extractDocument(record, { kind: 'text', text: deckhandText('04-booking-confirmation.txt'), name: 'booking email' }, NOW);
    record = approveExtraction(buildPackage(record, NOW), NOW);
    record = replacePackage(record, setManualHeader(record.pkg!, 'portOfLoading', 'Long Beach, CA'), 'Typed.', NOW);

    const hand = handFilledWorkbook(handRow({ 15: 'CN-2000' }));
    record = importWorkbook(record, hand.bytes, hand.fileName, DEFAULT_SETTINGS, NOW);
    expect(record.pkg?.header.invoiceNumber.value).toBe('CN-2000');
    expect(record.pkg?.commercialSource?.id).toBe('excel');
    expect(record.pkg?.header.portOfLoading).toMatchObject({ value: 'Long Beach, CA', source: 'manual' });
    expect(record.pkg?.review.deckhand).toBe('approved');

    record = extractDocument(record, { kind: 'text', text: deckhandText('01-aligned.txt'), name: 'second email' }, NOW);
    expect(record.extraction?.approvedAt).toBeNull();
    expect(record.pkg?.review.deckhand).toBe('pending');
    expect(fillGate(record.pkg!).reasons[0]).toContain('not been approved');

    record = discardExtraction(record, NOW);
    expect(record.extraction).toBeNull();
    expect(record.pkg?.review.deckhand).toBe('not-applicable');

    record = discardPackage(record, NOW);
    expect(record.pkg).toBeNull();
    expect(record.commercial).not.toBeNull();
  });
});

describe('approval', () => {
  it('is refused while the review has a blocking problem, exactly as in the panels', () => {
    let record = extractDocument(newShipment('', NOW), { kind: 'text', text: deckhandText('03-bad-check-digit.txt'), name: 'bad email' }, NOW);
    expect(() => approveExtraction(record, NOW)).toThrow(WorkflowError);
    expect(() => approveExtraction(record, NOW)).toThrow(/Cannot approve/);
    record = attachExtraction(record, extractShipment({ kind: 'text', text: deckhandText('02-unaligned.txt'), name: 'two lists' }), NOW);
    expect(() => approveExtraction(record, NOW)).toThrow(/Cannot approve/);
    expect(() => approveExtraction(newShipment('', NOW), NOW)).toThrow(/no extraction/);
  });

  it('builds a transport-only package from an email alone, which ACE cannot use and says so', () => {
    let record = extractDocument(newShipment('', NOW), { kind: 'text', text: deckhandText('04-booking-confirmation.txt'), name: 'booking email' }, NOW);
    record = approveExtraction(buildPackage(record, NOW), NOW);
    expect(record.pkg?.invoice).toBeNull();
    expect(record.pkg?.containers).toHaveLength(3);
    expect(aceData(record)).toBeNull();
    const reopened = importPackage(newShipment('', NOW), packageText(record)!, 'filing-package.json', NOW);
    expect(reopened.commercial).toBeNull();
    expect(reopened.pkg).toEqual(record.pkg);
  });
});
