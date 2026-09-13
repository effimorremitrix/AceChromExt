/**
 * Phase 1 must still work, on its own.
 *
 * Phase 3 is additive. The promise it has to keep is that the original
 * workflow - a spreadsheet, the Chrome extension, and nothing else - behaves
 * exactly as it did before any of it existed:
 *
 *   1. load an ACE-compatible Excel file
 *   2. preview the imported data
 *   3. Fill Current ACE Page
 *   4. Fill Current Commodity Line
 *   5. the F2 calculator overlay
 *   6. the existing mappings, transformations, validation and diagnostics
 *
 * with no QuickBooks, no companion, no server, and no configuration. Every
 * test in this file therefore starts from a workbook built here with SheetJS -
 * nothing from `companion/` is imported - and runs against empty storage, so a
 * profile that has never seen a selector override behaves like Phase 1 did.
 *
 * If a future change makes the extension depend on QuickBooks or on a server,
 * this file is what fails.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { readWorkbookBytes, sheetByName } from '../src/excel/excelReader.js';
import { mapSheetToCanonical } from '../src/excel/canonicalMapper.js';
import { validateShipment } from '../src/excel/validator.js';
import { TEMPLATE_COLUMNS } from '../src/excel/columnAliases.js';
import { createExcelImporter } from '../src/ui/importer.js';
import { loadFromBytes, sourceForWorkbook } from '../src/sources/index.js';
import { buildPreview, summarize } from '../src/ui/preview.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { detectPage } from '../src/content/pageDetector.js';
import { detectFields } from '../src/content/fieldDetector.js';
import { fillFields } from '../src/content/filler.js';
import { fieldsForPage, resolveFields } from '../src/ace/mappings/index.js';
import { AUTOMATION_POLICY } from '../src/content/automationPolicy.js';
import { calculate } from '../src/calculator/calculator.js';
import { closeCalculator, configureCalculator, isCalculatorOpen, isCalculatorTarget, openCalculator } from '../src/calculator/calculatorUI.js';

const FIXTURES = join(__dirname, 'fixtures');

function html(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.html`), 'utf8');
}

/**
 * A hand-filled workbook, exactly as an operator would produce it from
 * templates/ACE_Import_Template.xlsx. One row per ACE commodity line, with the
 * shipment columns on the first row only.
 */
function handBuiltWorkbook(): { bytes: Uint8Array; fileName: string } {
  const rows: Array<Array<string | number>> = [TEMPLATE_COLUMNS];
  const header = (value: string | number): string | number => value;

  rows.push([
    1,
    'OS',
    '0802.12.0000',
    'SHELLED ALMONDS',
    79832,
    'KG',
    '',
    '',
    'D',
    651217.6,
    176000,
    'lb',
    'EAR99',
    'C33',
    header('Aydin Kuruyemis San Ve Tic A.S'),
    header('CN-1042'),
    header('2026-09-21'),
    header('Organize Sanayi Bolgesi 3. Cadde No 14, Aydin'),
    header('CIF'),
    header('NET 120'),
    header('2027-01-19'),
    header('3993'),
    header('MSC Line'),
    header('MSC FIRENZE V.541W'),
    header('EBKG18531408'),
    header('MSCU1234567'),
    header('SL-4471209'),
    header('TR'),
  ]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Shipment');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return { bytes: new Uint8Array(bytes), fileName: 'My ACE Shipment.xlsx' };
}

describe('1. loading an ACE-compatible Excel file', () => {
  const { bytes, fileName } = handBuiltWorkbook();

  it('reads the workbook with the Phase 1 reader', () => {
    const workbook = readWorkbookBytes(bytes, fileName);
    expect(workbook.sheetNames).toEqual(['Shipment']);
  });

  it('maps it to the canonical model with the Phase 1 mapper', () => {
    const { shipment } = mapSheetToCanonical(sheetByName(readWorkbookBytes(bytes, fileName), undefined), {
      fileName,
      settings: DEFAULT_SETTINGS,
    });
    expect(shipment.invoice.invoiceNumber).toBe('CN-1042');
    expect(shipment.commodities).toHaveLength(1);
    expect(shipment.commodities[0]?.scheduleB).toBe('0802.12.0000');
  });

  it('is claimed by ExcelSource, not by the QuickBooks source', () => {
    const workbook = readWorkbookBytes(bytes, fileName);
    expect(sourceForWorkbook(workbook).id).toBe('excel');
  });

  it('converts the pounds column exactly as Phase 1 did', () => {
    const loaded = loadFromBytes(bytes, fileName, { settings: DEFAULT_SETTINGS });
    expect(loaded.shipment.commodities[0]?.shippingWeight).toBe(79832);
    const record = loaded.shipment.provenance.commodities[1]?.['shippingWeight'];
    expect(record?.original).toContain('176000');
    expect(record?.transform).toContain('0.45359237');
  });

  it('goes through the panel importer with no QuickBooks and no server', async () => {
    const importer = createExcelImporter();
    // The same object an <input type="file"> hands the panel. jsdom's File
    // predates Blob.arrayBuffer, which Chrome has had since 76, so it is
    // supplied here rather than worked around in the product.
    const file = new File([bytes as unknown as BlobPart], fileName, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    if (typeof file.arrayBuffer !== 'function') {
      Object.defineProperty(file, 'arrayBuffer', {
        value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      });
    }

    const opened = await importer.openFile(file);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.source.id).toBe('excel');

    const imported = importer.importSheet('Shipment', DEFAULT_SETTINGS);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.shipment.invoice.customerName).toBe('Aydin Kuruyemis San Ve Tic A.S');
    expect(imported.value.selectedLine).toBe(1);
  });
});

