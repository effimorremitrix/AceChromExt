/**
 * QuickBooks Desktop, through the SDK's qbXML request processor.
 *
 * The adapter owns the QuickBooks vocabulary and nothing else: it builds
 * requests, hands them to a transport, parses responses, and delegates the
 * translation to `mapping/qbToCanonical.ts`. Swap the transport and the same
 * adapter runs against a live company file, a saved response, or a fixture.
 */

import type { AceExportConfig } from '../config.js';
import { mapQbInvoiceToCanonical } from '../mapping/qbToCanonical.js';
import type { CanonicalMapping } from '../mapping/types.js';
import { writeAceWorkbook } from '../excel/exportAce.js';
import {
  parseHostQueryResponse,
  parseInvoiceQueryResponse,
  parseInvoiceQuerySummaries,
} from '../qbxml/parse.js';
import {
  buildHostQuery,
  buildInvoiceQuery,
  type InvoiceQuerySpec,
} from '../qbxml/requests.js';
import type { QbInvoice } from '../qbxml/types.js';
import type { QbxmlTransport } from '../transport/QbxmlTransport.js';
import {
  AdapterError,
  InvoiceNotFoundError,
  type AdapterProbe,
  type ExportRequest,
  type ExportResult,
  type InvoiceListQuery,
  type InvoiceSourceAdapter,
  type InvoiceSummary,
  type SourceInvoice,
  type ToCanonicalOptions,
} from './InvoiceSourceAdapter.js';
import { INVOICE_FIELDS, type InvoiceField } from '../../../src/models/CanonicalInvoice.js';

/**
 * QuickBooks TxnIDs look like `1A2B-1234567890`: hex, a hyphen, a timestamp.
 * Invoice numbers rarely do, so the shape is a reliable way to tell an
 * operator typing "CN-1042" from one pasting a TxnID.
 */
const TXN_ID_PATTERN = /^[0-9A-F]+-\d{6,}$/i;

export interface InvoiceIdentifier {
  kind: 'txnId' | 'refNumber';
  value: string;
}

/** Work out whether an identifier is a TxnID or an invoice number. */
export function parseInvoiceId(input: string): InvoiceIdentifier {
  const trimmed = input.trim();
  if (trimmed === '') throw new AdapterError('No invoice was named.');
  if (trimmed.toLowerCase().startsWith('txn:')) return { kind: 'txnId', value: trimmed.slice(4).trim() };
  if (trimmed.toLowerCase().startsWith('ref:')) return { kind: 'refNumber', value: trimmed.slice(4).trim() };
  return TXN_ID_PATTERN.test(trimmed) ? { kind: 'txnId', value: trimmed } : { kind: 'refNumber', value: trimmed };
}

const INVOICE_FIELD_SET = new Set<string>(INVOICE_FIELDS);

function asInvoiceOverrides(overrides: Record<string, string> | undefined): Partial<Record<InvoiceField, string>> {
  if (!overrides) return {};
  const out: Partial<Record<InvoiceField, string>> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!INVOICE_FIELD_SET.has(key)) {
      throw new AdapterError(`"${key}" is not an invoice field. Valid fields: ${INVOICE_FIELDS.join(', ')}.`);
    }
    out[key as InvoiceField] = value;
  }
  return out;
}

export class QuickBooksDesktopAdapter implements InvoiceSourceAdapter<QbInvoice> {
  readonly id = 'quickbooks-desktop';

  constructor(
    private readonly transport: QbxmlTransport,
    private readonly config: AceExportConfig,
  ) {}

  get label(): string {
    return `QuickBooks Desktop (qbXML ${this.config.qbxmlVersion}) via ${this.transport.describe()}`;
  }

  private envelope(): { version: string } {
    return { version: this.config.qbxmlVersion };
  }

  /**
   * `HostQueryRq` touches no company data, so it is the safe way to ask
   * whether the whole chain - transport, COM server, certificate, open file -
   * is working before a query that matters.
   */
  async probe(): Promise<AdapterProbe> {
    try {
      const response = await this.transport.send(buildHostQuery(this.envelope()));
      const parsed = parseHostQueryResponse(response);
      const host = parsed.results[0];
      if (!host) {
        return { ok: false, description: 'QuickBooks answered, but reported no host details.', details: {} };
      }
      const supported = host.supportedQbxmlVersions;
      const details: Record<string, string> = {
        product: host.productName,
        version: `${host.majorVersion}.${host.minorVersion}`,
        country: host.country,
        'qbXML versions': supported.join(', '),
        'qbXML requested': this.config.qbxmlVersion,
      };
      if (supported.length && !supported.includes(this.config.qbxmlVersion)) {
        details['warning'] =
          `This QuickBooks does not list qbXML ${this.config.qbxmlVersion}. Set qbxmlVersion to one of: ${supported.join(', ')}.`;
      }
      return { ok: true, description: `${host.productName} (${host.country})`, details };
    } catch (error) {
      return { ok: false, description: (error as Error).message, details: {} };
    }
  }

