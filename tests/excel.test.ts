import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { ExcelReadError, readWorkbookBytes, sheetByName } from '../src/excel/excelReader.js';
import { detectHeaderRow, mapSheetToCanonical, MappingError } from '../src/excel/canonicalMapper.js';
import { validateShipment } from '../src/excel/validator.js';
import { specForHeader, TEMPLATE_COLUMNS } from '../src/excel/columnAliases.js';
import type { RawCell } from '../src/excel/excelReader.js';

/** Build an .xlsx in memory so the tests exercise the real parser. */
function workbookBytes(rows: unknown[][], sheetName = 'Shipment'): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

const HEADERS = [
  'Line',
  'ScheduleB',
  'CommodityDescription',
  'Quantity1',
  'UOM1',
  'Origin',
  'ValueOfGoods',
  'ShippingWeight',
  'ShippingWeightUOM',
  'LicenseCode',
  'CustomerName',
  'InvoiceNumber',
  'InvoiceDate',
  'Destination',
];

const ROW_1 = [
  1,
  '0802.12.0000',
  'SHELLED ALMONDS',
  79833,
  'KG',
  'D',
  633600,
  176000,
  'lb',
  'C33',
  'MEDITERRANEAN FOODS LTD',
  'INV-20451',
  '2026-03-12',
  'IL',
];

const ROW_2 = [2, '0813.20.0000', 'DRIED PRUNES', 12400, 'KG', 'D', 48360, 12850, 'kg', 'C33', '', '', '', ''];

function importRows(rows: unknown[][], sheetName = 'Shipment') {
  const workbook = readWorkbookBytes(workbookBytes(rows, sheetName), 'test.xlsx');
  const sheet = sheetByName(workbook, undefined);
  return mapSheetToCanonical(sheet, { fileName: 'test.xlsx' });
}

