/**
 * The review gate, as text.
 *
 * The extension's preview (src/ui/preview.ts) shows traffic lights and
 * "original -> ACE" for a spreadsheet import. This is the same idea for the
 * QuickBooks path, before a workbook is written: what will be filed, what it
 * looked like in QuickBooks, and - the part the spreadsheet path does not need
 * - *who* supplied each value.
 *
 * Nothing here invents or fills anything. A missing Schedule B prints as
 * missing.
 */

import type { CanonicalShipment } from '../../../src/models/CanonicalInvoice.js';
import { statusForField, type ValidationResult } from '../../../src/excel/validator.js';
import { formatWithSeparators } from '../../../src/ace/transformers/numbers.js';
import type { CanonicalMapping, FieldOrigin, OriginIndex } from '../mapping/types.js';
import type { InvoiceSummary } from '../adapter/InvoiceSourceAdapter.js';

export interface PreviewStyle {
  /** Plain ASCII markers, for consoles that mangle box-drawing and check marks. */
  ascii?: boolean;
}

interface Markers {
  ok: string;
  warn: string;
  bad: string;
}

function markers(style: PreviewStyle): Markers {
  return style.ascii ? { ok: '[ok]', warn: '[! ]', bad: '[XX]' } : { ok: '✓', warn: '⚠', bad: '✗' };
}

const INVOICE_LABELS: Record<string, string> = {
  invoiceNumber: 'Invoice Number',
  invoiceDate: 'Invoice Date',
  customerName: 'Customer',
  billTo: 'Bill To',
  poNumber: 'PO Number',
  freightTerms: 'Freight Terms',
  paymentTerms: 'Payment Terms',
  paymentDueDate: 'Payment Due',
  carrier: 'Carrier',
  vessel: 'Vessel',
  bookingNumber: 'Booking',
  containerNumber: 'Container',
  sealNumber: 'Seal',
  destination: 'Destination',
};

const COMMODITY_LABELS: Record<string, string> = {
  exportInformationCode: 'Export Info Code',
  scheduleB: 'Schedule B',
  description: 'Description',
  quantity1: 'Quantity 1',
  uom1: 'UOM 1',
  quantity2: 'Quantity 2',
  uom2: 'UOM 2',
  origin: 'Origin',
  valueOfGoods: 'Value of Goods',
  shippingWeight: 'Shipping Weight',
  eccn: 'ECCN',
  licenseCode: 'License Code',
};

const ORIGIN_LABELS: Record<FieldOrigin, string> = {
  quickbooks: 'QuickBooks',
  'custom-field': 'custom field',
  derived: 'derived',
  manual: 'you supplied',
  default: 'config default',
  missing: '-',
};

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

interface Row {
  marker: string;
  label: string;
  value: string;
  origin: string;
  detail: string;
}

/** Widest a value may be before it moves to its own line, keeping columns aligned. */
const VALUE_WIDTH = 44;

function renderRows(rows: Row[], indent = '  '): string[] {
  if (!rows.length) return [`${indent}(nothing)`];
  const labelWidth = Math.max(...rows.map((row) => row.label.length));
  const valueWidth = Math.min(Math.max(...rows.map((row) => row.value.length)), VALUE_WIDTH);
  const originWidth = Math.max(...rows.map((row) => row.origin.length));

  const out: string[] = [];
  for (const row of rows) {
    // A long value would push every column after it out of line. It is shown
    // in full underneath instead of being truncated: this is the review gate,
    // so nothing may be hidden here.
    const long = row.value.length > valueWidth;
    const shown = long ? `${row.value.slice(0, valueWidth - 1)}\u2026` : row.value;
    out.push(
      `${indent}${row.marker} ${pad(row.label, labelWidth)}  ${pad(shown, valueWidth)}  ${pad(row.origin, originWidth)}  ${row.detail}`.trimEnd(),
    );
    if (long) out.push(`${indent}  ${' '.repeat(labelWidth)}  ${row.value}`);
  }
  return out;
}

