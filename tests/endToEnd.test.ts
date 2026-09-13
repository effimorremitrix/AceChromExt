/**
 * The whole workflow, in one test.
 *
 *   QuickBooks fixture (qbXML)
 *     -> QuickBooksDesktopAdapter
 *       -> canonical shipment
 *         -> ACE_Invoice_CN-1042.xlsx  (real bytes, written to disk)
 *           -> the extension's own reader and source registry
 *             -> canonical shipment  (asserted identical)
 *               -> preview + data quality checks
 *                 -> mock ACE DOM
 *                   -> fillFields
 *                     -> assert the ACE inputs hold the expected values
 *
 * The fixture is the real one this project is built around:
 *
 *   Customer   Aydin Kuruyemis San Ve Tic A.S
 *   Commodity  Shelled Almonds
 *   Pounds     176,000
 *   Amount     651,217.60
 *
 * Nothing is stubbed between the ends: the workbook is genuinely written and
 * genuinely re-read. If QuickBooks and the extension ever disagree about what
 * a canonical shipment is, this test is what notices.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { QuickBooksDesktopAdapter } from '../companion/src/adapter/QuickBooksDesktopAdapter.js';
import { FileQbxmlTransport } from '../companion/src/transport/FileTransport.js';
import { normalizeConfig, starterConfig } from '../companion/src/config.js';
import { aceReadiness } from '../companion/src/ui/preview.js';

import { loadFromBytes, sourceForWorkbook } from '../src/sources/index.js';
import { readWorkbookBytes } from '../src/excel/excelReader.js';
import { ExcelSource } from '../src/sources/ExcelSource.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { buildPreview } from '../src/ui/preview.js';
import { buildPreflight } from '../src/ui/preflight.js';
import { applyFillReport, buildMappingStatus } from '../src/ui/mappingStatus.js';
import { detectPage } from '../src/content/pageDetector.js';
import { fillFields } from '../src/content/filler.js';
import type { CanonicalShipment } from '../src/models/CanonicalInvoice.js';

const FIXTURES = join(__dirname, 'fixtures');
const scratchDirectories: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ace-e2e-'));
  scratchDirectories.push(directory);
  return directory;
}

afterAll(() => {
  while (scratchDirectories.length) {
    rmSync(scratchDirectories.pop() as string, { recursive: true, force: true });
  }
});

function html(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.html`), 'utf8');
}

/** Stage 1-3: QuickBooks invoice -> canonical -> a real .xlsx on disk. */
async function exportWorkbook(
  weightUom: 'kg' | 'lb' = 'kg',
): Promise<{ bytes: Uint8Array; fileName: string; shipment: CanonicalShipment }> {
  const transport = FileQbxmlTransport.fromFile(join(FIXTURES, 'qbxml', 'invoice-single-line.xml'));
  const base = starterConfig();
  base.output.weightUom = weightUom;
  const adapter = new QuickBooksDesktopAdapter(transport, normalizeConfig(base));

  const invoice = await adapter.getInvoice('CN-1042');
  const mapping = adapter.toCanonicalInvoice(invoice, {
    // The two facts QuickBooks does not hold for this shipment. Supplied the
    // way the export screen supplies them, so the audit trail records a human.
    overrides: { containerNumber: 'MSCU1234567', sealNumber: 'SL-4471209' },
    lineOverrides: {},
  });

  const validation = (await import('../src/excel/validator.js')).validateShipment(mapping.shipment);
  const directory = scratch();
  const result = await adapter.exportAceExcel({ mapping, validation, directory });
  await adapter.close();

  return {
    bytes: new Uint8Array(readFileSync(join(directory, result.fileName))),
    fileName: result.fileName,
    shipment: mapping.shipment,
  };
}