describe('excelReader', () => {
  it('reads a valid workbook as arrays of arrays', () => {
    const workbook = readWorkbookBytes(workbookBytes([HEADERS, ROW_1]), 'test.xlsx');
    expect(workbook.sheetNames).toEqual(['Shipment']);
    const sheet = sheetByName(workbook, 'Shipment');
    expect(Array.isArray(sheet.rows[0])).toBe(true);
    expect(sheet.rows[0]?.[1]).toBe('ScheduleB');
  });

  it('rejects empty and non-spreadsheet input', () => {
    expect(() => readWorkbookBytes(new Uint8Array(0), 'test.xlsx')).toThrow(ExcelReadError);
    expect(() => readWorkbookBytes(new Uint8Array([1, 2, 3, 4]), 'test.xlsx')).toThrow(ExcelReadError);
  });

  it('does not build objects from sheet-controlled keys', () => {
    // A "__proto__" header must not reach Object.prototype: rows are arrays.
    const workbook = readWorkbookBytes(workbookBytes([['__proto__', 'ScheduleB'], ['polluted', '0802120000']]), 'evil.xlsx');
    const sheet = sheetByName(workbook, undefined);
    expect(Array.isArray(sheet.rows[1])).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('names a missing sheet in the error', () => {
    const workbook = readWorkbookBytes(workbookBytes([HEADERS]), 'test.xlsx');
    expect(() => sheetByName(workbook, 'Nope')).toThrow(/Nope/);
  });
});

describe('column aliases', () => {
  it('resolves every template column', () => {
    for (const column of TEMPLATE_COLUMNS) {
      expect(specForHeader(column), column).toBeDefined();
    }
  });

  it('keeps the template generator on the same column list', () => {
    // scripts/generate-template.mjs cannot import TypeScript, so it carries
    // its own copy of the column list. This is what stops the two drifting.
    const script = readFileSync(join(__dirname, '..', 'scripts', 'generate-template.mjs'), 'utf8');
    const match = /const COLUMNS = \[([^\]]+)\]/.exec(script);
    const generated = (match?.[1] ?? '').match(/'([A-Za-z0-9]+)'/g)?.map((name) => name.replace(/'/g, '')) ?? [];
    expect(generated).toEqual([...TEMPLATE_COLUMNS]);
  });

  it('accepts the split consignee address columns and the live ACE wordings', () => {
    expect(specForHeader('Address Line 1')?.column).toBe('BillTo');
    expect(specForHeader('Address Line 2')?.column).toBe('BillToAddress2');
    expect(specForHeader('City')?.column).toBe('BillToCity');
    expect(specForHeader('Postal Code')?.column).toBe('BillToPostalCode');
    expect(specForHeader('Consignee Country')?.column).toBe('BillToCountry');
    expect(specForHeader('Departure Date')?.column).toBe('InvoiceDate');
  });

  it('matches aliases case- and punctuation-insensitively', () => {
    expect(specForHeader('schedule b')?.column).toBe('ScheduleB');
    expect(specForHeader('HTS Number')?.column).toBe('ScheduleB');
    expect(specForHeader('Qty 1')?.column).toBe('Quantity1');
    expect(specForHeader('Ultimate Consignee')?.column).toBe('CustomerName');
    expect(specForHeader('Gross Weight')?.column).toBe('ShippingWeight');
    expect(specForHeader('something else')).toBeUndefined();
  });
});

describe('header detection', () => {
  it('finds the header row under a title row', () => {
    const rows: RawCell[][] = [
      ['Packing list for INV-20451', null],
      [],
      HEADERS as RawCell[],
      ROW_1 as RawCell[],
    ];
    const header = detectHeaderRow(rows);
    expect(header.headerRowIndex).toBe(2);
    expect(header.byIndex.size).toBeGreaterThan(5);
  });

  it('throws when no headers are recognisable', () => {
    expect(() => detectHeaderRow([['a', 'b'], ['c', 'd']])).toThrow(MappingError);
  });

  it('lists unrecognised headers instead of failing', () => {
    const header = detectHeaderRow([['ScheduleB', 'Quantity1', 'MysteryColumn']]);
    expect(header.unknownHeaders).toEqual(['MysteryColumn']);
  });
});

describe('canonical mapping', () => {
  it('maps a valid workbook into the canonical model', () => {
    const { shipment } = importRows([HEADERS, ROW_1]);

    expect(shipment.commodities).toHaveLength(1);
    expect(shipment.commodities[0]).toMatchObject({
      line: 1,
      scheduleB: '0802.12.0000',
      description: 'SHELLED ALMONDS',
      quantity1: 79833,
      uom1: 'KG',
      origin: 'D',
      valueOfGoods: 633600,
      licenseCode: 'C33',
    });
    expect(shipment.invoice).toMatchObject({
      invoiceNumber: 'INV-20451',
      invoiceDate: '2026-03-12',
      customerName: 'MEDITERRANEAN FOODS LTD',
      destination: 'IL',
    });
  });

  it('converts pounds to kilograms and keeps the original', () => {
    const { shipment } = importRows([HEADERS, ROW_1]);
    expect(shipment.commodities[0]?.shippingWeight).toBe(79832);

    const provenance = shipment.provenance.commodities[1]?.shippingWeight;
    expect(provenance?.original).toBe('176000');
    expect(provenance?.transform).toBe('lb x 0.45359237');
    expect(provenance?.normalized).toBe('79,832 kg');
  });

  it('reads the weight unit from the cell itself', () => {
    const headers = HEADERS.filter((header) => header !== 'ShippingWeightUOM');
    const row = ROW_1.filter((_, index) => index !== HEADERS.indexOf('ShippingWeightUOM'));
    row[headers.indexOf('ShippingWeight')] = '176,000 lb';

    const { shipment } = importRows([headers, row]);
    expect(shipment.commodities[0]?.shippingWeight).toBe(79832);
  });

  it('handles multiple rows and carries the header down', () => {
    const { shipment } = importRows([HEADERS, ROW_1, ROW_2]);
    expect(shipment.commodities.map((commodity) => commodity.line)).toEqual([1, 2]);
    expect(shipment.commodities[1]?.description).toBe('DRIED PRUNES');
    // Shipment-level values are taken from the first row that carries them.
    expect(shipment.invoice.invoiceNumber).toBe('INV-20451');
  });

  it('numbers lines sequentially when the Line column is absent', () => {
    const headers = HEADERS.slice(1);
    const { shipment } = importRows([headers, ROW_1.slice(1), ROW_2.slice(1)]);
    expect(shipment.commodities.map((commodity) => commodity.line)).toEqual([1, 2]);
  });

  it('tolerates blank cells and blank rows', () => {
    const sparse = [3, '0802.12.0000', 'SHELLED ALMONDS', 500, 'KG', '', null, null, '', '', '', '', '', ''];
    const { shipment, notes } = importRows([HEADERS, ROW_1, [], sparse]);

    expect(shipment.commodities).toHaveLength(2);
    expect(shipment.commodities[1]).toMatchObject({ line: 3, origin: '', valueOfGoods: null, shippingWeight: null });
    expect(notes.some((note) => note.severity === 'error')).toBe(false);
  });

  it('reports invalid data per cell instead of failing the import', () => {
    const bad = [...ROW_1];
    bad[HEADERS.indexOf('ValueOfGoods')] = 'ask accounting';
    bad[HEADERS.indexOf('InvoiceDate')] = 'someday';

    const { shipment, notes } = importRows([HEADERS, bad]);
    expect(shipment.commodities[0]?.valueOfGoods).toBeNull();
    expect(shipment.invoice.invoiceDate).toBe('');

    const messages = notes.filter((note) => note.severity === 'error').map((note) => note.message);
    expect(messages.join(' ')).toMatch(/not a monetary value/i);
    expect(messages.join(' ')).toMatch(/date/i);
  });

  it('warns when a shipment-level column disagrees between rows', () => {
    const second = [...ROW_2];
    second[HEADERS.indexOf('InvoiceNumber')] = 'INV-99999';

    const { shipment, notes } = importRows([HEADERS, ROW_1, second]);
    expect(shipment.invoice.invoiceNumber).toBe('INV-20451');
    expect(notes.some((note) => note.message.includes('differs between rows'))).toBe(true);
  });

  it('flags duplicate line numbers', () => {
    const duplicate = [...ROW_2];
    duplicate[0] = 1;
    const { notes } = importRows([HEADERS, ROW_1, duplicate]);
    expect(notes.some((note) => note.severity === 'error' && note.message.includes('Duplicate line'))).toBe(true);
  });

  it('throws when the sheet has headers but no data rows', () => {
    expect(() => importRows([HEADERS])).toThrow(MappingError);
  });

  it('imports a sheet that is missing optional columns', () => {
    const headers = ['ScheduleB', 'CommodityDescription', 'Quantity1', 'UOM1'];
    const { shipment } = importRows([headers, ['0802120000', 'SHELLED ALMONDS', 79833, 'kg']]);
    expect(shipment.commodities[0]).toMatchObject({ scheduleB: '0802.12.0000', uom1: 'KG', valueOfGoods: null });
    expect(shipment.invoice.invoiceNumber).toBe('');
  });
});

describe('validation', () => {
  it('passes a complete line with no errors', () => {
    const { shipment } = importRows([HEADERS, ROW_1]);
    const result = validateShipment(shipment);
    expect(result.errors).toBe(0);
    expect(result.linesWithErrors).toEqual([]);
  });

  it('reports missing required commodity fields as errors', () => {
    const headers = ['ScheduleB', 'CommodityDescription', 'Quantity1', 'UOM1'];
    const { shipment } = importRows([headers, ['0802120000', 'SHELLED ALMONDS', 79833, 'kg']]);
    const result = validateShipment(shipment);

    const fields = result.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.field);
    expect(fields).toContain('valueOfGoods');
    expect(fields).toContain('shippingWeight');
    expect(result.linesWithErrors).toEqual([1]);
  });

  it('rejects a Schedule B number that is not 10 digits', () => {
    const bad = [...ROW_1];
    bad[HEADERS.indexOf('ScheduleB')] = '080212';
    const { shipment } = importRows([HEADERS, bad]);
    const result = validateShipment(shipment);
    expect(result.issues.some((issue) => issue.field === 'scheduleB' && issue.severity === 'error')).toBe(true);
  });

  it('warns about a non-positive quantity and a missing licence code', () => {
    const bad = [...ROW_1];
    bad[HEADERS.indexOf('Quantity1')] = 0;
    bad[HEADERS.indexOf('LicenseCode')] = '';
    const { shipment } = importRows([HEADERS, bad]);
    const result = validateShipment(shipment);

    expect(result.issues.some((issue) => issue.field === 'quantity1' && issue.severity === 'error')).toBe(true);
    expect(result.issues.some((issue) => issue.field === 'licenseCode' && issue.severity === 'warning')).toBe(true);
  });

  it('warns when a description will be truncated by ACE', () => {
    const long = [...ROW_1];
    long[HEADERS.indexOf('CommodityDescription')] = 'A'.repeat(60);
    const { shipment } = importRows([HEADERS, long]);
    const result = validateShipment(shipment);
    expect(result.issues.some((issue) => issue.field === 'description' && /truncated/.test(issue.message))).toBe(true);
  });

  it('warns about a container number that is not ISO 6346', () => {
    const headers = [...HEADERS, 'ContainerNumber'];
    const row = [...ROW_1, 'BADCONTAINER'];
    const { shipment } = importRows([headers, row]);
    const result = validateShipment(shipment);
    expect(result.issues.some((issue) => issue.field === 'containerNumber')).toBe(true);
  });
});
