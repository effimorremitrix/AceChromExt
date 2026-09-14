/**
 * QuickBooks invoice -> canonical shipment.
 *
 * The cases that matter are the ones where QuickBooks and ACE disagree about
 * what a number means: pounds against kilograms, a sales quantity against a
 * reportable quantity, and the customs facts (Schedule B, origin, licence)
 * that no accounting system holds at all.
 */

import { describe, expect, it } from 'vitest';

import { parseInvoiceQueryResponse } from '../companion/src/qbxml/parse.js';
import { mapQbInvoiceToCanonical } from '../companion/src/mapping/qbToCanonical.js';
import { normalizeConfig, profileForItem, starterConfig, type AceExportConfig } from '../companion/src/config.js';
import { validateShipment } from '../src/excel/validator.js';
import { LB_TO_KG } from '../src/ace/transformers/weight.js';
import { fixture } from './qbxml.test.js';

function invoiceFrom(name: string) {
  const parsed = parseInvoiceQueryResponse(fixture(name));
  return parsed.results[0]!;
}

function config(overrides: Partial<AceExportConfig> = {}): AceExportConfig {
  return normalizeConfig({ ...starterConfig(), ...overrides });
}

describe('the worked example from the sample invoice', () => {
  const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-single-line.xml'), config());

  it('takes the header fields QuickBooks holds natively', () => {
    expect(mapping.shipment.invoice).toMatchObject({
      invoiceNumber: 'CN-1042',
      invoiceDate: '2026-09-21',
      customerName: 'Aydin Kuruyemis San Ve Tic A.S',
      poNumber: '3993',
      freightTerms: 'FOB dock',
      paymentTerms: 'Net 120',
      paymentDueDate: '2027-01-19',
      carrier: 'MSC Line',
    });
  });

  it('takes vessel, booking, container and seal from custom fields', () => {
    expect(mapping.shipment.invoice).toMatchObject({
      vessel: 'MSC FIRENZE V.541W',
      bookingNumber: 'EBKG18531408',
      containerNumber: 'See Ocean B/L',
      sealNumber: 'See Ocean B/L',
    });
    expect(mapping.origins.invoice['vessel']).toEqual({
      origin: 'custom-field',
      source: 'invoice custom field "Vessel"',
    });
  });

  it('converts 176,000 lb to kilograms with the ACE rounding policy', () => {
    const line = mapping.shipment.commodities[0]!;
    expect(176000 * LB_TO_KG).toBeCloseTo(79832.25712, 5);
    expect(line.shippingWeight).toBe(79832);
    expect(line.quantity1).toBe(79832);
    expect(line.uom1).toBe('KG');
  });

  it('keeps the original pounds for the audit trail', () => {
    const record = mapping.shipment.provenance.commodities[1]!['shippingWeight']!;
    expect(record.original).toBe('176000 lb');
    expect(record.transform).toBe(`lb x ${LB_TO_KG}`);
    expect(record.normalized).toBe('79,832 kg');
  });

  it('takes the line value from Amount, not from quantity x rate', () => {
    expect(mapping.shipment.commodities[0]!.valueOfGoods).toBe(651217.6);
    expect(mapping.origins.commodities[1]!['valueOfGoods']!.source).toBe('InvoiceLineRet/Amount');
  });

  it('takes Schedule B, origin, licence and ECCN from the item profile', () => {
    expect(mapping.shipment.commodities[0]).toMatchObject({
      scheduleB: '0802.12.0000',
      origin: 'D',
      licenseCode: 'C33',
      eccn: 'EAR99',
      exportInformationCode: 'OS',
    });
    expect(mapping.origins.commodities[1]!['scheduleB']).toEqual({
      origin: 'manual',
      source: 'items."Shelled Almonds".scheduleB',
    });
  });

  it('validates clean, except for the facts that really are uncertain', () => {
    const validation = validateShipment(mapping.shipment);
    expect(validation.errors).toBe(0);
    const fields = validation.issues.map((issue) => issue.field);
    // "Derince" is a port, not a country code, and "See Ocean B/L" is not a
    // container number. Both are flagged rather than corrected.
    expect(fields).toContain('destination');
    expect(fields).toContain('containerNumber');
  });

  it('reports the custom field nobody mapped instead of ignoring it', () => {
    expect(mapping.unmappedCustomFields).toEqual(['Broker']);
    expect(mapping.notes.some((note) => note.message.includes('Broker'))).toBe(true);
  });
});