describe('2. previewing the imported data', () => {
  const { bytes, fileName } = handBuiltWorkbook();
  const loaded = loadFromBytes(bytes, fileName, { settings: DEFAULT_SETTINGS });

  it('builds the traffic-light preview', () => {
    const preview = buildPreview(loaded.shipment, loaded.validation);
    expect(preview.commodities).toHaveLength(1);
    const weight = preview.commodities[0]?.cells.find((cell) => cell.field === 'shippingWeight');
    expect(weight?.aceValue).toBe('79,832 kg');
    expect(weight?.original).toContain('176000');
  });

  it('summarises validation the way the panel does', () => {
    expect(summarize(loaded.validation, loaded.shipment.commodities.length)).toContain('1 line');
  });

  it('reports no blocking validation error for a well-formed sheet', () => {
    expect(validateShipment(loaded.shipment).errors).toBe(0);
  });
});

describe('3. Fill Current ACE Page', () => {
  const { bytes, fileName } = handBuiltWorkbook();
  const loaded = loadFromBytes(bytes, fileName, { settings: DEFAULT_SETTINGS });

  beforeEach(() => {
    document.body.innerHTML = html('ace-shipment');
  });

  it('detects the Shipment step', () => {
    expect(detectPage(document).page).toBe('shipment');
  });

  it('fills the shipment-level fields', () => {
    const report = fillFields(
      { shipment: loaded.shipment, page: 'shipment', scope: 'shipment', settings: DEFAULT_SETTINGS },
      document,
    );
    expect(report.errors).toBe(0);
    expect((document.getElementById('shipmentReferenceNumber') as HTMLInputElement).value).toBe('CN-1042');
    expect((document.getElementById('poNumber') as HTMLInputElement).value).toBe('3993');
    expect((document.getElementById('inCoTerms') as HTMLSelectElement).value).toBe('CIF');
  });

  it('works with no selector overrides configured', () => {
    // resolveFields(..., null) is the path a fresh profile takes. It must
    // return exactly the built-in mappings.
    expect(resolveFields('shipment', 'shipment', null)).toEqual(fieldsForPage('shipment', 'shipment'));
  });
});

describe('4. Fill Current Commodity Line', () => {
  const { bytes, fileName } = handBuiltWorkbook();
  const loaded = loadFromBytes(bytes, fileName, { settings: DEFAULT_SETTINGS });

  beforeEach(() => {
    document.body.innerHTML = html('ace-commodities');
  });

  it('fills one commodity line, scoped to the open Line Details form', () => {
    const report = fillFields(
      { shipment: loaded.shipment, page: 'commodities', scope: 'commodityLine', line: 1, settings: DEFAULT_SETTINGS },
      document,
    );
    expect(report.errors).toBe(0);
    expect((document.getElementById('scheduleBNumber') as HTMLInputElement).value).toBe('0802.12.0000');
    expect((document.getElementById('quantity1') as HTMLInputElement).value).toBe('79832');
    expect((document.getElementById('valueOfGoods') as HTMLInputElement).value).toBe('651217.60');
    expect((document.getElementById('licenseCode') as HTMLSelectElement).value).toBe('C33');
  });

  it('leaves ACE controls unpressed', () => {
    let clicked = false;
    document.getElementById('saveLine')?.addEventListener('click', () => {
      clicked = true;
    });
    fillFields(
      { shipment: loaded.shipment, page: 'commodities', scope: 'commodityLine', line: 1, settings: DEFAULT_SETTINGS },
      document,
    );
    expect(clicked).toBe(false);
    expect(AUTOMATION_POLICY.clickSaveLine).toBe(false);
    expect(AUTOMATION_POLICY.clickAddLine).toBe(false);
    expect(AUTOMATION_POLICY.submitFiling).toBe(false);
  });
});