function displayValue(value: string | number | null, field: string): string {
  if (value === null || value === '') return '(blank)';
  if (typeof value === 'number') {
    if (field === 'shippingWeight') return `${formatWithSeparators(value)} kg`;
    if (field === 'valueOfGoods') return formatWithSeparators(value, 2);
    return formatWithSeparators(value);
  }
  return value;
}

function markerFor(
  validation: ValidationResult,
  field: string,
  line: number | undefined,
  transformed: boolean,
  origin: FieldOrigin,
  mark: Markers,
): string {
  if (origin === 'missing') {
    // A blank field is only an error if validation says so; many are optional.
    const status = statusForField(validation.issues, field, line, false);
    return status === 'red' ? mark.bad : status === 'yellow' ? mark.warn : mark.ok;
  }
  const status = statusForField(validation.issues, field, line, transformed);
  return status === 'red' ? mark.bad : status === 'yellow' ? mark.warn : mark.ok;
}

/**
 * What to show on the right. When the value changed on the way in, the
 * arrow - "176000 lb -> lb x 0.45359237" - is the interesting fact. When it did
 * not, the interesting fact is which qbXML element it came out of.
 */
function detailFor(
  shipment: CanonicalShipment,
  scope: 'invoice' | number,
  field: string,
  source: string,
  origin: FieldOrigin,
): string {
  if (origin !== 'derived') return source;
  const record =
    scope === 'invoice' ? shipment.provenance.invoice[field] : shipment.provenance.commodities[scope]?.[field];
  if (!record || !record.transform) return source;
  return `${record.original} -> ${record.transform}`;
}

