/**
 * Preview building (the review gate) and settings handling.
 */

import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readWorkbookBytes, sheetByName } from '../src/excel/excelReader.js';
import { mapSheetToCanonical } from '../src/excel/canonicalMapper.js';
import { validateShipment } from '../src/excel/validator.js';
import { buildPreview, summarize } from '../src/ui/preview.js';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/core/settings.js';

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
  'InvoiceNumber',
  'InvoiceDate',
  'CustomerName',
  'Destination',
];

function importRows(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Shipment');
  const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  const sheet = sheetByName(readWorkbookBytes(bytes, 'test.xlsx'), undefined);
  const { shipment } = mapSheetToCanonical(sheet, { fileName: 'test.xlsx' });
  return { shipment, validation: validateShipment(shipment) };
}

const GOOD_ROW = [
  1, '0802.12.0000', 'SHELLED ALMONDS', 79833, 'KG', 'D', 633600, 176000, 'lb', 'C33',
  'INV-20451', '2026-03-12', 'MEDITERRANEAN FOODS LTD', 'IL',
];

describe('buildPreview', () => {
  it('maps an Excel row to an ACE commodity line, green when clean', () => {
    const { shipment, validation } = importRows([HEADERS, GOOD_ROW]);
    const preview = buildPreview(shipment, validation);

    expect(preview.commodities).toHaveLength(1);
    const line = preview.commodities[0];
    expect(line?.line).toBe(1);

    const scheduleB = line?.cells.find((cell) => cell.field === 'scheduleB');
    expect(scheduleB).toMatchObject({ aceValue: '0802.12.0000', status: 'green' });

    const description = line?.cells.find((cell) => cell.field === 'description');
    expect(description).toMatchObject({ aceValue: 'SHELLED ALMONDS', status: 'green' });
  });

  it('formats numbers for reading and shows the ACE unit', () => {
    const { shipment, validation } = importRows([HEADERS, GOOD_ROW]);
    const cells = buildPreview(shipment, validation).commodities[0]?.cells ?? [];

    expect(cells.find((cell) => cell.field === 'quantity1')?.aceValue).toBe('79,833');
    expect(cells.find((cell) => cell.field === 'valueOfGoods')?.aceValue).toBe('633,600.00');
    expect(cells.find((cell) => cell.field === 'shippingWeight')?.aceValue).toBe('79,832 kg');
  });

  it('marks a transformed value yellow and keeps the original beside it', () => {
    const { shipment, validation } = importRows([HEADERS, GOOD_ROW]);
    const weight = buildPreview(shipment, validation).commodities[0]?.cells.find((cell) => cell.field === 'shippingWeight');

    expect(weight?.status).toBe('yellow');
    expect(weight?.original).toBe('176000');
    expect(weight?.transform).toBe('lb x 0.45359237');
  });

  it('marks an invalid value red with the reason', () => {
    const bad = [...GOOD_ROW];
    bad[HEADERS.indexOf('ScheduleB')] = '080212';
    const { shipment, validation } = importRows([HEADERS, bad]);
    const cell = buildPreview(shipment, validation).commodities[0]?.cells.find((item) => item.field === 'scheduleB');

    expect(cell?.status).toBe('red');
    expect(cell?.messages.join(' ')).toMatch(/requires 10/);
  });

  it('marks a missing required value red at line level', () => {
    const bad = [...GOOD_ROW];
    bad[HEADERS.indexOf('ValueOfGoods')] = '';
    const { shipment, validation } = importRows([HEADERS, bad]);
    const preview = buildPreview(shipment, validation);

    expect(preview.commodities[0]?.status).toBe('red');
    expect(preview.status).toBe('red');
  });

  it('previews the shipment header with a date formatted for ACE', () => {
    const { shipment, validation } = importRows([HEADERS, GOOD_ROW]);
    const preview = buildPreview(shipment, validation);

    expect(preview.invoiceCells.find((cell) => cell.field === 'invoiceNumber')?.aceValue).toBe('INV-20451');
    expect(preview.invoiceCells.find((cell) => cell.field === 'invoiceDate')?.aceValue).toBe('03/12/2026');
  });

  it('rolls the worst status up to the shipment', () => {
    const { shipment, validation } = importRows([HEADERS, GOOD_ROW]);
    expect(buildPreview(shipment, validation).status).toBe('yellow'); // lb -> kg conversion
  });

  it('summarizes counts for the status bar', () => {
    const { validation } = importRows([HEADERS, GOOD_ROW]);
    expect(summarize(validation, 1)).toMatch(/^1 line/);
    expect(summarize({ issues: [], errors: 0, warnings: 0, linesWithErrors: [] }, 3)).toBe('3 lines - no issues');
  });
});

describe('settings', () => {
  it('falls back to the defaults for anything missing or malformed', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({ debugMode: 'yes' })).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and clamps decimals to a sane range', () => {
    const merged = mergeSettings({ weightDecimals: 99, valueDecimals: -3, debugMode: true });
    expect(merged.weightDecimals).toBe(6);
    expect(merged.valueDecimals).toBe(0);
    expect(merged.debugMode).toBe(true);
  });

  it('caps the highlight duration', () => {
    expect(mergeSettings({ highlightDurationMs: 999999 }).highlightDurationMs).toBe(60000);
  });

  it('has debug mode off by default', () => {
    expect(DEFAULT_SETTINGS.debugMode).toBe(false);
  });

  it('drops unknown keys', () => {
    const merged = mergeSettings({ debugMode: true, somethingElse: 'x' } as unknown);
    expect('somethingElse' in merged).toBe(false);
  });
});
