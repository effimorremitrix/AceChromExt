/**
 * Field detection, page detection, and end-to-end filling against mock ACE
 * HTML fixtures (tests/fixtures/*.html).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { detectField, detectFields } from '../src/content/fieldDetector.js';
import { detectPage, findLineContainer } from '../src/content/pageDetector.js';
import { fillFields, resolveSource } from '../src/content/filler.js';
import { ALL_MAPPINGS, fieldByKey, fieldsForPage, unverifiedFieldKeys } from '../src/ace/mappings/index.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { emptyProvenance, type CanonicalShipment } from '../src/models/CanonicalInvoice.js';
import type { AceFieldMapping } from '../src/models/AceField.js';

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', `${name}.html`), 'utf8');
}

function mount(name: string): void {
  document.body.innerHTML = fixture(name);
}

function shipment(): CanonicalShipment {
  const provenance = emptyProvenance();
  provenance.commodities[1] = {
    shippingWeight: { column: 'ShippingWeight', original: '176,000 lb', transform: 'lb x 0.45359237', normalized: '79,832 kg' },
    valueOfGoods: { column: 'ValueOfGoods', original: '$633,600.00', transform: 'Currency symbol removed', normalized: '633,600.00' },
  };
  provenance.invoice['invoiceDate'] = { column: 'InvoiceDate', original: '3/12/2026', transform: null, normalized: '03/12/2026' };

  return {
    invoice: {
      invoiceNumber: 'INV-20451',
      invoiceDate: '2026-03-12',
      customerName: 'MEDITERRANEAN FOODS LTD',
      billTo: '14 HARBOUR ROAD, HAIFA, ISRAEL',
      poNumber: 'PO-88213',
      freightTerms: 'CIF',
      paymentTerms: 'NET 30',
      paymentDueDate: '2026-04-11',
      carrier: 'ZIM INTEGRATED SHIPPING',
      vessel: 'ZIM SHANGHAI',
      bookingNumber: 'BKG-5541220',
      containerNumber: 'ZIMU1234567',
      sealNumber: 'SL-99401',
      destination: 'IL',
    },
    commodities: [
      {
        line: 1,
        exportInformationCode: 'OS',
        scheduleB: '0802.12.0000',
        description: 'SHELLED ALMONDS',
        quantity1: 79833,
        uom1: 'KG',
        quantity2: null,
        uom2: '',
        origin: 'D',
        valueOfGoods: 633600,
        shippingWeight: 79832,
        eccn: 'EAR99',
        licenseCode: 'C33',
      },
    ],
    provenance,
    source: {
      fileName: 'test.xlsx',
      sheetName: 'Shipment',
      importedAt: new Date().toISOString(),
      rowCount: 1,
      headers: [],
      unknownHeaders: [],
    },
  };
}

const settings = { ...DEFAULT_SETTINGS, highlightDurationMs: 0 };

describe('mapping registry', () => {
  it('has no duplicate field keys', () => {
    const keys = ALL_MAPPINGS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('points every mapping at a canonical path', () => {
    for (const mapping of ALL_MAPPINGS) {
      expect(mapping.source, mapping.key).toMatch(/^(invoice|commodity)\.[a-zA-Z0-9]+$/);
      const probe = resolveSource(mapping.source, shipment(), shipment().commodities[0] ?? null);
      expect(probe.found, `${mapping.key} -> ${mapping.source}`).toBe(true);
    }
  });

  it('gives every field at least one candidate and no positional selectors', () => {
    for (const mapping of ALL_MAPPINGS) {
      expect(mapping.candidates.length, mapping.key).toBeGreaterThan(0);
      for (const candidate of mapping.candidates) {
        expect(candidate.selector ?? '', mapping.key).not.toMatch(/nth-(child|of-type)|:first|:last/);
      }
    }
  });

  it('documents a DevTools capture hint for every unverified field', () => {
    for (const mapping of ALL_MAPPINGS) {
      if (mapping.verificationStatus === 'placeholder') {
        expect(mapping.devtoolsHint, mapping.key).toBeTruthy();
      }
    }
  });

  it('reports which selectors still need verification', () => {
    // Phase 1 ships with placeholders only; this test is the tripwire that
    // keeps the count honest as fields are verified against live ACE.
    expect(unverifiedFieldKeys().length).toBe(ALL_MAPPINGS.length);
  });

  it('filters fields by page and scope', () => {
    expect(fieldsForPage('commodities', 'commodityLine').length).toBeGreaterThan(5);
    expect(fieldsForPage('commodities', 'shipment')).toHaveLength(0);
    expect(fieldsForPage('unknown')).toHaveLength(0);
    expect(fieldByKey('ValueOfGoods')?.page).toBe('commodities');
  });
});

describe('page detection', () => {
  it('identifies the commodities step from the active tab and marker element', () => {
    mount('ace-commodities');
    const detection = detectPage(document);
    expect(detection.page).toBe('commodities');
    expect(detection.confidence).toBe('high');
    expect(detection.lineContainerFound).toBe(true);
  });

  it('identifies the shipment step', () => {
    mount('ace-shipment');
    expect(detectPage(document).page).toBe('shipment');
  });

  it('identifies a page from labels alone, with lower confidence', () => {
    mount('ace-commodities-labels-only');
    const detection = detectPage(document);
    expect(detection.page).toBe('commodities');
    expect(['medium', 'high']).toContain(detection.confidence);
  });

  it('returns unknown for an unrelated page', () => {
    document.body.innerHTML = '<h1>Some other site</h1><input />';
    const detection = detectPage(document);
    expect(detection.page).toBe('unknown');
    expect(detection.confidence).toBe('none');
  });

  it('finds the line container only on the commodities step', () => {
    mount('ace-commodities');
    expect(findLineContainer('commodities', document)).not.toBeNull();
    expect(findLineContainer('shipment', document)).toBeNull();
  });
});

describe('field detection', () => {
  it('finds a field by its id', () => {
    mount('ace-commodities');
    const detection = detectField(fieldByKey('ScheduleB') as AceFieldMapping);
    expect(detection.status).toBe('FOUND');
    expect(detection.matchedBy).toBe('id');
    expect((detection.element as HTMLInputElement).id).toBe('scheduleBNumber');
    // The candidate is a placeholder, so confidence is degraded from high.
    expect(detection.confidence).toBe('medium');
  });

  it('falls back to the label when the id is absent', () => {
    mount('ace-commodities-labels-only');
    const detection = detectField(fieldByKey('ShippingWeight') as AceFieldMapping);
    expect(detection.status).toBe('FOUND');
    expect(detection.matchedBy).toBe('label');
    expect((detection.element as HTMLInputElement).id).toBe('f-d55');
  });

  it('reports a missing field rather than guessing', () => {
    mount('ace-commodities-labels-only');
    const detection = detectField(fieldByKey('ECCN') as AceFieldMapping);
    expect(detection.status).toBe('NOT_FOUND');
    expect(detection.element).toBeNull();
    expect(detection.attempts.length).toBeGreaterThan(1);
  });

  it('reports a field that exists but is disabled', () => {
    mount('ace-commodities-labels-only');
    const detection = detectField(fieldByKey('ValueOfGoods') as AceFieldMapping);
    expect(detection.status).toBe('NOT_WRITABLE');
    expect(detection.element).toBeNull();
  });

  it('reports ambiguity instead of picking one of several matches', () => {
    mount('ace-ambiguous');
    const detection = detectField(fieldByKey('ShippingWeight') as AceFieldMapping);
    expect(detection.status).toBe('AMBIGUOUS');
    expect(detection.ambiguousCount).toBe(2);
    expect(detection.element).toBeNull();
  });

  it('records every candidate it tried, for diagnostics', () => {
    mount('ace-commodities');
    const detections = detectFields(fieldsForPage('commodities', 'commodityLine'));
    expect(detections.every((detection) => detection.attempts.length > 0)).toBe(true);
    expect(detections.filter((detection) => detection.status === 'FOUND').length).toBeGreaterThan(8);
  });

  it('scopes detection to a root element', () => {
    mount('ace-commodities');
    const container = document.querySelector('[data-section="commodityLine"]') as ParentNode;
    expect(detectField(fieldByKey('ScheduleB') as AceFieldMapping, { root: container }).status).toBe('FOUND');

    const elsewhere = document.querySelector('.nav-tabs') as ParentNode;
    expect(detectField(fieldByKey('ScheduleB') as AceFieldMapping, { root: elsewhere }).status).toBe('NOT_FOUND');
  });
});

describe('fillFields - commodity line', () => {
  beforeEach(() => {
    mount('ace-commodities');
  });

  it('writes the imported line into the open Line Details form', () => {
    const report = fillFields({ shipment: shipment(), page: 'commodities', scope: 'commodityLine', line: 1, settings }, document);

    expect(report.errors).toBe(0);
    expect(report.filled).toBeGreaterThan(8);

    expect((document.getElementById('scheduleBNumber') as HTMLInputElement).value).toBe('0802.12.0000');
    expect((document.getElementById('commodityDescription') as HTMLInputElement).value).toBe('SHELLED ALMONDS');
    expect((document.getElementById('quantity1') as HTMLInputElement).value).toBe('79833');
    expect((document.getElementById('unitOfMeasure1') as HTMLSelectElement).value).toBe('KG');
    expect((document.getElementById('originOfGoods') as HTMLSelectElement).value).toBe('D');
    expect((document.getElementById('valueOfGoods') as HTMLInputElement).value).toBe('633600.00');
    expect((document.getElementById('shippingWeight') as HTMLInputElement).value).toBe('79832');
    expect((document.getElementById('licenseCode') as HTMLSelectElement).value).toBe('C33');
    expect((document.getElementById('eccn') as HTMLInputElement).value).toBe('EAR99');
  });

  it('dispatches input and change for each field it writes', () => {
    const events: string[] = [];
    const weight = document.getElementById('shippingWeight') as HTMLInputElement;
    weight.addEventListener('input', () => events.push('input'));
    weight.addEventListener('change', () => events.push('change'));

    fillFields({ shipment: shipment(), page: 'commodities', scope: 'commodityLine', line: 1, settings }, document);
    expect(events).toContain('input');
    expect(events).toContain('change');
  });

  it('keeps the original and the transformation in the report', () => {
    const report = fillFields({ shipment: shipment(), page: 'commodities', scope: 'commodityLine', line: 1, settings }, document);
    const weight = report.outcomes.find((outcome) => outcome.key === 'ShippingWeight');

    expect(weight?.status).toBe('transformed');
    expect(weight?.original).toBe('176,000 lb');
    expect(weight?.written).toBe('79832');
    expect(weight?.transform).toContain('lb x 0.45359237');
  });

  it('skips empty values and marks required ones as warnings', () => {
    const data = shipment();
    (data.commodities[0] as { quantity2: number | null }).quantity2 = null;
    (data.commodities[0] as { licenseCode: string }).licenseCode = '';

    const report = fillFields({ shipment: data, page: 'commodities', scope: 'commodityLine', line: 1, settings }, document);

    expect(report.outcomes.find((outcome) => outcome.key === 'Quantity2')?.status).toBe('skipped');
    expect(report.outcomes.find((outcome) => outcome.key === 'LicenseCode')?.status).toBe('warning');
    expect((document.getElementById('quantity2') as HTMLInputElement).value).toBe('');
  });

  it('leaves a field ACE already populated alone unless overwrite is on', () => {
    const existing = document.getElementById('commodityDescription') as HTMLInputElement;
    existing.value = 'TYPED BY THE FILER';

    const report = fillFields({ shipment: shipment(), page: 'commodities', scope: 'commodityLine', line: 1, settings }, document);
    expect(existing.value).toBe('TYPED BY THE FILER');
    expect(report.outcomes.find((outcome) => outcome.key === 'CommodityDescription')?.status).toBe('warning');

    const overwritten = fillFields(
      { shipment: shipment(), page: 'commodities', scope: 'commodityLine', line: 1, settings, overwrite: true },
      document,
    );
    expect(existing.value).toBe('SHELLED ALMONDS');
    expect(overwritten.outcomes.find((outcome) => outcome.key === 'CommodityDescription')?.status).toBe('filled');
  });

  it('writes nothing on a dry run', () => {
    const report = fillFields(
      { shipment: shipment(), page: 'commodities', scope: 'commodityLine', line: 1, settings, dryRun: true },
      document,
    );
    expect((document.getElementById('scheduleBNumber') as HTMLInputElement).value).toBe('');
    expect(report.outcomes.every((outcome) => (outcome.message ?? '').startsWith('Dry run') || outcome.status === 'skipped' || outcome.status === 'warning')).toBe(true);
  });

  it('never clicks Save Line or any other ACE control', () => {
    let clicked = false;
    (document.getElementById('saveLine') as HTMLButtonElement).addEventListener('click', () => {
      clicked = true;
    });
    fillFields({ shipment: shipment(), page: 'commodities', scope: 'commodityLine', line: 1, settings }, document);
    expect(clicked).toBe(false);
  });

  it('reports a line that is not in the imported data', () => {
    const report = fillFields({ shipment: shipment(), page: 'commodities', scope: 'commodityLine', line: 9, settings }, document);
    expect(report.errors).toBe(1);
    expect(report.outcomes[0]?.message).toMatch(/Line 9 is not in the imported data/);
  });

  it('refuses to write an ambiguous field', () => {
    mount('ace-ambiguous');
    const report = fillFields({ shipment: shipment(), page: 'commodities', scope: 'commodityLine', line: 1, settings }, document);
    const weight = report.outcomes.find((outcome) => outcome.key === 'ShippingWeight');

    expect(weight?.status).toBe('warning');
    expect(weight?.message).toMatch(/matched/i);
    expect((document.getElementById('w1') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('w2') as HTMLInputElement).value).toBe('');
  });

  it('fills what it can when the page only exposes labels', () => {
    mount('ace-commodities-labels-only');
    const report = fillFields({ shipment: shipment(), page: 'commodities', scope: 'commodityLine', line: 1, settings }, document);

    expect((document.getElementById('f-a91') as HTMLInputElement).value).toBe('0802.12.0000');
    expect((document.getElementById('f-d55') as HTMLInputElement).value).toBe('79832');
    // The disabled Value of Goods box is reported, not forced.
    expect((document.getElementById('f-e09') as HTMLInputElement).value).toBe('');
    expect(report.warnings).toBeGreaterThan(0);
  });
});

describe('fillFields - shipment level', () => {
  beforeEach(() => {
    mount('ace-shipment');
  });

  it('writes only the fields that belong to the shipment step', () => {
    const report = fillFields({ shipment: shipment(), page: 'shipment', scope: 'shipment', settings }, document);

    expect((document.getElementById('shipmentReferenceNumber') as HTMLInputElement).value).toBe('INV-20451');
    expect((document.getElementById('estimatedExportDate') as HTMLInputElement).value).toBe('03/12/2026');
    expect((document.getElementById('poNumber') as HTMLInputElement).value).toBe('PO-88213');
    expect((document.getElementById('countryOfUltimateDestination') as HTMLSelectElement).value).toBe('IL');
    expect((document.getElementById('inCoTerms') as HTMLSelectElement).value).toBe('CIF');
    expect(report.errors).toBe(0);

    // No commodity-line field is touched on this page.
    expect(report.outcomes.some((outcome) => outcome.key === 'ScheduleB')).toBe(false);
  });

  it('truncates an over-long value to the ACE limit and says so', () => {
    const data = shipment();
    (data.invoice as { invoiceNumber: string }).invoiceNumber = 'INV-2045100000000000000';

    const report = fillFields({ shipment: data, page: 'shipment', scope: 'shipment', settings }, document);
    const reference = report.outcomes.find((outcome) => outcome.key === 'ShipmentReferenceNumber');

    expect((document.getElementById('shipmentReferenceNumber') as HTMLInputElement).value).toHaveLength(17);
    expect(reference?.message).toMatch(/Truncated to 17/);
  });

  it('reports when no fields are mapped for the requested scope', () => {
    const report = fillFields({ shipment: shipment(), page: 'shipment', scope: 'commodityLine', line: 1, settings }, document);
    expect(report.outcomes[0]?.message).toMatch(/No commodity-line fields are mapped/);
  });
});

describe('resolveSource', () => {
  it('reads invoice and commodity paths', () => {
    const data = shipment();
    expect(resolveSource('invoice.invoiceNumber', data, null)).toEqual({ found: true, value: 'INV-20451' });
    expect(resolveSource('commodity.scheduleB', data, data.commodities[0] ?? null)).toEqual({ found: true, value: '0802.12.0000' });
  });

  it('reports an unknown path instead of returning undefined', () => {
    const data = shipment();
    expect(resolveSource('invoice.nope', data, null).found).toBe(false);
    expect(resolveSource('nonsense', data, null).found).toBe(false);
    expect(resolveSource('commodity.scheduleB', data, null).found).toBe(false);
  });
});
