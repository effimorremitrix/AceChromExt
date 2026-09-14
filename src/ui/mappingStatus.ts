/**
 * The mapping status screen.
 *
 * One row per ACE field, answering the six questions somebody asks when a
 * value looks wrong:
 *
 *   Source            where the number came from   QuickBooks export - ShippingWeight
 *   Original Value    what it looked like there    176000 lb
 *   Transformed       what was done to it          lb x 0.45359237
 *   ACE value         what will be typed           79832
 *   ACE Field         which box                    Shipping Weight (kg)
 *   ACE Selector      how that box is found        #shippingWeight
 *   Status            whether it is ready          READY
 *
 * It is built in two stages so it works with no ACE tab open. The offline
 * stage knows everything except whether the field exists on the page; a
 * dry-run fill report (which writes nothing) then fills in the selector that
 * actually matched and upgrades or downgrades the status.
 */

import { ALL_MAPPINGS } from '../ace/mappings/index.js';
import { describeCandidate } from '../ace/selectors/types.js';
import { runTransforms } from '../ace/transformers/index.js';
import { truncate } from '../ace/transformers/text.js';
import type { AceFieldMapping, AceFieldScope, AcePageId, FillReport } from '../models/AceField.js';
import type { CanonicalCommodity, CanonicalShipment } from '../models/CanonicalInvoice.js';
import type { AceHelperSettings } from '../core/settings.js';
import type { SourceDescriptor } from '../sources/InvoiceDataSource.js';

export type MappingStatus =
  /** Value present, transforms clean, and the ACE field was found. */
  | 'READY'
  /** Value present and valid, but nobody has checked the ACE page yet. */
  | 'NOT CHECKED'
  /** Written, but something about it wants a human eye. */
  | 'REVIEW'
  /** No value in the imported data for a field ACE expects. */
  | 'MISSING'
  /** The value cannot be turned into something ACE accepts. */
  | 'ERROR'
  /** The ACE field could not be found on the page that was checked. */
  | 'NOT FOUND'
  /** Several ACE fields matched; deliberately not written. */
  | 'AMBIGUOUS'
  /** Optional field with no value. Nothing to do. */
  | 'EMPTY';

export interface MappingStatusRow {
  key: string;
  page: AcePageId;
  scope: AceFieldScope;
  /** Commodity line, for commodityLine scope. */
  line?: number;
  source: string;
  original: string;
  transform: string | null;
  aceValue: string;
  aceField: string;
  selector: string;
  status: MappingStatus;
  message?: string;
}

export interface MappingStatusOptions {
  settings: AceHelperSettings;
  /** Commodity line the line-scoped rows describe. */
  line: number;
  /** Where the data came from, used to word the Source column. */
  source?: SourceDescriptor | undefined;
}

function canonicalField(mapping: AceFieldMapping): string {
  return mapping.source.split('.')[1] ?? mapping.source;
}

function readValue(
  mapping: AceFieldMapping,
  shipment: CanonicalShipment,
  commodity: CanonicalCommodity | null,
): unknown {
  const field = canonicalField(mapping);
  if (mapping.scope === 'shipment') {
    return (shipment.invoice as unknown as Record<string, unknown>)[field] ?? null;
  }
  if (!commodity) return null;
  return (commodity as unknown as Record<string, unknown>)[field] ?? null;
}

/**
 * The Source column.
 *
 * Provenance records the column or qbXML element the value came out of; the
 * source descriptor says which system that was. Both together is what makes
 * "QuickBooks export - InvoiceLineRet/Quantity" readable a week later.
 */
function describeSource(
  mapping: AceFieldMapping,
  shipment: CanonicalShipment,
  commodity: CanonicalCommodity | null,
  descriptor: SourceDescriptor | undefined,
): string {
  const field = canonicalField(mapping);
  const record =
    mapping.scope === 'shipment'
      ? shipment.provenance.invoice[field]
      : commodity
        ? shipment.provenance.commodities[commodity.line]?.[field]
        : undefined;
  const where = record?.column ?? '';
  const system = descriptor?.label ?? 'Imported data';
  return where === '' ? system : `${system} - ${where}`;
}

function originalValue(
  mapping: AceFieldMapping,
  shipment: CanonicalShipment,
  commodity: CanonicalCommodity | null,
): { original: string; transform: string | null } {
  const field = canonicalField(mapping);
  const record =
    mapping.scope === 'shipment'
      ? shipment.provenance.invoice[field]
      : commodity
        ? shipment.provenance.commodities[commodity.line]?.[field]
        : undefined;
  return { original: record?.original ?? '', transform: record?.transform ?? null };
}

