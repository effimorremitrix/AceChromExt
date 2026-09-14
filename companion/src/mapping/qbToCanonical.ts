/**
 * QuickBooks invoice -> canonical shipment model.
 *
 * This is the only file that knows both vocabularies. Everything above it
 * speaks qbXML; everything below it speaks the canonical model that Phase 1
 * already previews, validates, exports and fills.
 *
 * Two decisions shape it:
 *
 * 1. **No second transformation engine.** Values are normalized by calling
 *    Phase 1's `mapCell` with the column spec for the canonical field, so
 *    "176000 lb" becomes 79,832 kg through exactly the code the spreadsheet
 *    path uses - same conversion, same rounding, same wording in the preview.
 *
 * 2. **Every field says where it came from.** An ACE filing is a legal
 *    declaration, so "QuickBooks told me" and "I worked it out" and "you typed
 *    it" must not look alike. `FieldOrigin` records which, per field, and the
 *    preview and the audit sheet show it.
 */

import {
  COMMODITY_FIELDS,
  emptyCommodity,
  emptyInvoice,
  emptyProvenance,
  INVOICE_FIELDS,
  type CanonicalCommodity,
  type CanonicalShipment,
  type CommodityField,
  type FieldProvenance,
  type InvoiceField,
} from '../../../src/models/CanonicalInvoice.js';
import { mapCell, type CellOutcome } from '../../../src/excel/canonicalMapper.js';
import { COLUMN_SPECS, type ColumnSpec } from '../../../src/excel/columnAliases.js';
import { DEFAULT_SETTINGS, type AceHelperSettings } from '../../../src/core/settings.js';
import { roundHalfUp } from '../../../src/ace/transformers/numbers.js';
import { detectWeightUnit, kilogramsToPounds } from '../../../src/ace/transformers/weight.js';
import { customFieldValue } from '../qbxml/parse.js';
import { formatAddress, type QbDataExt, type QbInvoice, type QbInvoiceLine } from '../qbxml/types.js';
import { profileForItem, type AceExportConfig, type ItemExportProfile } from '../config.js';
import type { CanonicalMapping, FieldOrigin, FieldSource, MappingNote, OriginIndex } from './types.js';

export type {
  CanonicalMapping,
  FieldOrigin,
  FieldSource,
  MappingNote,
  OriginIndex,
} from './types.js';

export interface QbMapOptions {
  settings?: AceHelperSettings;
  /** Last-word overrides, e.g. from `--set vessel="MSC FIRENZE"`. */
  overrides?: Partial<Record<InvoiceField, string>>;
  /**
   * Per-line overrides, keyed by 1-based commodity line.
   *
   * Schedule B, origin and licence code are the three facts no accounting
   * system holds, and the item profile is where they belong long-term. But on
   * the morning of a sailing an operator needs to supply one for a line and
   * export, not edit a JSON file first - so the export UI can pass them here
   * for this export only. They are recorded with origin 'manual', exactly like
   * a --set, so the audit trail still says a human supplied them.
   *
   * Quantity 1, the value and the shipping weight are deliberately not
   * overridable: those are what the invoice line *is*, and letting the export
   * screen change them would let an ACE filing disagree with its own invoice.
   */
  lineOverrides?: Record<number, Partial<Record<CommodityField, string>>>;
}

/**
 * Commodity fields an export-time override may set.
 *
 * `uom1` is absent on purpose, even though a custom field may fill it.
 * Quantity 1 and UOM 1 are derived together from the weight, so changing the
 * unit alone would make ACE report 79,832 *pounds*. The unit for a Schedule B
 * number belongs in the item profile (`aceUom1`), where quantity 1 is derived
 * to match it. Quantity 1, the value and the shipping weight are absent for
 * the stronger reason: they are what the invoice line is.
 */
export const OVERRIDABLE_COMMODITY_FIELDS: CommodityField[] = [
  'exportInformationCode',
  'scheduleB',
  'description',
  'quantity2',
  'uom2',
  'origin',
  'eccn',
  'licenseCode',
];

// ---------------------------------------------------------------------------
// Canonical field -> the Phase 1 column spec that knows how to normalize it.
// ---------------------------------------------------------------------------

