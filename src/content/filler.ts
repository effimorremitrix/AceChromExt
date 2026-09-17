/**
 * Fill orchestration.
 *
 * Reads the canonical model, resolves the mappings for the page the user is
 * looking at, transforms each value for ACE, writes it through
 * setAceFieldValue, and returns a report.
 *
 * Hard limits, by design:
 *   - only fields belonging to the detected page are touched;
 *   - a field that cannot be confidently resolved is skipped, never guessed;
 *   - commodity-line writes are scoped to the open Line Details container;
 *   - nothing is clicked. No Save, no Save Line, no Add Line, no Submit,
 *     no Certify. Those remain the filer's own actions.
 */

import {
  emptyFillReport,
  tallyReport,
  type AceFieldMapping,
  type AcePageId,
  type FieldDetection,
  type FillOutcome,
  type FillReport,
} from '../models/AceField.js';
import type { CanonicalCommodity, CanonicalShipment } from '../models/CanonicalInvoice.js';
import { resolveFields } from '../ace/mappings/index.js';
import type { SelectorOverrides } from '../ace/selectors/overrides.js';
import { describeCandidate } from '../ace/selectors/types.js';
import { runTransforms } from '../ace/transformers/index.js';
import { truncate } from '../ace/transformers/text.js';
import type { AceHelperSettings } from '../core/settings.js';
import { detectField } from './fieldDetector.js';
import { setAceFieldValue, readAceFieldValue } from './fieldWriter.js';
import { highlightField } from './highlight.js';
import { findLineContainer } from './pageDetector.js';

export interface FillRequest {
  shipment: CanonicalShipment;
  page: AcePageId;
  /** 'shipment' fills header fields; 'commodityLine' fills one line. */
  scope: 'shipment' | 'commodityLine';
  /** Required when scope is 'commodityLine'. */
  line?: number;
  settings: AceHelperSettings;
  /** Resolve and transform everything, but write nothing. Used by diagnostics. */
  dryRun?: boolean;
  /** Overwrite ACE fields that already hold a different value. Default false. */
  overwrite?: boolean;
  /** Operator-captured selectors, tried ahead of the built-in candidates. */
  overrides?: SelectorOverrides | null;
  /**
   * Values that belong to the operator rather than to the shipment.
   *
   * Only the Shipment Reference Number so far, which comes from the running
   * counter in src/core/referenceCounter.ts. It is not part of the canonical
   * model because it is not a property of the goods: it is the filer's own
   * sequence, and two imports of the same spreadsheet get two different ones.
   */
  operator?: OperatorValues | null;
}

export interface OperatorValues {
  /** ACE Step 1 Shipment Reference Number. Empty means "nothing to file here". */
  shipmentReference?: string;
}

/** Resolve a mapping's dotted source path against the canonical model. */
export function resolveSource(
  source: string,
  shipment: CanonicalShipment,
  commodity: CanonicalCommodity | null,
  operator: OperatorValues | null = null,
): { found: boolean; value: unknown } {
  const [root, field] = source.split('.');
  if (!root || !field) return { found: false, value: null };

  if (root === 'operator') {
    const values = (operator ?? {}) as Record<string, unknown>;
    return field in values ? { found: true, value: values[field] } : { found: false, value: null };
  }

  if (root === 'invoice') {
    const invoice = shipment.invoice as unknown as Record<string, unknown>;
    return field in invoice ? { found: true, value: invoice[field] } : { found: false, value: null };
  }

  if (root === 'commodity') {
    if (!commodity) return { found: false, value: null };
    const record = commodity as unknown as Record<string, unknown>;
    return field in record ? { found: true, value: record[field] } : { found: false, value: null };
  }

  return { found: false, value: null };
}

function provenanceFor(
  shipment: CanonicalShipment,
  mapping: AceFieldMapping,
  commodity: CanonicalCommodity | null,
): { original: string; transform: string | null } {
  const field = mapping.source.split('.')[1] ?? '';
  if (mapping.scope === 'shipment') {
    const record = shipment.provenance.invoice[field];
    return { original: record?.original ?? '', transform: record?.transform ?? null };
  }
  if (commodity) {
    const record = shipment.provenance.commodities[commodity.line]?.[field];
    return { original: record?.original ?? '', transform: record?.transform ?? null };
  }
  return { original: '', transform: null };
}