/** Every mapped ACE field, with everything that can be known without the page. */
export function buildMappingStatus(shipment: CanonicalShipment, options: MappingStatusOptions): MappingStatusRow[] {
  const commodity = shipment.commodities.find((item) => item.line === options.line) ?? shipment.commodities[0] ?? null;

  return ALL_MAPPINGS.map((mapping) => {
    const value = readValue(mapping, shipment, commodity);
    const { original, transform: importTransform } = originalValue(mapping, shipment, commodity);

    const row: MappingStatusRow = {
      key: mapping.key,
      page: mapping.page,
      scope: mapping.scope,
      ...(mapping.scope === 'commodityLine' && commodity ? { line: commodity.line } : {}),
      source: describeSource(mapping, shipment, commodity, options.source),
      original,
      transform: importTransform,
      aceValue: '',
      aceField: mapping.label,
      selector: describeCandidate(mapping.candidates),
      status: 'NOT CHECKED',
    };

    const empty = value === null || value === undefined || String(value).trim() === '';
    if (empty) {
      row.status = mapping.expected ? 'MISSING' : 'EMPTY';
      row.message = mapping.expected
        ? 'ACE expects this field and the imported data has no value for it.'
        : 'Optional, and not supplied.';
      return row;
    }

    const transformed = runTransforms(value, mapping.transforms, { settings: options.settings });
    if (transformed.error) {
      row.status = 'ERROR';
      row.message = transformed.error;
      return row;
    }

    const { value: finalValue, truncated } = truncate(transformed.text, mapping.maxLength);
    row.aceValue = finalValue;
    row.transform = [importTransform, transformed.transform].filter(Boolean).join('; ') || null;

    const notes = [...transformed.notes];
    if (truncated) notes.push(`Truncated to ${mapping.maxLength} characters for ACE.`);
    if (notes.length) {
      row.status = 'REVIEW';
      row.message = notes.join(' ');
    }
    return row;
  });
}

/**
 * Fold a dry-run fill report into the rows.
 *
 * The report is authoritative about the page - it is the only thing that has
 * actually looked at the DOM - so it replaces the selector and the status for
 * every field it covers, and leaves the others as they were.
 */
export function applyFillReport(rows: MappingStatusRow[], report: FillReport): MappingStatusRow[] {
  const byKey = new Map(report.outcomes.map((outcome) => [outcome.key, outcome]));

  return rows.map((row) => {
    if (row.page !== report.page || row.scope !== report.scope) return row;
    const outcome = byKey.get(row.key);
    if (!outcome) return row;

    const next: MappingStatusRow = { ...row };
    if (outcome.selector) next.selector = outcome.selector;
    if (outcome.message) next.message = outcome.message;

    switch (outcome.status) {
      case 'filled':
        next.status = 'READY';
        break;
      case 'transformed':
        next.status = row.status === 'REVIEW' ? 'REVIEW' : 'READY';
        break;
      case 'error':
        next.status = 'ERROR';
        break;
      case 'warning':
        // A warning from the filler is either "no value" or "no field". The
        // two are different problems and must not read alike.
        next.status =
          outcome.confidence === 'none' && outcome.matchedWith
            ? 'AMBIGUOUS'
            : outcome.written === undefined
              ? 'MISSING'
              : 'NOT FOUND';
        break;
      case 'skipped':
      default:
        // A derived field that agrees with ACE is as good as filled.
        next.status = outcome.aceDerived ? 'READY' : row.status === 'NOT CHECKED' ? 'EMPTY' : row.status;
        break;
    }
    return next;
  });
}

export interface MappingStatusSummary {
  total: number;
  ready: number;
  review: number;
  blocked: number;
}

export function summarizeMappingStatus(rows: MappingStatusRow[]): MappingStatusSummary {
  const blocked = rows.filter((row) => row.status === 'ERROR' || row.status === 'AMBIGUOUS' || row.status === 'NOT FOUND').length;
  return {
    total: rows.length,
    ready: rows.filter((row) => row.status === 'READY').length,
    review: rows.filter((row) => row.status === 'REVIEW' || row.status === 'MISSING').length,
    blocked,
  };
}

/** The screen as plain text, for "Copy diagnostics". */
export function formatMappingStatus(rows: MappingStatusRow[]): string {
  const header = ['Field', 'Source', 'Original', 'Transformation', 'ACE value', 'ACE field', 'Selector', 'Status'];
  const body = rows.map((row) => [
    row.key,
    row.source,
    row.original || '-',
    row.transform ?? '-',
    row.aceValue || '-',
    row.aceField,
    row.selector,
    row.status,
  ]);
  const widths = header.map((label, index) => Math.max(label.length, ...body.map((cells) => (cells[index] ?? '').length)));
  const line = (cells: string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] as number)).join('  ').trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...body.map(line)].join('\n');
}
