/**
 * The invoice-source abstraction.
 *
 * Phase 1 had one producer of the canonical model: a spreadsheet. Phase 2 adds
 * a second, and there will be a third. This interface is the seam, and it is
 * deliberately written in *shipping* words, not QuickBooks words: nothing here
 * mentions qbXML, TxnID, or DataExt. A future NetSuite or Sage adapter
 * implements the same four methods and every layer above it - preview,
 * validation, workbook, CLI, GUI - works unchanged.
 *
 *   listInvoices        which invoices could I export?
 *   getInvoice          give me one, in the source's own shape
 *   toCanonicalInvoice  translate it, and say where each value came from
 *   exportAceExcel      write the workbook the extension reads
 */

import type { ValidationResult } from '../../../src/excel/validator.js';
import type { CanonicalMapping } from '../mapping/types.js';

/** Enough to choose an invoice, without fetching its lines. */
export interface InvoiceSummary {
  /** Opaque, stable identifier in the source system. */
  id: string;
  /** What a human calls it: the invoice number. */
  reference: string;
  /** YYYY-MM-DD. */
  date: string;
  customerName: string;
  total: number | null;
  lineCount: number | null;
}

/**
 * One invoice, still in the source system's own shape. `raw` is deliberately
 * untyped at this level: only the adapter that produced it may interpret it.
 */
export interface SourceInvoice<TRaw = unknown> {
  summary: InvoiceSummary;
  raw: TRaw;
}

export interface InvoiceListQuery {
  /** Exact invoice number. */
  reference?: string;
  /** Substring of the invoice number. */
  referenceContains?: string;
  customerName?: string;
  /** YYYY-MM-DD, inclusive. */
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

/** The answer to "is the source reachable, and what is it?". */
export interface AdapterProbe {
  ok: boolean;
  /** Human-readable identification of what answered, or why nothing did. */
  description: string;
  details: Record<string, string>;
}

export interface ExportRequest {
  mapping: CanonicalMapping;
  validation: ValidationResult;
  /** Directory to write into. Created if missing. */
  directory?: string;
  /** Overrides the configured file-name pattern. */
  fileName?: string;
  /** Refuse to replace an existing file. Default true. */
  failIfExists?: boolean;
}

export interface ExportResult {
  path: string;
  fileName: string;
  bytes: number;
}

export interface InvoiceSourceAdapter<TRaw = unknown> {
  /** Stable identifier, e.g. 'quickbooks-desktop'. */
  readonly id: string;
  /** What to show a user, e.g. 'QuickBooks Desktop (qbXML 16.0)'. */
  readonly label: string;

  probe(): Promise<AdapterProbe>;
  listInvoices(query?: InvoiceListQuery): Promise<InvoiceSummary[]>;
  getInvoice(invoiceId: string): Promise<SourceInvoice<TRaw>>;
  toCanonicalInvoice(invoice: SourceInvoice<TRaw>, options?: ToCanonicalOptions): CanonicalMapping;
  exportAceExcel(request: ExportRequest): Promise<ExportResult>;
  close(): Promise<void>;
}

export interface ToCanonicalOptions {
  /** Field values the operator supplied for this export only. */
  overrides?: Record<string, string>;
}

export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
  }
}

/** Raised when a lookup matched nothing, so callers can say so rather than crash. */
export class InvoiceNotFoundError extends AdapterError {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceNotFoundError';
  }
}