const SPEC_BY_FIELD = new Map<string, ColumnSpec>();
for (const spec of COLUMN_SPECS) {
  if (spec.field && spec.target !== 'control') SPEC_BY_FIELD.set(`${spec.target}:${spec.field}`, spec);
}

function specFor(target: 'invoice' | 'commodity', field: string): ColumnSpec {
  const spec = SPEC_BY_FIELD.get(`${target}:${field}`);
  if (!spec) {
    // Unreachable while the canonical model and the column table agree; a
    // test asserts that they do.
    throw new Error(`No column spec for ${target} field "${field}".`);
  }
  return spec;
}

interface Candidate {
  origin: FieldOrigin;
  source: string;
  value: string;
}

/** First candidate with a non-blank value. */
function pick(candidates: Candidate[]): Candidate | null {
  return candidates.find((candidate) => candidate.value.trim() !== '') ?? null;
}

function provenanceOf(source: string, original: string, outcome: CellOutcome): FieldProvenance {
  return { column: source, original, transform: outcome.transform, normalized: outcome.normalized };
}

/**
 * A value QuickBooks supplied is only *derived* when the canonical value is
 * genuinely different from what QuickBooks said - 176000 lb becoming 79,832 kg,
 * or "Derince" becoming "DERINCE". A qbXML date is already ISO, so formatting
 * it as MM/DD/YYYY for an ACE input changes nothing about the fact reported and
 * must not be flagged as if a human had computed it.
 */
function originFor(chosen: Candidate, outcome: CellOutcome): FieldOrigin {
  if (chosen.origin !== 'quickbooks') return chosen.origin;
  const canonical = outcome.value === null ? '' : String(outcome.value);
  return canonical === chosen.value.trim() ? 'quickbooks' : 'derived';
}

/** The custom-field candidates the configuration maps onto `field`. */
function customFieldCandidates(
  config: AceExportConfig,
  fields: QbDataExt[],
  field: string,
  where: string,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [dataExtName, target] of Object.entries(config.customFields)) {
    if (target !== field) continue;
    const value = customFieldValue(fields, dataExtName);
    if (value.trim() === '') continue;
    candidates.push({ origin: 'custom-field', source: `${where} custom field "${dataExtName}"`, value });
  }
  return candidates;
}