/** "KG" agrees with "KG", "kg" and "KG - Kilograms"; nothing agrees with empty. */
function sameCode(shown: string, expected: string): boolean {
  const a = shown.trim().toLowerCase();
  const b = expected.trim().toLowerCase();
  if (a === '' || b === '') return false;
  if (a === b) return true;
  const code = a.split(/\s*[-\u2013:]\s*/)[0] ?? '';
  return code === b;
}

function detectionMessage(detection: FieldDetection): string {
  switch (detection.status) {
    case 'AMBIGUOUS':
      return `${detection.ambiguousCount ?? 2} fields matched "${detection.matchedWith}". Not written - the mapping needs a more specific selector.`;
    case 'NOT_WRITABLE':
      return 'The matching field is disabled or read-only in ACE right now.';
    case 'NOT_FOUND':
    default:
      return 'No field on this page matched the mapping. Enable debug mode for the selectors that were tried.';
  }
}

export function fillFields(request: FillRequest, doc: Document = document): FillReport {
  const { shipment, page, scope, settings, dryRun = false, overwrite = false } = request;

  // The Shipment Reference Number is the filer's own running sequence when a
  // counter has been set up, and the invoice number when one has not - which
  // is what this field always used to be, so a profile that never configures
  // a counter behaves exactly as before.
  const operator: OperatorValues = {
    shipmentReference: request.operator?.shipmentReference || shipment.invoice.invoiceNumber,
  };

  const report = emptyFillReport(page, scope, request.line);

  const commodity =
    scope === 'commodityLine'
      ? shipment.commodities.find((item) => item.line === request.line) ?? null
      : null;

  if (scope === 'commodityLine' && !commodity) {
    report.outcomes.push({
      key: 'line',
      label: 'Commodity line',
      status: 'error',
      message: `Line ${request.line} is not in the imported data.`,
    });
    return tallyReport(report);
  }

  const mappings = resolveFields(page, scope, request.overrides ?? null);
  if (!mappings.length) {
    report.outcomes.push({
      key: 'page',
      label: 'Page',
      status: 'warning',
      message: `No ${scope === 'shipment' ? 'shipment-level' : 'commodity-line'} fields are mapped for this ACE page.`,
    });
    return tallyReport(report);
  }

  // Commodity-line fields are resolved inside the open Line Details container
  // so a write can never land on a different line.
  const root = scope === 'commodityLine' ? findLineContainer(page, doc) ?? doc : doc;

  for (const mapping of mappings) {
    const outcome = fillOne(mapping, { shipment, commodity, settings, dryRun, overwrite, operator }, root);
    report.outcomes.push(outcome);
  }

  return tallyReport(report);
}

interface FillOneContext {
  shipment: CanonicalShipment;
  commodity: CanonicalCommodity | null;
  settings: AceHelperSettings;
  dryRun: boolean;
  overwrite: boolean;
  operator: OperatorValues | null;
}

