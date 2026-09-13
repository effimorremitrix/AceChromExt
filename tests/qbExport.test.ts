/**
 * The generated workbook.
 *
 * The claim Phase 2 has to earn is "the extension can open this file". The
 * round-trip test below earns it the only honest way: it reads the generated
 * bytes back through the extension's own reader and mapper, and asserts the
 * canonical model that comes out is the one that went in.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseInvoiceQueryResponse } from '../companion/src/qbxml/parse.js';
import { mapQbInvoiceToCanonical } from '../companion/src/mapping/qbToCanonical.js';
import { normalizeConfig, starterConfig } from '../companion/src/config.js';
import {
  aceFileName,
  buildAceWorkbook,
  buildShipmentRows,
  sanitizeFileNamePart,
} from '../companion/src/excel/aceWorkbook.js';
import { ExportError, writeAceWorkbook } from '../companion/src/excel/exportAce.js';
import { readWorkbookBytes, sheetByName } from '../src/excel/excelReader.js';
import { mapSheetToCanonical } from '../src/excel/canonicalMapper.js';
import { TEMPLATE_COLUMNS } from '../src/excel/columnAliases.js';
import { validateShipment } from '../src/excel/validator.js';
import { fixture } from './qbxml.test.js';

const temporaryDirectories: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ace-export-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
  }
});

function mappingFor(name: string, items?: Record<string, unknown>) {
  const invoice = parseInvoiceQueryResponse(fixture(name)).results[0]!;
  const config = normalizeConfig(items ? { ...starterConfig(), items } : starterConfig());
  return mapQbInvoiceToCanonical(invoice, config);
}

describe('the Shipment sheet', () => {
  const mapping = mappingFor('invoice-single-line.xml');
  const rows = buildShipmentRows(mapping.shipment, { weightUom: 'kg', includeAuditSheet: false });

  it('uses the Phase 1 template columns, in the template order', () => {
    expect(rows[0]).toEqual(TEMPLATE_COLUMNS);
  });

  it('writes one row per commodity line', () => {
    expect(rows).toHaveLength(2);
    expect(rows[1]![0]).toBe(1);
  });

  it('writes the shipment-level columns once, on the first line', () => {
    const multi = mappingFor('invoice-multi-line.xml');
    const multiRows = buildShipmentRows(multi.shipment, { weightUom: 'kg', includeAuditSheet: false });
    const customerColumn = TEMPLATE_COLUMNS.indexOf('CustomerName');
    expect(multiRows[1]![customerColumn]).toBe('Aydin Kuruyemis San Ve Tic A.S');
    expect(multiRows[2]![customerColumn]).toBe('');
    expect(multiRows[3]![customerColumn]).toBe('');
  });

  it('declares the unit beside the weight it wrote', () => {
    const weight = TEMPLATE_COLUMNS.indexOf('ShippingWeight');
    const uom = TEMPLATE_COLUMNS.indexOf('ShippingWeightUOM');
    expect(rows[1]![weight]).toBe(79832);
    expect(rows[1]![uom]).toBe('kg');
  });

  it('can write the original pounds instead, without a second rounding', () => {
    const asPounds = buildShipmentRows(mapping.shipment, { weightUom: 'lb', includeAuditSheet: false });
    const weight = TEMPLATE_COLUMNS.indexOf('ShippingWeight');
    const uom = TEMPLATE_COLUMNS.indexOf('ShippingWeightUOM');
    expect(asPounds[1]![weight]).toBe(176000);
    expect(asPounds[1]![uom]).toBe('lb');
  });

  it('falls back to kilograms when there are no pounds to recover', () => {
    const prunes = mappingFor('invoice-multi-line.xml', {
      'Dried Fruit': { scheduleB: '0813.20.0000', unitWeight: 25, unitWeightUom: 'kg', aceUom1: 'KG' },
    });
    const asPounds = buildShipmentRows(prunes.shipment, { weightUom: 'lb', includeAuditSheet: false });
    const uom = TEMPLATE_COLUMNS.indexOf('ShippingWeightUOM');
    expect(asPounds[2]![uom]).toBe('kg');
  });
});

describe('round trip through the extension', () => {
  it('reads back as the same canonical shipment the companion produced', () => {
    const mapping = mappingFor('invoice-single-line.xml');
    const bytes = buildAceWorkbook(mapping.shipment, mapping.origins, {
      weightUom: 'kg',
      includeAuditSheet: true,
      validation: validateShipment(mapping.shipment),
    });

    // Exactly what src/ui/importer.ts does with a file the user picks.
    const workbook = readWorkbookBytes(bytes, 'ACE_Invoice_CN-1042.xlsx');
    const sheet = sheetByName(workbook, undefined);
    const reimported = mapSheetToCanonical(sheet, { fileName: 'ACE_Invoice_CN-1042.xlsx' });

    expect(sheet.name).toBe('Shipment');
    expect(reimported.shipment.invoice).toEqual(mapping.shipment.invoice);
    expect(reimported.shipment.commodities).toEqual(mapping.shipment.commodities);
  });

  it('round-trips a multi-line invoice, group members included', () => {
    const mapping = mappingFor('invoice-multi-line.xml', {
      'Shelled Almonds': { scheduleB: '0802.12.0000', origin: 'D', licenseCode: 'C33', quantityUom: 'lb', aceUom1: 'KG' },
      'Dried Fruit': { scheduleB: '0813.20.0000', origin: 'D', licenseCode: 'C33', unitWeight: 25, unitWeightUom: 'lb', aceUom1: 'KG' },
    });
    const bytes = buildAceWorkbook(mapping.shipment, mapping.origins, { weightUom: 'kg', includeAuditSheet: false });
    const workbook = readWorkbookBytes(bytes, 'ACE_Invoice_CN-1043.xlsx');
    const reimported = mapSheetToCanonical(sheetByName(workbook, undefined), { fileName: 'x.xlsx' });

    expect(reimported.shipment.commodities).toHaveLength(3);
    expect(reimported.shipment.commodities).toEqual(mapping.shipment.commodities);
    expect(reimported.shipment.invoice.bookingNumber).toBe('EBKG18531409');
  });

  it('round-trips the pounds form to the same kilograms', () => {
    const mapping = mappingFor('invoice-single-line.xml');
    const bytes = buildAceWorkbook(mapping.shipment, mapping.origins, { weightUom: 'lb', includeAuditSheet: false });
    const workbook = readWorkbookBytes(bytes, 'ACE_Invoice_CN-1042.xlsx');
    const reimported = mapSheetToCanonical(sheetByName(workbook, undefined), { fileName: 'x.xlsx' });
    expect(reimported.shipment.commodities[0]!.shippingWeight).toBe(79832);
  });

  it('produces no unrecognised columns for the importer to ignore', () => {
    const mapping = mappingFor('invoice-single-line.xml');
    const bytes = buildAceWorkbook(mapping.shipment, mapping.origins, { weightUom: 'kg', includeAuditSheet: false });
    const workbook = readWorkbookBytes(bytes, 'x.xlsx');
    const reimported = mapSheetToCanonical(sheetByName(workbook, undefined), { fileName: 'x.xlsx' });
    expect(reimported.shipment.source.unknownHeaders).toEqual([]);
  });
});

describe('the audit and checks sheets', () => {
  const mapping = mappingFor('invoice-single-line.xml');
  const bytes = buildAceWorkbook(mapping.shipment, mapping.origins, {
    weightUom: 'kg',
    includeAuditSheet: true,
    validation: validateShipment(mapping.shipment),
    generatedBy: 'test',
  });
  const workbook = readWorkbookBytes(bytes, 'x.xlsx');

  it('puts Shipment first so the importer reads it by default', () => {
    expect(workbook.sheetNames).toEqual(['Shipment', 'Audit', 'Checks']);
  });

  it('records where every value came from', () => {
    const audit = workbook.sheets.find((sheet) => sheet.name === 'Audit')!;
    const flat = audit.rows.map((row) => row.join('|'));
    expect(flat.some((row) => row.includes('vessel|custom-field'))).toBe(true);
    expect(flat.some((row) => row.includes('176000 lb'))).toBe(true);
    expect(flat.some((row) => row.includes('scheduleB|manual'))).toBe(true);
  });

  it('records the validation result at the moment of export', () => {
    const checks = workbook.sheets.find((sheet) => sheet.name === 'Checks')!;
    const flat = checks.rows.map((row) => row.join('|'));
    expect(flat.some((row) => row.startsWith('Errors|0'))).toBe(true);
    expect(flat.some((row) => row.includes('Destination'))).toBe(true);
  });

  it('can be left out', () => {
    const lean = buildAceWorkbook(mapping.shipment, mapping.origins, { weightUom: 'kg', includeAuditSheet: false });
    expect(readWorkbookBytes(lean, 'x.xlsx').sheetNames).toEqual(['Shipment']);
  });
});

describe('file names', () => {
  it('expands the configured pattern', () => {
    expect(
      aceFileName('ACE_Invoice_{refNumber}.xlsx', { refNumber: 'CN-1042', txnId: 'A', date: '2026-09-21', customer: 'X' }),
    ).toBe('ACE_Invoice_CN-1042.xlsx');
    expect(
      aceFileName('{date}-{customer}.xlsx', {
        refNumber: '',
        txnId: '',
        date: '2026-09-21',
        customer: 'Aydin Kuruyemis San Ve Tic A.S',
      }),
    ).toBe('2026-09-21-Aydin-Kuruyemis-San-Ve-Tic-A.S.xlsx');
  });

  it('strips characters a Windows path will not take', () => {
    expect(sanitizeFileNamePart('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(sanitizeFileNamePart('  ..trailing.. ')).toBe('trailing');
  });

  it('always ends in .xlsx', () => {
    expect(aceFileName('report', { refNumber: '', txnId: '', date: '', customer: '' })).toBe('report.xlsx');
  });
});

describe('writing to disk', () => {
  it('writes the workbook and reports where', () => {
    const directory = scratch();
    const mapping = mappingFor('invoice-single-line.xml');
    const result = writeAceWorkbook(mapping, {
      directory,
      fileNameOrPattern: 'ACE_Invoice_{refNumber}.xlsx',
      weightUom: 'kg',
      includeAuditSheet: true,
      validation: validateShipment(mapping.shipment),
    });

    expect(result.fileName).toBe('ACE_Invoice_CN-1042.xlsx');
    expect(result.path).toBe(join(directory, 'ACE_Invoice_CN-1042.xlsx'));
    expect(result.bytes).toBeGreaterThan(0);
    expect(readFileSync(result.path).byteLength).toBe(result.bytes);
  });

  it('refuses to overwrite a file unless told to', () => {
    const directory = scratch();
    const mapping = mappingFor('invoice-single-line.xml');
    writeFileSync(join(directory, 'ACE_Invoice_CN-1042.xlsx'), 'existing');

    const options = {
      directory,
      fileNameOrPattern: 'ACE_Invoice_{refNumber}.xlsx',
      weightUom: 'kg' as const,
      includeAuditSheet: false,
    };
    expect(() => writeAceWorkbook(mapping, options)).toThrow(ExportError);
    expect(() => writeAceWorkbook(mapping, { ...options, failIfExists: false })).not.toThrow();
  });
});