function otherFieldCandidates(config: AceExportConfig, invoice: QbInvoice, field: string): Candidate[] {
  const firstLine = invoice.lines[0];
  const values: Record<string, string> = {
    Other: invoice.other,
    Other1: firstLine?.other1 ?? '',
    Other2: firstLine?.other2 ?? '',
  };
  const candidates: Candidate[] = [];
  for (const [name, target] of Object.entries(config.otherFields)) {
    if (target !== field) continue;
    const value = values[name] ?? '';
    if (value.trim() === '') continue;
    candidates.push({ origin: 'quickbooks', source: `InvoiceRet/${name}`, value });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Invoice header
// ---------------------------------------------------------------------------

/**
 * Built-in qbXML sources for the canonical header fields.
 *
 * Four of these are the reason the SDK route was chosen over a report export:
 * `FOB`, `TermsRef`, `ShipMethodRef` and `PONumber` are first-class invoice
 * fields, so freight terms, payment terms, carrier and PO need no custom-field
 * configuration at all.
 */
function builtInCandidates(invoice: QbInvoice, field: InvoiceField): Candidate[] {
  const qb = (source: string, value: string): Candidate[] =>
    value.trim() === '' ? [] : [{ origin: 'quickbooks' as FieldOrigin, source, value }];

  switch (field) {
    case 'invoiceNumber':
      return qb('InvoiceRet/RefNumber', invoice.refNumber);
    case 'invoiceDate':
      return qb('InvoiceRet/TxnDate', invoice.txnDate);
    case 'customerName':
      return qb('InvoiceRet/CustomerRef/FullName', invoice.customer.fullName);
    case 'billTo':
      return qb('InvoiceRet/BillAddress', formatAddress(invoice.billAddress));
    case 'poNumber':
      return qb('InvoiceRet/PONumber', invoice.poNumber);
    case 'freightTerms':
      return qb('InvoiceRet/FOB', invoice.fob);
    case 'paymentTerms':
      return qb('InvoiceRet/TermsRef/FullName', invoice.terms.fullName);
    case 'paymentDueDate':
      return qb('InvoiceRet/DueDate', invoice.dueDate);
    case 'carrier':
      return qb('InvoiceRet/ShipMethodRef/FullName', invoice.shipMethod.fullName);
    case 'destination':
      return qb('InvoiceRet/ShipAddress/Country', invoice.shipAddress?.country ?? '');
    default:
      // vessel, bookingNumber, containerNumber, sealNumber: QuickBooks has no
      // built-in element for any of these. They arrive as custom fields, or
      // they are typed in.
      return [];
  }
}

// ---------------------------------------------------------------------------
// Commodity lines
// ---------------------------------------------------------------------------

interface WeightSource {
  /** Value and unit, as text, for the Phase 1 weight column rule. */
  text: string;
  unit: string;
  origin: FieldOrigin;
  source: string;
  /** The quantity in pounds, when it is known exactly (for aceUom1 = LB). */
  pounds: number | null;
}

function weightSourceFor(line: QbInvoiceLine, profile: ItemExportProfile): WeightSource | null {
  const quantity = line.quantity;
  if (quantity === null) return null;

  // 1. The QuickBooks quantity is itself a weight ("176000 lb").
  const lineUnit = line.unitOfMeasure.trim() || (profile.quantityUom ?? '').trim();
  const detected = detectWeightUnit(lineUnit);
  if (detected !== 'unknown') {
    return {
      text: `${quantity} ${lineUnit}`,
      unit: lineUnit,
      origin: detected === 'kg' ? 'quickbooks' : 'derived',
      source: line.unitOfMeasure.trim() === ''
        ? `InvoiceLineRet/Quantity x configured unit "${lineUnit}"`
        : 'InvoiceLineRet/Quantity + UnitOfMeasure',
      pounds: detected === 'lb' ? quantity : null,
    };
  }

  // 2. The item is sold by the case/bag and the profile gives a unit weight.
  if (profile.unitWeight !== undefined) {
    const unit = (profile.unitWeightUom ?? 'lb').trim();
    const total = roundHalfUp(quantity * profile.unitWeight, 6);
    return {
      text: `${total} ${unit}`,
      unit,
      origin: 'derived',
      source: `InvoiceLineRet/Quantity x items.unitWeight (${profile.unitWeight} ${unit})`,
      pounds: detectWeightUnit(unit) === 'lb' ? total : null,
    };
  }

  return null;
}

interface LineContext {
  line: QbInvoiceLine;
  index: number;
  profile: ItemExportProfile;
  itemCustom: Map<string, { value: string; source: string }>;
}

function readItemCustomFields(config: AceExportConfig, line: QbInvoiceLine): Map<string, { value: string; source: string }> {
  const mapped = new Map<string, { value: string; source: string }>();
  for (const [dataExtName, target] of Object.entries(config.itemCustomFields)) {
    const value = customFieldValue(line.customFields, dataExtName);
    if (value.trim() === '') continue;
    if (!mapped.has(target)) mapped.set(target, { value, source: `line custom field "${dataExtName}"` });
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// The mapping itself
// ---------------------------------------------------------------------------

export function mapQbInvoiceToCanonical(
  invoice: QbInvoice,
  config: AceExportConfig,
  options: QbMapOptions = {},
): CanonicalMapping {
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const notes: MappingNote[] = [];
  const origins: OriginIndex = { invoice: {}, commodities: {} };
  const provenance = emptyProvenance();
  const canonicalInvoice = emptyInvoice();
  const usedCustomFields = new Set<string>();

  const note = (severity: MappingNote['severity'], message: string, extra: Partial<MappingNote> = {}): void => {
    notes.push({ severity, message, ...extra });
  };

  // ---- header ------------------------------------------------------------
  for (const field of INVOICE_FIELDS) {
    const candidates: Candidate[] = [];

    const override = options.overrides?.[field];
    if (override !== undefined && override.trim() !== '') {
      candidates.push({ origin: 'manual', source: 'supplied for this export', value: override });
    }
    const manual = config.manual[field];
    if (manual !== undefined && manual.trim() !== '') {
      candidates.push({ origin: 'manual', source: `config manual.${field}`, value: manual });
    }

    const customCandidates = customFieldCandidates(config, invoice.customFields, field, 'invoice');
    candidates.push(...customCandidates);
    candidates.push(...otherFieldCandidates(config, invoice, field));
    candidates.push(...builtInCandidates(invoice, field));

    const fallback = config.invoiceDefaults[field];
    if (fallback !== undefined && fallback.trim() !== '') {
      candidates.push({ origin: 'default', source: `config invoiceDefaults.${field}`, value: fallback });
    }

    const chosen = pick(candidates);
    if (!chosen) {
      origins.invoice[field] = { origin: 'missing', source: '' };
      continue;
    }
    if (chosen.origin === 'custom-field') {
      const name = /"([^"]+)"/.exec(chosen.source)?.[1];
      if (name) usedCustomFields.add(name);
    }

    const spec = specFor('invoice', field);
    const outcome = mapCell(spec, chosen.value, '', settings);
    if (outcome.error) {
      note('error', `${spec.column}: ${outcome.error}`, { column: chosen.source });
      origins.invoice[field] = { origin: 'missing', source: chosen.source };
      continue;
    }
    for (const message of outcome.notes) note('warning', `${spec.column}: ${message}`, { column: chosen.source });

    canonicalInvoice[field] = outcome.value === null ? '' : String(outcome.value);
    provenance.invoice[field] = provenanceOf(chosen.source, chosen.value, outcome);
    origins.invoice[field] = { origin: originFor(chosen, outcome), source: chosen.source };
  }

  // ---- commodity lines ---------------------------------------------------
  const commodities: CanonicalCommodity[] = [];

  invoice.lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const profile = profileForItem(config, line.item.fullName);
    const context: LineContext = { line, index, profile, itemCustom: readItemCustomFields(config, line) };
    const commodity = emptyCommodity(lineNumber);
    const lineProvenance: Record<string, FieldProvenance> = {};
    const lineOrigins: Record<string, FieldSource> = {};

    const assign = (field: CommodityField, chosen: Candidate | null): CellOutcome | null => {
      if (!chosen) {
        lineOrigins[field] = { origin: 'missing', source: '' };
        return null;
      }
      const spec = specFor('commodity', field);
      const outcome = mapCell(spec, chosen.value, '', settings);
      if (outcome.error) {
        note('error', `${spec.column}: ${outcome.error}`, { column: chosen.source, line: lineNumber });
        lineOrigins[field] = { origin: 'missing', source: chosen.source };
        return null;
      }
      for (const message of outcome.notes) {
        note('warning', `${spec.column}: ${message}`, { column: chosen.source, line: lineNumber });
      }
      assignCommodityValue(commodity, field, outcome.value);
      lineProvenance[field] = provenanceOf(chosen.source, chosen.value, outcome);
      lineOrigins[field] = { origin: originFor(chosen, outcome), source: chosen.source };
      return outcome;
    };

    // Text/code fields: the operator's item profile, then a line custom field,
    // then whatever QuickBooks itself carries.
    const profileCandidate = (value: string | undefined, key: string): Candidate[] =>
      value === undefined || value.trim() === ''
        ? []
        : [{ origin: 'manual' as FieldOrigin, source: `items."${line.item.fullName}".${key}`, value }];

    // Supplied for this export only. First in the list, so it beats the item
    // profile and anything QuickBooks carries.
    const overrideCandidate = (field: CommodityField): Candidate[] => {
      const value = options.lineOverrides?.[lineNumber]?.[field];
      if (value === undefined || value.trim() === '') return [];
      if (!OVERRIDABLE_COMMODITY_FIELDS.includes(field)) return [];
      return [{ origin: 'manual' as FieldOrigin, source: `supplied for this export (line ${lineNumber})`, value }];
    };

    const customCandidate = (field: string): Candidate[] => {
      const found = context.itemCustom.get(field);
      return found ? [{ origin: 'custom-field' as FieldOrigin, source: found.source, value: found.value }] : [];
    };

    assign(
      'scheduleB',
      pick([...overrideCandidate('scheduleB'), ...profileCandidate(profile.scheduleB, 'scheduleB'), ...customCandidate('scheduleB')]),
    );
    assign(
      'description',
      pick([
        ...overrideCandidate('description'),
        ...profileCandidate(profile.description, 'description'),
        ...customCandidate('description'),
        { origin: 'quickbooks', source: 'InvoiceLineRet/Desc', value: line.desc },
        { origin: 'quickbooks', source: 'InvoiceLineRet/ItemRef/FullName', value: line.item.fullName },
      ]),
    );
    assign('origin', pick([...overrideCandidate('origin'), ...profileCandidate(profile.origin, 'origin'), ...customCandidate('origin')]));
    assign(
      'licenseCode',
      pick([...overrideCandidate('licenseCode'), ...profileCandidate(profile.licenseCode, 'licenseCode'), ...customCandidate('licenseCode')]),
    );
    assign('eccn', pick([...overrideCandidate('eccn'), ...profileCandidate(profile.eccn, 'eccn'), ...customCandidate('eccn')]));
    assign(
      'exportInformationCode',
      pick([
        ...overrideCandidate('exportInformationCode'),
        ...profileCandidate(profile.exportInformationCode, 'exportInformationCode'),
        ...customCandidate('exportInformationCode'),
      ]),
    );
    assign('quantity2', pick([...overrideCandidate('quantity2'), ...customCandidate('quantity2')]));
    assign('uom2', pick([...overrideCandidate('uom2'), ...customCandidate('uom2')]));

    // ---- value ----
    if (line.amount !== null) {
      assign('valueOfGoods', { origin: 'quickbooks', source: 'InvoiceLineRet/Amount', value: String(line.amount) });
    } else if (line.quantity !== null && line.rate !== null) {
      const computed = roundHalfUp(line.quantity * line.rate, settings.valueDecimals);
      assign('valueOfGoods', {
        origin: 'derived',
        source: 'InvoiceLineRet/Quantity x Rate',
        value: String(computed),
      });
      note('info', `No Amount on this line; used Quantity x Rate = ${computed}.`, { line: lineNumber });
    } else {
      assign('valueOfGoods', null);
      note('warning', 'No Amount and no Quantity x Rate on this line; value of goods is blank.', {
        line: lineNumber,
      });
    }

    // ---- shipping weight ----
    const weight = weightSourceFor(line, profile);
    let weightKg: number | null = null;
    if (weight) {
      const outcome = assign('shippingWeight', {
        origin: weight.origin,
        source: weight.source,
        value: weight.text,
      });
      weightKg = typeof outcome?.value === 'number' ? outcome.value : null;
    } else {
      assign('shippingWeight', null);
      note(
        'warning',
        'No shipping weight: the QuickBooks quantity is not in a weight unit, and the item has no unitWeight in the configuration.',
        { line: lineNumber },
      );
    }

    // ---- quantity 1 and its unit ----
    const aceUom1 = (profile.aceUom1 ?? '').trim();
    const from = profile.quantity1From ?? 'weight';

    if (from === 'weight' && weight && weightKg !== null) {
      const unit = aceUom1 === '' ? 'KG' : aceUom1.toUpperCase();
      if (unit === 'KG') {
        assign('quantity1', { origin: 'derived', source: `${weight.source} -> kg`, value: String(weightKg) });
        assign('uom1', { origin: 'manual', source: 'items.aceUom1', value: 'KG' });
      } else if (unit === 'LB') {
        const pounds = weight.pounds ?? kilogramsToPounds(weightKg, settings.weightDecimals);
        assign('quantity1', { origin: 'derived', source: `${weight.source} -> lb`, value: String(pounds) });
        assign('uom1', { origin: 'manual', source: 'items.aceUom1', value: 'LB' });
      } else {
        note(
          'warning',
          `Quantity 1 is configured to come from the weight, but the ACE unit is "${aceUom1}", which is not a weight. Used the QuickBooks quantity instead.`,
          { line: lineNumber },
        );
        assignQuantityFromLine(line, aceUom1, assign);
      }
      if (aceUom1 === '' ) {
        note('info', `No aceUom1 configured for "${line.item.fullName}"; reported Quantity 1 in KG.`, {
          line: lineNumber,
        });
      }
      note(
        'info',
        'Quantity 1 and Shipping Weight both derive from the QuickBooks quantity. ACE reports gross shipping weight - adjust it if packaging weight is material.',
        { line: lineNumber },
      );
    } else {
      if (from === 'weight') {
        note(
          'warning',
          'Quantity 1 should come from the weight, but no weight could be established. Used the QuickBooks quantity.',
          { line: lineNumber },
        );
      }
      assignQuantityFromLine(line, aceUom1, assign);
    }

    if (line.groupItem) {
      note('info', `Comes from the group item "${line.groupItem.fullName}".`, { line: lineNumber });
    }

    commodities.push(commodity);
    provenance.commodities[lineNumber] = lineProvenance;
    origins.commodities[lineNumber] = lineOrigins;

    function assignQuantityFromLine(
      source: QbInvoiceLine,
      configuredUom: string,
      put: (field: CommodityField, chosen: Candidate | null) => CellOutcome | null,
    ): void {
      put(
        'quantity1',
        source.quantity === null
          ? null
          : { origin: 'quickbooks', source: 'InvoiceLineRet/Quantity', value: String(source.quantity) },
      );
      const unitValue = configuredUom !== '' ? configuredUom : source.unitOfMeasure;
      put(
        'uom1',
        unitValue.trim() === ''
          ? null
          : {
              origin: configuredUom !== '' ? 'manual' : 'quickbooks',
              source: configuredUom !== '' ? 'items.aceUom1' : 'InvoiceLineRet/UnitOfMeasure',
              value: unitValue,
            },
      );
    }
  });

  if (!commodities.length) {
    note('error', 'The invoice has no line items, so there is nothing to file. Query it with IncludeLineItems.');
  }

  // ---- what was not used -------------------------------------------------
  const allCustomFieldNames = new Set<string>();
  for (const field of invoice.customFields) if (field.name !== '') allCustomFieldNames.add(field.name);
  for (const line of invoice.lines) {
    for (const field of line.customFields) if (field.name !== '') allCustomFieldNames.add(field.name);
  }
  const claimed = new Set<string>([...Object.keys(config.customFields), ...Object.keys(config.itemCustomFields)].map((name) => name.toLowerCase()));
  const unmappedCustomFields = [...allCustomFieldNames].filter((name) => !claimed.has(name.toLowerCase()));
  if (unmappedCustomFields.length) {
    note(
      'info',
      `QuickBooks returned ${unmappedCustomFields.length} custom field(s) no configuration entry claims: ${unmappedCustomFields.join(', ')}.`,
    );
  }
  if (!invoice.customFields.length && !invoice.lines.some((line) => line.customFields.length)) {
    note(
      'info',
      'The response carried no custom fields. Either none are defined on this invoice, or the query did not ask for OwnerID 0.',
    );
  }

  const usedElements = new Set<string>();
  for (const record of Object.values(origins.invoice)) if (record.source) usedElements.add(record.source);
  for (const lineOrigins of Object.values(origins.commodities)) {
    for (const record of Object.values(lineOrigins)) if (record.source) usedElements.add(record.source);
  }

  const shipment: CanonicalShipment = {
    invoice: canonicalInvoice,
    commodities,
    provenance,
    source: {
      fileName: `QuickBooks Desktop invoice ${invoice.refNumber || invoice.txnId}`,
      sheetName: 'InvoiceRet',
      importedAt: new Date().toISOString(),
      rowCount: commodities.length,
      headers: [...usedElements].sort(),
      unknownHeaders: unmappedCustomFields,
    },
  };

  return { shipment, origins, notes, unmappedCustomFields };
}

function assignCommodityValue(commodity: CanonicalCommodity, field: CommodityField, value: string | number | null): void {
  if (!COMMODITY_FIELDS.includes(field)) return;
  switch (field) {
    case 'quantity1':
    case 'quantity2':
    case 'valueOfGoods':
    case 'shippingWeight':
      commodity[field] = typeof value === 'number' ? value : null;
      return;
    default:
      commodity[field] = value === null ? '' : String(value);
  }
}