function fillOne(mapping: AceFieldMapping, ctx: FillOneContext, root: ParentNode): FillOutcome {
  const { shipment, commodity, settings, dryRun, overwrite, operator } = ctx;
  const base: FillOutcome = {
    key: mapping.key,
    label: mapping.label,
    status: 'skipped',
    source: mapping.source,
    selector: describeCandidate(mapping.candidates),
  };

  const resolved = resolveSource(mapping.source, shipment, commodity, operator);
  if (!resolved.found) {
    return { ...base, status: 'error', message: `Mapping source "${mapping.source}" is not part of the canonical model.` };
  }

  const { original, transform: importTransform } = provenanceFor(shipment, mapping, commodity);

  const isEmpty = resolved.value === null || resolved.value === undefined || String(resolved.value).trim() === '';
  if (isEmpty) {
    return {
      ...base,
      status: mapping.expected ? 'warning' : 'skipped',
      message: mapping.expected ? 'No value in the imported data for this required ACE field.' : 'No value in the imported data.',
      original,
    };
  }

  const transformed = runTransforms(resolved.value, mapping.transforms, { settings });
  if (transformed.error) {
    return { ...base, status: 'error', message: transformed.error, original };
  }

  const { value: finalValue, truncated } = truncate(transformed.text, mapping.maxLength);
  const combinedTransform = [importTransform, transformed.transform].filter(Boolean).join('; ') || null;
  const notes = [...transformed.notes];
  if (truncated) notes.push(`Truncated to ${mapping.maxLength} characters for ACE.`);

  const detection = detectField(mapping, { root });

  // A field ACE derives itself (1st UOM from the Schedule B number) is shown
  // read-only. It is never written; what ACE shows is compared with the
  // imported value so a wrong Schedule B / unit pairing is caught here.
  if (mapping.aceDerived && detection.status === 'NOT_WRITABLE' && detection.unwritableElement) {
    const shown = readAceFieldValue(detection.unwritableElement).trim();
    const agrees = sameCode(shown, finalValue);
    return {
      ...base,
      status: agrees ? 'skipped' : 'warning',
      message: agrees
        ? `ACE derives this from the Schedule B number and shows "${shown}", matching the imported value.`
        : `ACE derives this from the Schedule B number and shows "${shown || '(empty)'}", but the imported value is "${finalValue}". Check the Schedule B number and the unit.`,
      original,
      written: finalValue,
      transform: combinedTransform,
      matchedWith: detection.matchedWith,
      confidence: detection.confidence,
      aceDerived: true,
    };
  }

  if (detection.status !== 'FOUND' || !detection.element) {
    return {
      ...base,
      status: 'warning',
      message: detectionMessage(detection),
      original,
      written: finalValue,
      transform: combinedTransform,
      matchedWith: detection.matchedWith,
      confidence: detection.confidence,
    };
  }

  base.selector = detection.matchedWith ?? base.selector;

  const existing = readAceFieldValue(detection.element);
  if (existing.trim() !== '' && existing.trim() !== finalValue.trim() && !overwrite) {
    return {
      ...base,
      status: 'warning',
      message: `ACE already holds "${existing}". Left untouched - turn on "Overwrite existing values" to replace it.`,
      original,
      written: finalValue,
      transform: combinedTransform,
      matchedWith: detection.matchedWith,
      confidence: detection.confidence,
    };
  }

  if (dryRun) {
    return {
      ...base,
      status: combinedTransform ? 'transformed' : 'filled',
      message: `Dry run: would write "${finalValue}".${notes.length ? ` ${notes.join(' ')}` : ''}`,
      original,
      written: finalValue,
      transform: combinedTransform,
      matchedWith: detection.matchedWith,
      confidence: detection.confidence,
    };
  }

  const write = setAceFieldValue(detection.element, finalValue, { blur: settings.dispatchBlur });

  if (!write.ok) {
    highlightField(detection.element, 'error', settings.highlightDurationMs, mapping.key);
    return {
      ...base,
      status: 'error',
      message: write.reason ?? 'The value could not be written.',
      original,
      written: finalValue,
      transform: combinedTransform,
      matchedWith: detection.matchedWith,
      confidence: detection.confidence,
    };
  }

  const status: FillOutcome['status'] = combinedTransform || notes.length ? 'transformed' : 'filled';
  highlightField(detection.element, status, settings.highlightDurationMs, mapping.key);

  // A low-confidence match wrote successfully, but the filer should look at it.
  const messageParts = [...notes];
  if (write.reason) messageParts.push(write.reason);
  if (detection.confidence === 'low') {
    messageParts.push('Matched by a structural fallback; confirm this is the right ACE field.');
  }
  if (write.selectedText) messageParts.push(`Selected "${write.selectedText}".`);

  return {
    ...base,
    status,
    original,
    written: finalValue,
    transform: combinedTransform,
    matchedWith: detection.matchedWith,
    confidence: detection.confidence,
    ...(messageParts.length ? { message: messageParts.join(' ') } : {}),
  };
}