export function renderPreview(mapping: CanonicalMapping, validation: ValidationResult, style: PreviewStyle = {}): string {
  const mark = markers(style);
  const { shipment, origins } = mapping;
  const lines: string[] = [];

  lines.push('ACE Export Helper');
  lines.push(`Source: ${shipment.source.fileName}`);
  lines.push('');
  lines.push('Invoice');

  const invoiceRows: Row[] = Object.keys(INVOICE_LABELS).map((field) => {
    const source = origins.invoice[field] ?? { origin: 'missing' as FieldOrigin, source: '' };
    const value = (shipment.invoice as unknown as Record<string, string>)[field] ?? '';
    return {
      marker: markerFor(validation, field, undefined, source.origin === 'derived', source.origin, mark),
      label: INVOICE_LABELS[field] as string,
      value: displayValue(value, field),
      origin: ORIGIN_LABELS[source.origin],
      detail: detailFor(shipment, 'invoice', field, source.source, source.origin),
    };
  });
  lines.push(...renderRows(invoiceRows));

  for (const commodity of shipment.commodities) {
    lines.push('');
    lines.push(`Commodity line ${commodity.line}`);
    const lineOrigins: OriginIndex['commodities'][number] = origins.commodities[commodity.line] ?? {};
    const rows: Row[] = Object.keys(COMMODITY_LABELS).map((field) => {
      const source = lineOrigins[field] ?? { origin: 'missing' as FieldOrigin, source: '' };
      const value = (commodity as unknown as Record<string, string | number | null>)[field] ?? null;
      return {
        marker: markerFor(validation, field, commodity.line, source.origin === 'derived', source.origin, mark),
        label: COMMODITY_LABELS[field] as string,
        value: displayValue(value, field),
        origin: ORIGIN_LABELS[source.origin],
        detail: detailFor(shipment, commodity.line, field, source.source, source.origin),
      };
    });
    lines.push(...renderRows(rows));
  }

  lines.push('');
  lines.push(...renderChecklist(mapping, validation, style));

  const problems = validation.issues.filter((issue) => issue.severity === 'error');
  const warnings = validation.issues.filter((issue) => issue.severity === 'warning');

  if (problems.length) {
    lines.push('');
    lines.push('Errors - ACE will reject these:');
    for (const issue of problems) {
      lines.push(`  ${mark.bad} ${issue.line ? `line ${issue.line}: ` : ''}${issue.message}`);
    }
  }
  if (warnings.length) {
    lines.push('');
    lines.push('Warnings - check before filing:');
    for (const issue of warnings) {
      lines.push(`  ${mark.warn} ${issue.line ? `line ${issue.line}: ` : ''}${issue.message}`);
    }
  }

  const notes = mapping.notes.filter((note) => note.severity !== 'error');
  if (notes.length) {
    lines.push('');
    lines.push('Mapping notes:');
    for (const note of notes) {
      lines.push(`  - ${note.line ? `line ${note.line}: ` : ''}${note.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * The short "is this exportable?" list. Deliberately the same six facts every
 * time, so an operator learns where to look instead of reading a wall of text.
 */
export function renderChecklist(
  mapping: CanonicalMapping,
  validation: ValidationResult,
  style: PreviewStyle = {},
): string[] {
  const mark = markers(style);
  const { invoice, commodities } = mapping.shipment;

  const check = (label: string, ok: boolean, detail: string): string =>
    `  ${ok ? mark.ok : mark.warn} ${pad(label, 22)} ${detail}`;

  const totalValue = commodities.reduce((sum, line) => sum + (line.valueOfGoods ?? 0), 0);
  const totalWeight = commodities.reduce((sum, line) => sum + (line.shippingWeight ?? 0), 0);
  const describedLines = commodities.filter((line) => line.description.trim() !== '').length;

  const lines = ['Ready to export?'];
  lines.push(check('Invoice number', invoice.invoiceNumber.trim() !== '', invoice.invoiceNumber || 'missing'));
  lines.push(check('Customer', invoice.customerName.trim() !== '', invoice.customerName || 'missing'));
  lines.push(check('Invoice date', /^\d{4}-\d{2}-\d{2}$/.test(invoice.invoiceDate), invoice.invoiceDate || 'missing'));
  lines.push(
    check(
      'Commodity description',
      describedLines === commodities.length && commodities.length > 0,
      `${describedLines}/${commodities.length} line(s) described`,
    ),
  );
  lines.push(
    check(
      'Amount',
      commodities.length > 0 && commodities.every((line) => line.valueOfGoods !== null),
      `${formatWithSeparators(totalValue, 2)} total`,
    ),
  );
  lines.push(
    check(
      'Weight',
      commodities.length > 0 && commodities.every((line) => line.shippingWeight !== null),
      `${formatWithSeparators(totalWeight)} kg total`,
    ),
  );

  // The three ACE-only facts QuickBooks never holds. Called out separately
  // because "QuickBooks was fine" and "the filing is complete" are different.
  const missingScheduleB = commodities.filter((line) => line.scheduleB.trim() === '').map((line) => line.line);
  const missingOrigin = commodities.filter((line) => line.origin.trim() === '').map((line) => line.line);
  const missingLicence = commodities.filter((line) => line.licenseCode.trim() === '').map((line) => line.line);

  if (missingScheduleB.length) lines.push(`  ${mark.warn} Schedule B missing    line(s) ${missingScheduleB.join(', ')}`);
  if (missingOrigin.length) lines.push(`  ${mark.warn} Origin not set        line(s) ${missingOrigin.join(', ')}`);
  if (missingLicence.length) lines.push(`  ${mark.warn} License Code not set  line(s) ${missingLicence.join(', ')}`);

  lines.push('');
  lines.push(
    validation.errors > 0
      ? `  ${validation.errors} error(s), ${validation.warnings} warning(s). The workbook can still be written; ACE will reject the flagged fields.`
      : `  0 errors, ${validation.warnings} warning(s).`,
  );

  return lines;
}

export function renderInvoiceList(summaries: InvoiceSummary[]): string {
  if (!summaries.length) return 'No invoices matched.';
  const header = ['Invoice', 'Date', 'Customer', 'Total', 'TxnID'];
  const rows = summaries.map((summary) => [
    summary.reference || '(none)',
    summary.date,
    summary.customerName,
    summary.total === null ? '' : formatWithSeparators(summary.total, 2),
    summary.id,
  ]);
  const widths = header.map((label, index) =>
    Math.max(label.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, index) => pad(cell, widths[index] as number)).join('  ').trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}
