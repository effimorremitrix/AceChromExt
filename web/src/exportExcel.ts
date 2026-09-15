/**
 * The ACE workbook, from the dashboard.
 *
 * The Shipment sheet is written by the QuickBooks companion's own row builder
 * (`buildShipmentRows`), so the column layout exists once and the ACE Helper
 * reads this file exactly as it reads `ACE_Invoice_<n>.xlsx`. The Checks
 * sheet is the companion's too. What differs is the third sheet: a
 * Provenance sheet listing where each package value came from, under its own
 * banner, so the ACE Helper labels the file an Excel workbook rather than a
 * QuickBooks export (the QuickBooks source is claimed by the Audit sheet's
 * banner, which this file deliberately does not carry).
 *
 * Everything runs in the browser; the bytes go to a download and nowhere else.
 */

import * as XLSX from 'xlsx';
import { buildShipmentRows, checkRows, sanitizeFileNamePart } from '../../companion/src/excel/aceWorkbook.js';
import type { CanonicalShipment } from '../../src/models/CanonicalInvoice.js';
import type { ValidationResult } from '../../src/excel/validator.js';
import type { ProvenanceRow } from './readiness.js';

export const DASHBOARD_WORKBOOK_BANNER = 'ACE Helper - operator dashboard export';

type Cell = string | number;

function provenanceSheet(rows: ProvenanceRow[], sourceLabel: string, exportedAt: string): Cell[][] {
  const out: Cell[][] = [
    [DASHBOARD_WORKBOOK_BANNER, ''],
    ['Source', sourceLabel],
    ['Exported', exportedAt],
    ['', ''],
    ['Scope', 'Field', 'Value', 'Source', 'Detail', 'Original', 'Transformation'],
  ];
  for (const item of rows) out.push([item.where, item.label, item.value, item.description, item.detail, item.original, item.transform]);
  return out;
}

function widths(rows: Cell[][], max: number): XLSX.ColInfo[] {
  const out: number[] = [];
  for (const line of rows) line.forEach((cell, index) => { out[index] = Math.max(out[index] ?? 10, Math.min(String(cell ?? '').length + 2, max)); });
  return out.map((wch) => ({ wch }));
}

export interface WorkbookExport {
  bytes: Uint8Array;
  fileName: string;
}

export function buildDashboardWorkbook(
  shipment: CanonicalShipment,
  validation: ValidationResult,
  provenance: ProvenanceRow[],
  sourceLabel: string,
  now: Date = new Date(),
): WorkbookExport {
  const workbook = XLSX.utils.book_new();

  const shipmentRows = buildShipmentRows(shipment, { weightUom: 'kg', includeAuditSheet: false });
  const shipmentSheet = XLSX.utils.aoa_to_sheet(shipmentRows);
  shipmentSheet['!cols'] = widths(shipmentRows, 34);
  shipmentSheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, shipmentSheet, 'Shipment');

  const provenanceRows = provenanceSheet(provenance, sourceLabel, now.toISOString());
  const provenanceOut = XLSX.utils.aoa_to_sheet(provenanceRows);
  provenanceOut['!cols'] = widths(provenanceRows, 60);
  XLSX.utils.book_append_sheet(workbook, provenanceOut, 'Provenance');

  const checks = checkRows(validation);
  const checksSheet = XLSX.utils.aoa_to_sheet(checks);
  checksSheet['!cols'] = widths(checks, 90);
  XLSX.utils.book_append_sheet(workbook, checksSheet, 'Checks');

  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const stem = sanitizeFileNamePart(shipment.invoice.invoiceNumber) || 'shipment';
  return { bytes: new Uint8Array(buffer), fileName: `ACE_Invoice_${stem}.xlsx` };
}
