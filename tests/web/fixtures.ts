/**
 * Inputs for the dashboard tests, built from the repository's own fixtures:
 * the qbXML invoice CN-1042 turned into the companion's workbook (exactly
 * the file an operator brings from the QuickBooks PC), a hand-filled
 * template workbook, and the sanitized Deckhand emails.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

import { QuickBooksDesktopAdapter } from '../../companion/src/adapter/QuickBooksDesktopAdapter.js';
import { FileQbxmlTransport } from '../../companion/src/transport/FileTransport.js';
import { normalizeConfig, starterConfig } from '../../companion/src/config.js';
import { buildAceWorkbook } from '../../companion/src/excel/aceWorkbook.js';
import { TEMPLATE_COLUMNS } from '../../src/excel/columnAliases.js';

export const FIXTURES = join(__dirname, '..', 'fixtures');
export const NOW = new Date('2026-09-15T09:00:00Z');

export function deckhandText(name: string): string {
  return readFileSync(join(FIXTURES, 'deckhand', name), 'utf8');
}

export interface QuickBooksWorkbook {
  bytes: Uint8Array;
  fileName: string;
}

/** ACE_Invoice_CN-1042.xlsx as `ace-export export CN-1042` writes it, with the booking and vessel supplied at export time. */
export async function quickBooksWorkbook(overrides: Record<string, string> = { bookingNumber: 'EBKG18531408', vessel: 'MSC FIRENZE V.541W' }): Promise<QuickBooksWorkbook> {
  const adapter = new QuickBooksDesktopAdapter(FileQbxmlTransport.fromFile(join(FIXTURES, 'qbxml', 'invoice-single-line.xml')), normalizeConfig(starterConfig()));
  const invoice = await adapter.getInvoice('CN-1042');
  const mapping = adapter.toCanonicalInvoice(invoice, { overrides });
  const bytes = buildAceWorkbook(mapping.shipment, mapping.origins, { weightUom: 'lb', includeAuditSheet: true, generatedBy: adapter.label });
  await adapter.close();
  return { bytes, fileName: 'ACE_Invoice_CN-1042.xlsx' };
}

const HAND_ROW: Array<string | number> = [
  1, 'OS', '0802.12.0000', 'SHELLED ALMONDS', 79832, 'KG', '', '', 'D', 651217.6, 176000, 'lb', 'EAR99', 'C33',
  'Aydin Kuruyemis San Ve Tic A.S', 'CN-1042', '2026-09-21', 'Organize Sanayi Bolgesi 3. Cadde No 14', '', 'Aydin', '', '09100', 'TR', 'CIF', 'NET 120', '2027-01-19',
  '3993', 'MSC Line', 'MSC FIRENZE V.541W', 'EBKG18531408', 'MSCU1234566', 'SL-4471209', 'TR',
];

/** The template, filled in by hand: the Phase 1 input. */
export function handFilledWorkbook(row: Array<string | number> = HAND_ROW): QuickBooksWorkbook {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS, row]), 'Shipment');
  return { bytes: new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer), fileName: 'My ACE Shipment.xlsx' };
}

export function handRow(changes: Record<number, string | number>): Array<string | number> {
  const row = [...HAND_ROW];
  for (const [index, value] of Object.entries(changes)) row[Number(index)] = value;
  return row;
}