describe('field origins', () => {
  it('separates QuickBooks, custom fields, derived, manual and missing', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-single-line.xml'), config());
    const origins = mapping.origins;
    expect(origins.invoice['invoiceNumber']!.origin).toBe('quickbooks');
    expect(origins.invoice['vessel']!.origin).toBe('custom-field');
    expect(origins.commodities[1]!['shippingWeight']!.origin).toBe('derived');
    expect(origins.commodities[1]!['scheduleB']!.origin).toBe('manual');
    expect(origins.commodities[1]!['quantity2']!.origin).toBe('missing');
  });

  it('does not call a value derived just because ACE formats it differently', () => {
    // qbXML dates are already ISO. Presenting one as MM/DD/YYYY in an ACE
    // input changes nothing about the fact being reported.
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-single-line.xml'), config());
    expect(mapping.origins.invoice['invoiceDate']!.origin).toBe('quickbooks');
    expect(mapping.shipment.invoice.invoiceDate).toBe('2026-09-21');
  });

  it('marks a configured fallback as a default, not as QuickBooks data', () => {
    const mapping = mapQbInvoiceToCanonical(
      invoiceFrom('invoice-sparse.xml'),
      config({ invoiceDefaults: { carrier: 'ZIM', destination: 'IL' } }),
    );
    expect(mapping.origins.invoice['carrier']).toEqual({
      origin: 'default',
      source: 'config invoiceDefaults.carrier',
    });
    expect(mapping.shipment.invoice.destination).toBe('IL');
  });

  it('lets a value supplied for this export win over everything', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-single-line.xml'), config(), {
      overrides: { vessel: 'MSC NAPOLI', carrier: 'HAPAG' },
    });
    expect(mapping.shipment.invoice.vessel).toBe('MSC NAPOLI');
    expect(mapping.shipment.invoice.carrier).toBe('HAPAG');
    expect(mapping.origins.invoice['carrier']!.origin).toBe('manual');
  });
});

describe('several invoice lines', () => {
  const items = {
    'Shelled Almonds': {
      scheduleB: '0802.12.0000',
      origin: 'D',
      licenseCode: 'C33',
      quantityUom: 'lb',
      aceUom1: 'KG',
      quantity1From: 'weight' as const,
    },
    'Dried Fruit': {
      scheduleB: '0813.20.0000',
      origin: 'D',
      licenseCode: 'C33',
      // Sold by the carton; 25 lb per carton is the only way to a weight.
      unitWeight: 25,
      unitWeightUom: 'lb',
      aceUom1: 'KG',
      quantity1From: 'weight' as const,
    },
  };

  const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-multi-line.xml'), config({ items }));

  it('numbers every line, including the members of a group item', () => {
    expect(mapping.shipment.commodities.map((line) => line.line)).toEqual([1, 2, 3]);
    expect(mapping.notes.some((note) => note.line === 3 && note.message.includes('group item'))).toBe(true);
  });

  it('derives a weight from a per-unit weight when the quantity is not one', () => {
    const prunes = mapping.shipment.commodities[1]!;
    // 800 cartons x 25 lb = 20,000 lb = 9,071.8474 kg -> 9,072 kg
    expect(prunes.shippingWeight).toBe(9072);
    expect(prunes.quantity1).toBe(9072);
    expect(mapping.origins.commodities[2]!['shippingWeight']!.source).toContain('items.unitWeight');
  });

  it('inherits an item profile from the parent item name', () => {
    expect(profileForItem(config({ items }), 'Dried Fruit:Dried Prunes').scheduleB).toBe('0813.20.0000');
    // ... but the line's own custom field is what actually filled it here.
    expect(mapping.shipment.commodities[1]!.scheduleB).toBe('0813.20.0000');
  });

  it('reads a Schedule B held in a QuickBooks item custom field', () => {
    const withItemCustomField = mapQbInvoiceToCanonical(
      invoiceFrom('invoice-multi-line.xml'),
      config({ items: {}, itemCustomFields: { 'Schedule B': 'scheduleB' } }),
    );
    expect(withItemCustomField.shipment.commodities[1]!.scheduleB).toBe('0813.20.0000');
    expect(withItemCustomField.origins.commodities[2]!['scheduleB']).toEqual({
      origin: 'custom-field',
      source: 'line custom field "Schedule B"',
    });
  });

  it('keeps shipment-level values once, from the first line that has them', () => {
    expect(mapping.shipment.invoice.bookingNumber).toBe('EBKG18531409');
    expect(mapping.shipment.commodities).toHaveLength(3);
  });
});