describe('end to end: QuickBooks invoice CN-1042 to a filled ACE form', () => {
  let exported: Awaited<ReturnType<typeof exportWorkbook>>;

  beforeEach(async () => {
    if (!exported) exported = await exportWorkbook();
  });

  it('names the workbook after the invoice', () => {
    expect(exported.fileName).toBe('ACE_Invoice_CN-1042.xlsx');
  });

  it('reads the QuickBooks invoice into the canonical model', () => {
    const { invoice, commodities } = exported.shipment;
    expect(invoice.invoiceNumber).toBe('CN-1042');
    expect(invoice.customerName).toBe('Aydin Kuruyemis San Ve Tic A.S');
    expect(invoice.invoiceDate).toBe('2026-09-21');
    expect(commodities).toHaveLength(1);

    const line = commodities[0]!;
    expect(line.description).toContain('Almond');
    expect(line.valueOfGoods).toBe(651217.6);
    // 176,000 lb x 0.45359237 = 79,832.256 -> 79,832 kg (whole kilograms).
    expect(line.shippingWeight).toBe(79832);
    expect(line.scheduleB).toBe('0802.12.0000');
  });

  it('records the pound-to-kilogram conversion in provenance', () => {
    const record = exported.shipment.provenance.commodities[1]?.['shippingWeight'];
    expect(record?.original).toContain('176000');
    expect(record?.transform).toContain('0.45359237');
  });

  it('reports ACE readiness per line before the workbook is written', () => {
    const readiness = aceReadiness({
      shipment: exported.shipment,
      origins: { invoice: {}, commodities: {} },
      notes: [],
      unmappedCustomFields: [],
    });
    expect(readiness).toHaveLength(1);
    const byField = new Map(readiness[0]!.items.map((item) => [item.field, item]));
    expect(byField.get('scheduleB')?.ok).toBe(true);
    expect(byField.get('origin')?.ok).toBe(true);
    expect(byField.get('licenseCode')?.ok).toBe(true);
    expect(byField.get('shippingWeight')?.ok).toBe(true);
    expect(readiness[0]!.ready).toBe(true);
  });

  it('is recognised by the extension as a QuickBooks export, not a hand-built sheet', () => {
    const workbook = readWorkbookBytes(exported.bytes, exported.fileName);
    const source = sourceForWorkbook(workbook);
    expect(source.id).toBe('quickbooks-export');
    expect(source.describe(workbook).detail).toContain('QuickBooks Desktop');
  });

  it('round-trips: the extension reads back the model QuickBooks produced', () => {
    const loaded = loadFromBytes(exported.bytes, exported.fileName, { settings: DEFAULT_SETTINGS });

    expect(loaded.shipment.invoice.invoiceNumber).toBe('CN-1042');
    expect(loaded.shipment.invoice.customerName).toBe('Aydin Kuruyemis San Ve Tic A.S');
    expect(loaded.shipment.invoice.containerNumber).toBe('MSCU1234567');
    expect(loaded.shipment.invoice.sealNumber).toBe('SL-4471209');

    const line = loaded.shipment.commodities[0]!;
    expect(line.scheduleB).toBe('0802.12.0000');
    expect(line.shippingWeight).toBe(79832);
    expect(line.valueOfGoods).toBe(651217.6);
    expect(line.uom1).toBe('KG');
    expect(line.origin).toBe('D');
    expect(line.licenseCode).toBe('C33');
  });

  it('produces the same canonical model whichever source reads the file', () => {
    // The QuickBooks label must be a label and nothing more: identify the file
    // differently, parse it identically.
    const workbook = readWorkbookBytes(exported.bytes, exported.fileName);
    const viaRegistry = loadFromBytes(exported.bytes, exported.fileName, { settings: DEFAULT_SETTINGS });
    const viaExcel = new ExcelSource().load(workbook, { settings: DEFAULT_SETTINGS });

    expect(viaExcel.shipment.invoice).toEqual(viaRegistry.shipment.invoice);
    expect(viaExcel.shipment.commodities).toEqual(viaRegistry.shipment.commodities);
    expect(viaExcel.validation).toEqual(viaRegistry.validation);
    expect(viaExcel.source.id).toBe('excel');
    expect(viaRegistry.source.id).toBe('quickbooks-export');
  });

  it('passes the data quality checks with no blocking issue', () => {
    const loaded = loadFromBytes(exported.bytes, exported.fileName, { settings: DEFAULT_SETTINGS });
    const check = buildPreflight(loaded.shipment, loaded.validation);
    expect(check.blocking).toEqual([]);
    expect(check.ready).toBe(true);
    expect(check.checks.find((item) => item.id === 'scheduleB')?.status).toBe('pass');
    expect(check.checks.find((item) => item.id === 'weights')?.status).toBe('pass');
  });

  it('previews the converted weight beside its original', () => {
    const loaded = loadFromBytes(exported.bytes, exported.fileName, { settings: DEFAULT_SETTINGS });
    const preview = buildPreview(loaded.shipment, loaded.validation);
    const weight = preview.commodities[0]?.cells.find((cell) => cell.field === 'shippingWeight');
    expect(weight?.aceValue).toBe('79,832 kg');
  });

  describe('into the ACE form', () => {
    beforeEach(() => {
      document.body.innerHTML = html('ace-commodities');
    });

    it('detects the Commodities step', () => {
      expect(detectPage(document).page).toBe('commodities');
    });

    it('fills the commodity line with the values that came from QuickBooks', () => {
      const loaded = loadFromBytes(exported.bytes, exported.fileName, { settings: DEFAULT_SETTINGS });
      const report = fillFields(
        {
          shipment: loaded.shipment,
          page: 'commodities',
          scope: 'commodityLine',
          line: 1,
          settings: DEFAULT_SETTINGS,
        },
        document,
      );

      expect(report.errors).toBe(0);
      const value = (id: string): string => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value;

      expect(value('scheduleBNumber')).toBe('0802.12.0000');
      expect(value('commodityDescription')).toContain('Almond');
      expect(value('quantity1')).toBe('79832');
      expect(value('unitOfMeasure1')).toBe('KG');
      expect(value('originOfGoods')).toBe('D');
      expect(value('valueOfGoods')).toBe('651217.60');
      expect(value('shippingWeight')).toBe('79832');
      expect(value('licenseCode')).toBe('C33');
      expect(value('exportInformationCode')).toBe('OS');
    });

    it('never presses Save Line', () => {
      const loaded = loadFromBytes(exported.bytes, exported.fileName, { settings: DEFAULT_SETTINGS });
      let clicked = false;
      const save = document.getElementById('saveLine') as HTMLButtonElement;
      save.addEventListener('click', () => {
        clicked = true;
      });

      fillFields(
        { shipment: loaded.shipment, page: 'commodities', scope: 'commodityLine', line: 1, settings: DEFAULT_SETTINGS },
        document,
      );

      expect(clicked).toBe(false);
    });

    it('reports the mapping status end to end, with selector and transformation', () => {
      const loaded = loadFromBytes(exported.bytes, exported.fileName, { settings: DEFAULT_SETTINGS });
      const rows = buildMappingStatus(loaded.shipment, {
        settings: DEFAULT_SETTINGS,
        line: 1,
        source: loaded.source,
      });

      const report = fillFields(
        {
          shipment: loaded.shipment,
          page: 'commodities',
          scope: 'commodityLine',
          line: 1,
          settings: DEFAULT_SETTINGS,
          dryRun: true,
        },
        document,
      );

      const resolved = applyFillReport(rows, report);
      const weight = resolved.find((row) => row.key === 'ShippingWeight');

      expect(weight?.source).toContain('QuickBooks export');
      expect(weight?.aceValue).toBe('79832');
      expect(weight?.aceField).toBe('Shipping Weight (kg)');
      expect(weight?.selector).toContain('shippingWeight');
      expect(weight?.status).toBe('READY');

      // With output.weightUom = 'kg' the companion writes the *converted*
      // weight, so this is what the spreadsheet actually said. The pounds are
      // not lost - they are on the Audit sheet, and in the companion's own
      // preview - but the extension is reading kilograms and says so.
      expect(weight?.original).toBe('79832');
    });

    it('carries the pounds all the way through when the workbook is written in lb', async () => {
      // output.weightUom = 'lb' writes the QuickBooks pounds and lets the
      // extension convert. Same kilograms either way - the conversion is the
      // same code - but the operator sees the whole chain in the panel:
      // 176000 lb -> lb x 0.45359237 -> 79832.
      const pounds = await exportWorkbook('lb');
      const loaded = loadFromBytes(pounds.bytes, pounds.fileName, { settings: DEFAULT_SETTINGS });

      expect(loaded.shipment.commodities[0]?.shippingWeight).toBe(79832);

      const rows = buildMappingStatus(loaded.shipment, {
        settings: DEFAULT_SETTINGS,
        line: 1,
        source: loaded.source,
      });
      const weight = rows.find((row) => row.key === 'ShippingWeight');

      expect(weight?.original).toContain('176000');
      expect(weight?.transform).toContain('0.45359237');
      expect(weight?.aceValue).toBe('79832');
    });
  });
});
