/**
 * Writing the workbook to disk.
 *
 * Kept out of the adapter because it has nothing to do with QuickBooks: any
 * source that produces a CanonicalMapping exports through this function.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { ValidationResult } from '../../../src/excel/validator.js';
import type { CanonicalMapping } from '../mapping/types.js';
import { aceFileName, buildAceWorkbook, type WorkbookOptions } from './aceWorkbook.js';
import type { ExportResult } from '../adapter/InvoiceSourceAdapter.js';

export interface WriteAceWorkbookOptions extends WorkbookOptions {
  directory: string;
  /** Either a literal file name, or a pattern containing {refNumber} etc. */
  fileNameOrPattern: string;
  failIfExists?: boolean;
  validation?: ValidationResult;
}

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

export function writeAceWorkbook(mapping: CanonicalMapping, options: WriteAceWorkbookOptions): ExportResult {
  const { invoice } = mapping.shipment;
  const fileName = aceFileName(options.fileNameOrPattern, {
    refNumber: invoice.invoiceNumber,
    txnId: mapping.shipment.source.fileName,
    date: invoice.invoiceDate,
    customer: invoice.customerName,
  });

  const directory = isAbsolute(options.directory) ? options.directory : resolve(process.cwd(), options.directory);
  mkdirSync(directory, { recursive: true });

  const path = join(directory, fileName);
  if (options.failIfExists !== false && existsSync(path)) {
    throw new ExportError(`"${path}" already exists. Move it, or pass --force to replace it.`);
  }

  const bytes = buildAceWorkbook(mapping.shipment, mapping.origins, {
    weightUom: options.weightUom,
    includeAuditSheet: options.includeAuditSheet,
    ...(options.validation ? { validation: options.validation } : {}),
    ...(options.generatedBy ? { generatedBy: options.generatedBy } : {}),
  });

  writeFileSync(path, bytes);
  return { path, fileName, bytes: bytes.byteLength };
}