describe('missing and awkward data', () => {
  it('falls back to quantity x rate when there is no Amount, and says so', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-sparse.xml'), config());
    expect(mapping.shipment.commodities[0]!.valueOfGoods).toBe(4200);
    expect(mapping.origins.commodities[1]!['valueOfGoods']!.origin).toBe('derived');
    expect(mapping.notes.some((note) => note.message.includes('Quantity x Rate'))).toBe(true);
  });

  it('leaves the weight blank when nothing can establish one', () => {
    const mapping = mapQbInvoiceToCanonical(
      invoiceFrom('invoice-sparse.xml'),
      config({ items: { 'Shelled Almonds': { scheduleB: '0802.12.0000' } } }),
    );
    const line = mapping.shipment.commodities[0]!;
    expect(line.shippingWeight).toBeNull();
    expect(mapping.notes.some((note) => note.message.includes('No shipping weight'))).toBe(true);
    expect(validateShipment(mapping.shipment).issues.some((issue) => issue.field === 'shippingWeight')).toBe(true);
  });

  it('never invents a Schedule B, an origin or a licence code', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-sparse.xml'), config({ items: {}, itemDefaults: {} }));
    const line = mapping.shipment.commodities[0]!;
    expect(line.scheduleB).toBe('');
    expect(line.origin).toBe('');
    expect(line.licenseCode).toBe('');
    const validation = validateShipment(mapping.shipment);
    expect(validation.issues.filter((issue) => issue.field === 'scheduleB' && issue.severity === 'error')).toHaveLength(1);
  });

  it('describes a line from the item name when the invoice line has no description', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-sparse.xml'), config());
    expect(mapping.shipment.commodities[0]!.description).toBe('Shelled Almonds');
    expect(mapping.origins.commodities[1]!['description']!.source).toBe('InvoiceLineRet/ItemRef/FullName');
  });

  it('says when a response carried no custom fields at all', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-sparse.xml'), config());
    expect(mapping.notes.some((note) => note.message.includes('OwnerID 0'))).toBe(true);
  });

  it('falls back to the QuickBooks quantity when the ACE unit is not a weight', () => {
    const mapping = mapQbInvoiceToCanonical(
      invoiceFrom('invoice-single-line.xml'),
      config({ items: { 'Shelled Almonds': { aceUom1: 'NO', quantity1From: 'weight' } } }),
    );
    expect(mapping.shipment.commodities[0]!.quantity1).toBe(176000);
    expect(mapping.notes.some((note) => note.message.includes('is not a weight'))).toBe(true);
  });

  it('can report Quantity 1 as the sales quantity instead of the weight', () => {
    const mapping = mapQbInvoiceToCanonical(
      invoiceFrom('invoice-multi-line.xml'),
      config({ items: { 'Dried Fruit': { aceUom1: 'NO', quantity1From: 'quantity', unitWeight: 25, unitWeightUom: 'lb' } } }),
    );
    const prunes = mapping.shipment.commodities[1]!;
    expect(prunes.quantity1).toBe(800);
    expect(prunes.uom1).toBe('NO');
    expect(prunes.shippingWeight).toBe(9072);
  });
});

describe('configuration', () => {
  it('rejects a custom field aimed at something that is not a canonical field', () => {
    expect(() => normalizeConfig({ customFields: { Vessel: 'shipName' } })).toThrow(/not a canonical invoice field/);
  });

  it('rejects an item custom field aimed at a quantity', () => {
    expect(() => normalizeConfig({ itemCustomFields: { Weight: 'shippingWeight' } })).toThrow(/not a commodity field/);
  });

  it('rejects a malformed item profile', () => {
    expect(() => normalizeConfig({ items: { X: { quantity1From: 'guess' } } })).toThrow(/quantity1From/);
    expect(() => normalizeConfig({ items: { X: { unitWeight: -1 } } })).toThrow(/positive number/);
  });

  it('rejects an output pattern that is not a workbook', () => {
    expect(() => normalizeConfig({ output: { fileNamePattern: 'invoice.csv' } })).toThrow(/\.xlsx/);
  });

  it('ignores a __proto__ key instead of letting it through', () => {
    const parsed = normalizeConfig(JSON.parse('{"customFields": {"__proto__": "vessel", "Vessel": "vessel"}}'));
    expect(Object.keys(parsed.customFields)).toEqual(['Vessel']);
  });
});