describe('5. the F2 calculator, independent of everything else', () => {
  beforeEach(() => {
    document.body.innerHTML = '<label for="valueOfGoods">Value of Goods</label><input id="valueOfGoods" type="text" />';
    configureCalculator({ rounding: () => DEFAULT_SETTINGS.rounding, dispatchBlur: true });
  });

  it('evaluates without any import, source, server or configuration', () => {
    const result = calculate('20 * 4', DEFAULT_SETTINGS.rounding);
    expect(result.ok && result.insert).toBe('80');
  });

  it('does the weight conversion an operator actually types', () => {
    const result = calculate('176000 * 0.45359237', { mode: 'integer', decimals: 0 });
    expect(result.ok && result.insert).toBe('79832');
  });

  it('opens on a numeric field with nothing imported', () => {
    const target = document.getElementById('valueOfGoods') as HTMLInputElement;
    expect(isCalculatorTarget(target)).toBe(true);
    openCalculator(target);
    expect(isCalculatorOpen()).toBe(true);
    closeCalculator();
    expect(isCalculatorOpen()).toBe(false);
  });

  it('does not interfere with a fill: the overlay is not a mapped ACE field', () => {
    const target = document.getElementById('valueOfGoods') as HTMLInputElement;
    openCalculator(target);
    const host = document.querySelector('#ace-helper-calculator-host');
    expect(host).not.toBeNull();
    // The overlay lives in a shadow root, so ACE's own DOM - and therefore
    // field detection - cannot see inside it.
    expect((host as HTMLElement).shadowRoot).not.toBeNull();
    closeCalculator();
  });
});

describe('6. mappings, transformations, validation and diagnostics are unchanged', () => {
  beforeEach(() => {
    document.body.innerHTML = html('ace-commodities');
  });

  it('keeps the same field keys on every page', () => {
    expect(fieldsForPage('shipment').map((field) => field.key)).toEqual([
      'ShipmentReferenceNumber',
      'InvoiceDate',
      'PONumber',
      'Destination',
      'FreightTerms',
    ]);
    expect(fieldsForPage('commodities').map((field) => field.key)).toEqual([
      'ExportInformationCode',
      'ScheduleB',
      'CommodityDescription',
      'Quantity1',
      'UOM1',
      'Quantity2',
      'UOM2',
      'Origin',
      'ValueOfGoods',
      'ShippingWeight',
      'ECCN',
      'LicenseCode',
    ]);
    expect(fieldsForPage('parties').map((field) => field.key)).toEqual([
      'UltimateConsigneeName',
      'UltimateConsigneeAddress',
    ]);
    expect(fieldsForPage('transportation').map((field) => field.key)).toEqual([
      'Carrier',
      'Vessel',
      'BookingNumber',
      'ContainerNumber',
      'SealNumber',
    ]);
  });

  it('still carries a devtools hint on every field', () => {
    for (const field of fieldsForPage('commodities')) {
      expect(field.devtoolsHint, field.key).toBeTruthy();
      expect(field.candidates.length, field.key).toBeGreaterThan(0);
    }
  });

  it('detects every commodity field on the mock ACE page', () => {
    const detections = detectFields(fieldsForPage('commodities'), { root: document });
    expect(detections.filter((detection) => detection.status !== 'FOUND')).toEqual([]);
  });
});

describe('the extension stands alone', () => {
  const SRC = join(__dirname, '..', 'src');

  function walk(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) found.push(...walk(path));
      else if (path.endsWith('.ts')) found.push(path);
    }
    return found;
  }

  const sources = walk(SRC).map((path) => ({ path: path.replace(`${SRC}/`, ''), code: readFileSync(path, 'utf8') }));

  it('imports nothing from the QuickBooks companion', () => {
    for (const { path, code } of sources) {
      expect(code, path).not.toMatch(/from\s+['"][^'"]*companion/);
    }
  });

  it('has no source that talks to a server', () => {
    for (const { path, code } of sources) {
      expect(code, path).not.toMatch(/\bfetch\s*\(/);
      expect(code, path).not.toMatch(/XMLHttpRequest/);
    }
  });

  it('declares the web source as unavailable rather than pretending it works', async () => {
    const { WebSource } = await import('../src/sources/WebSource.js');
    const web = new WebSource();
    expect(web.available).toBe(false);
    expect(() => web.load(undefined as never, { settings: DEFAULT_SETTINGS })).toThrow(/no network permission/);
  });

  it('reads a workbook with chrome.storage entirely absent', () => {
    const saved = (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { chrome?: unknown }).chrome;
    try {
      const { bytes, fileName } = handBuiltWorkbook();
      const loaded = loadFromBytes(bytes, fileName, { settings: DEFAULT_SETTINGS });
      expect(loaded.shipment.commodities).toHaveLength(1);
    } finally {
      if (saved !== undefined) (globalThis as { chrome?: unknown }).chrome = saved;
    }
  });
});

// Keep vitest from complaining about an unused import in a file that is all
// about imports staying where they are.
void vi;