  /**
   * Line items are deliberately left out of the listing: a date-range query
   * over a busy file would otherwise pull every line of every invoice to
   * populate a picker. `lineCount` is therefore null here and real in
   * `getInvoice`.
   */
  async listInvoices(query: InvoiceListQuery = {}): Promise<InvoiceSummary[]> {
    const spec: InvoiceQuerySpec = { includeLineItems: false, ownerIds: [] };

    if (query.reference !== undefined && query.reference.trim() !== '') {
      // RefNumber is an alternative to every filter, not an addition to them.
      spec.refNumber = query.reference.trim();
    } else {
      if (query.limit !== undefined) spec.maxReturned = query.limit;
      if (query.dateFrom !== undefined) spec.txnDateFrom = query.dateFrom;
      if (query.dateTo !== undefined) spec.txnDateTo = query.dateTo;
      if (query.customerName !== undefined && query.customerName.trim() !== '') {
        spec.customerFullName = query.customerName.trim();
      }
      if (query.referenceContains !== undefined && query.referenceContains.trim() !== '') {
        spec.refNumberContains = query.referenceContains.trim();
        spec.refNumberMatch = 'Contains';
      }
    }

    const response = await this.transport.send(buildInvoiceQuery(spec, this.envelope()));
    const parsed = parseInvoiceQuerySummaries(response);
    return parsed.results.map((summary) => ({
      id: summary.txnId,
      reference: summary.refNumber,
      date: summary.txnDate,
      customerName: summary.customerName,
      total: summary.totalAmount,
      lineCount: summary.lineCount,
    }));
  }

  async getInvoice(invoiceId: string): Promise<SourceInvoice<QbInvoice>> {
    const identifier = parseInvoiceId(invoiceId);
    const spec: InvoiceQuerySpec =
      identifier.kind === 'txnId'
        ? { txnId: identifier.value, includeLineItems: true }
        : { refNumber: identifier.value, includeLineItems: true };

    const response = await this.transport.send(buildInvoiceQuery(spec, this.envelope()));
    const parsed = parseInvoiceQueryResponse(response);

    if (!parsed.results.length) {
      throw new InvoiceNotFoundError(
        identifier.kind === 'txnId'
          ? `No invoice with TxnID "${identifier.value}".`
          : `No invoice numbered "${identifier.value}". Check the number, or search with "list --contains".`,
      );
    }

    // QuickBooks does not enforce unique invoice numbers, and duplicates do
    // happen. Exporting "the first one" silently would be the wrong kind of
    // helpful, so the operator is asked which.
    if (parsed.results.length > 1) {
      const choices = parsed.results
        .map((invoice) => `  txn:${invoice.txnId}  ${invoice.txnDate}  ${invoice.customer.fullName}`)
        .join('\n');
      throw new AdapterError(
        `${parsed.results.length} invoices are numbered "${identifier.value}". Name one by TxnID:\n${choices}`,
      );
    }

    const invoice = parsed.results[0] as QbInvoice;
    return {
      summary: {
        id: invoice.txnId,
        reference: invoice.refNumber,
        date: invoice.txnDate,
        customerName: invoice.customer.fullName,
        total: invoice.totalAmount,
        lineCount: invoice.lines.length,
      },
      raw: invoice,
    };
  }

  toCanonicalInvoice(invoice: SourceInvoice<QbInvoice>, options: ToCanonicalOptions = {}): CanonicalMapping {
    return mapQbInvoiceToCanonical(invoice.raw, this.config, {
      overrides: asInvoiceOverrides(options.overrides),
    });
  }

  async exportAceExcel(request: ExportRequest): Promise<ExportResult> {
    return writeAceWorkbook(request.mapping, {
      directory: request.directory ?? this.config.output.directory,
      fileNameOrPattern: request.fileName ?? this.config.output.fileNamePattern,
      weightUom: this.config.output.weightUom,
      includeAuditSheet: this.config.output.includeAuditSheet,
      validation: request.validation,
      generatedBy: this.label,
      ...(request.failIfExists === undefined ? {} : { failIfExists: request.failIfExists }),
    });
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