/**
 * Phase 3: correcting the ACE-only fields at export time.
 *
 * Schedule B, origin and licence code belong in the item profile long-term.
 * But on the morning of a sailing an operator needs to supply one for a line
 * and export, not edit JSON first - so the export screen can pass them for
 * this export only, and the audit trail still says a human supplied them.
 */
describe('per-line ACE overrides', () => {
  const bare = config({ items: {}, itemDefaults: { quantity1From: 'weight', aceUom1: 'KG' } });

  it('leaves the customs fields blank when nothing supplies them', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-single-line.xml'), bare);
    const line = mapping.shipment.commodities[0]!;
    expect(line.scheduleB).toBe('');
    expect(line.origin).toBe('');
    expect(line.licenseCode).toBe('');
    expect(validateShipment(mapping.shipment).errors).toBeGreaterThan(0);
  });

  it('takes a Schedule B, origin and licence supplied for this export', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-single-line.xml'), bare, {
      lineOverrides: { 1: { scheduleB: '0802.12.0000', origin: 'Domestic', licenseCode: 'c33' } },
    });
    const line = mapping.shipment.commodities[0]!;

    // Normalised by the same transformers the spreadsheet path uses.
    expect(line.scheduleB).toBe('0802.12.0000');
    expect(line.origin).toBe('D');
    expect(line.licenseCode).toBe('C33');
    expect(validateShipment(mapping.shipment).errors).toBe(0);
  });

  it('records them as operator-supplied, not as something QuickBooks said', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-single-line.xml'), bare, {
      lineOverrides: { 1: { scheduleB: '0802.12.0000' } },
    });
    const origin = mapping.origins.commodities[1]?.['scheduleB'];
    expect(origin?.origin).toBe('manual');
    expect(origin?.source).toContain('supplied for this export');
  });

  it('beats the item profile, which beats QuickBooks', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-single-line.xml'), config(), {
      lineOverrides: { 1: { scheduleB: '0813.40.8000' } },
    });
    // starterConfig() puts 0802.12.0000 on the item; the override wins.
    expect(mapping.shipment.commodities[0]?.scheduleB).toBe('0813.40.8000');
  });

  it('ignores an override aimed at a line that does not exist', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-single-line.xml'), config(), {
      lineOverrides: { 7: { scheduleB: '9999.99.9999' } },
    });
    expect(mapping.shipment.commodities).toHaveLength(1);
    expect(mapping.shipment.commodities[0]?.scheduleB).toBe('0802.12.0000');
  });

  it('will not let the export screen contradict the invoice', () => {
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-single-line.xml'), config(), {
      // Not in OVERRIDABLE_COMMODITY_FIELDS, so it is refused at the mapper
      // even if something upstream let it through.
      lineOverrides: { 1: { valueOfGoods: '1.00', shippingWeight: '1', quantity1: '1', uom1: 'LB' } as never },
    });
    const line = mapping.shipment.commodities[0]!;
    expect(line.valueOfGoods).toBe(651217.6);
    expect(line.shippingWeight).toBe(79832);
    expect(line.quantity1).toBe(79832);
    expect(line.uom1).toBe('KG');
  });
});

describe('ACE readiness, per line', () => {
  it('says which customs facts are still missing before the workbook is written', async () => {
    const { aceReadiness } = await import('../companion/src/ui/preview.js');
    const mapping = mapQbInvoiceToCanonical(
      invoiceFrom('invoice-single-line.xml'),
      config({ items: {}, itemDefaults: { quantity1From: 'weight', aceUom1: 'KG' } }),
    );
    const [line] = aceReadiness(mapping);
    const byField = new Map(line!.items.map((item) => [item.field, item]));

    expect(byField.get('scheduleB')?.ok).toBe(false);
    expect(byField.get('origin')?.ok).toBe(false);
    expect(byField.get('licenseCode')?.ok).toBe(false);
    // The invoice facts are fine: QuickBooks does hold those.
    expect(byField.get('valueOfGoods')?.ok).toBe(true);
    expect(byField.get('shippingWeight')?.ok).toBe(true);
    expect(line!.ready).toBe(false);

    // And the three missing ones are the three the screen lets you type in.
    expect(byField.get('scheduleB')?.editable).toBe(true);
    expect(byField.get('shippingWeight')?.editable).toBe(false);
  });

  it('is ready once the item profile supplies them', async () => {
    const { aceReadiness } = await import('../companion/src/ui/preview.js');
    const mapping = mapQbInvoiceToCanonical(invoiceFrom('invoice-single-line.xml'), config());
    expect(aceReadiness(mapping)[0]?.ready).toBe(true);
  });
});
