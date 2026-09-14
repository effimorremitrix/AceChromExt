/**
 * Preview rendering.
 *
 * Nothing is written to ACE until the user clicks a Fill button, so this view
 * is the review gate. Every field shows its traffic light, and anything that
 * was transformed shows the original alongside the ACE value.
 */

import type { CanonicalCommodity, CanonicalShipment, FieldProvenance } from '../models/CanonicalInvoice.js';
import { COMMODITY_FIELDS, INVOICE_FIELDS } from '../models/CanonicalInvoice.js';
import { formatWithSeparators } from '../ace/transformers/numbers.js';
import { normalizeDate } from '../ace/transformers/dates.js';
import { statusForField, type ValidationIssue, type ValidationResult } from '../excel/validator.js';

export const INVOICE_LABELS: Record<string, string> = {
  invoiceNumber: 'Invoice Number',
  invoiceDate: 'Invoice Date',
  customerName: 'Customer Name',
  billTo: 'Bill To',
  billToAddress2: 'Bill To (line 2)',
  billToCity: 'City',
  billToState: 'State',
  billToPostalCode: 'Postal Code',
  billToCountry: 'Consignee Country',
  poNumber: 'PO Number',
  freightTerms: 'Freight Terms',
  paymentTerms: 'Payment Terms',
  paymentDueDate: 'Payment Due Date',
  carrier: 'Carrier',
  vessel: 'Vessel',
  bookingNumber: 'Booking Number',
  containerNumber: 'Container Number',
  sealNumber: 'Seal Number',
  destination: 'Destination',
};

export const COMMODITY_LABELS: Record<string, string> = {
  exportInformationCode: 'Export Information Code',
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

export interface PreviewCell {
  field: string;
  label: string;
  /** Value as it will go into ACE (display-formatted). */
  aceValue: string;
  /** Cell content from the spreadsheet, when it differed. */
  original: string;
  transform: string | null;
  status: 'green' | 'yellow' | 'red';
  messages: string[];
}

export interface CommodityPreview {
  line: number;
  /** 1-based spreadsheet row, when known. */
  cells: PreviewCell[];
  status: 'green' | 'yellow' | 'red';
}

export interface ShipmentPreview {
  invoiceCells: PreviewCell[];
  commodities: CommodityPreview[];
  status: 'green' | 'yellow' | 'red';
}

function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (field === 'quantity1' || field === 'quantity2') return formatWithSeparators(Number(value));
  if (field === 'valueOfGoods') return formatWithSeparators(Number(value), 2);
  if (field === 'shippingWeight') return `${formatWithSeparators(Number(value))} kg`;
  if (field === 'invoiceDate' || field === 'paymentDueDate') {
    const normalized = normalizeDate(String(value));
    return normalized.ok ? normalized.ace : String(value);
  }
  return String(value);
}

function messagesFor(issues: ValidationIssue[], field: string, line: number | undefined): string[] {
  return issues.filter((issue) => issue.field === field && issue.line === line).map((issue) => issue.message);
}

function buildCell(
  field: string,
  label: string,
  value: unknown,
  provenance: FieldProvenance | undefined,
  issues: ValidationIssue[],
  line: number | undefined,
): PreviewCell {
  const aceValue = displayValue(field, value);
  const transform = provenance?.transform ?? null;
  const original = provenance?.original ?? '';
  const showOriginal = original !== '' && (transform !== null || original !== aceValue);

  return {
    field,
    label,
    aceValue,
    original: showOriginal ? original : '',
    transform,
    status: statusForField(issues, field, line, transform !== null),
    messages: messagesFor(issues, field, line),
  };
}

function worst(statuses: Array<'green' | 'yellow' | 'red'>): 'green' | 'yellow' | 'red' {
  if (statuses.includes('red')) return 'red';
  if (statuses.includes('yellow')) return 'yellow';
  return 'green';
}

export function buildPreview(shipment: CanonicalShipment, validation: ValidationResult): ShipmentPreview {
  const invoiceCells = INVOICE_FIELDS.map((field) =>
    buildCell(
      field,
      INVOICE_LABELS[field] ?? field,
      shipment.invoice[field],
      shipment.provenance.invoice[field],
      validation.issues.filter((issue) => issue.scope === 'shipment'),
      undefined,
    ),
  );

  const commodities: CommodityPreview[] = shipment.commodities.map((commodity: CanonicalCommodity) => {
    const lineProvenance = shipment.provenance.commodities[commodity.line] ?? {};
    const lineIssues = validation.issues.filter((issue) => issue.line === commodity.line);
    const cells = COMMODITY_FIELDS.map((field) =>
      buildCell(
        field,
        COMMODITY_LABELS[field] ?? field,
        commodity[field],
        lineProvenance[field],
        lineIssues,
        commodity.line,
      ),
    );
    return { line: commodity.line, cells, status: worst(cells.map((cell) => cell.status)) };
  });

  return {
    invoiceCells,
    commodities,
    status: worst([...invoiceCells.map((cell) => cell.status), ...commodities.map((line) => line.status)]),
  };
}

/** Compact one-line summary, e.g. "3 lines - 1 error, 2 warnings". */
export function summarize(validation: ValidationResult, lineCount: number): string {
  const parts = [`${lineCount} line${lineCount === 1 ? '' : 's'}`];
  if (validation.errors) parts.push(`${validation.errors} error${validation.errors === 1 ? '' : 's'}`);
  if (validation.warnings) parts.push(`${validation.warnings} warning${validation.warnings === 1 ? '' : 's'}`);
  if (!validation.errors && !validation.warnings) parts.push('no issues');
  return parts.join(' - ');
}
