/**
 * qbXML request builders.
 *
 * qbXML is validated against a sequence-based schema inside QuickBooks, so
 * **element order is part of the contract**. Getting it wrong comes back as a
 * status 3000 ("The given object ID is invalid") or a parser error rather than
 * a helpful message, so the builders here emit elements in schema order and
 * refuse combinations the schema forbids (an ID lookup cannot also carry
 * filters - they are alternatives in an `xs:choice`).
 *
 * Reference: QuickBooks Desktop SDK, `qbxmlops<version>.xml` / the OSR
 * (Onscreen Reference) entries for InvoiceQueryRq, CustomerQueryRq, HostQueryRq.
 */

import { escapeXml } from './xml.js';

export class QbxmlRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QbxmlRequestError';
  }
}

/**
 * qbXML version to declare. QuickBooks Desktop Pro Plus 2024 accepts up to
 * 16.0; older versions are accepted by newer QuickBooks, which is why this is
 * configurable rather than hard-coded.
 */
export const DEFAULT_QBXML_VERSION = '16.0';

/**
 * `OwnerID` 0 is what makes QuickBooks return `DataExtRet` elements for the
 * custom fields defined through its own UI. Without it, custom fields are
 * simply absent from the response - the single most common reason an
 * integration "cannot see" a field that is plainly visible on the invoice.
 */
export const UI_CUSTOM_FIELD_OWNER_ID = '0';

export type MatchCriterion = 'StartsWith' | 'Contains' | 'EndsWith';

export interface InvoiceQuerySpec {
  /** Exact transaction ID. Mutually exclusive with every filter. */
  txnId?: string | string[];
  /** Exact invoice number. Mutually exclusive with every filter. */
  refNumber?: string | string[];
  maxReturned?: number;
  txnDateFrom?: string;
  txnDateTo?: string;
  modifiedDateFrom?: string;
  modifiedDateTo?: string;
  /** Customer:Job full name, e.g. "Aydin Kuruyemis San Ve Tic A.S". */
  customerFullName?: string;
  refNumberContains?: string;
  refNumberMatch?: MatchCriterion;
  refNumberFrom?: string;
  refNumberTo?: string;
  /** Default true: without it there are no commodity lines to map. */
  includeLineItems?: boolean;
  includeLinkedTxns?: boolean;
  /** Default ['0'], which returns UI-defined custom fields. */
  ownerIds?: string[];
  /** Limits the returned elements; leave unset to get everything. */
  includeRetElements?: string[];
  requestId?: string;
}

export interface CustomerQuerySpec {
  listId?: string;
  fullName?: string;
  maxReturned?: number;
  ownerIds?: string[];
  requestId?: string;
}

export interface EnvelopeOptions {
  version?: string;
  onError?: 'stopOnError' | 'continueOnError';
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string | undefined, label: string): void {
  if (value === undefined) return;
  if (!DATE_PATTERN.test(value)) {
    throw new QbxmlRequestError(`${label} must be YYYY-MM-DD; got "${value}".`);
  }
}

function assertVersion(version: string): void {
  if (!/^\d{1,2}\.\d$/.test(version)) {
    throw new QbxmlRequestError(`qbXML version must look like "16.0"; got "${version}".`);
  }
}

function tag(name: string, value: string | number | boolean, indent: string): string {
  return `${indent}<${name}>${escapeXml(String(value))}</${name}>`;
}

function block(name: string, inner: string[], indent: string): string[] {
  if (!inner.length) return [];
  return [`${indent}<${name}>`, ...inner, `${indent}</${name}>`];
}

function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => item.trim()).filter((item) => item !== '');
}

/** Wrap one or more request bodies in the QBXML envelope. */
export function buildEnvelope(requests: string[], options: EnvelopeOptions = {}): string {
  const version = options.version ?? DEFAULT_QBXML_VERSION;
  assertVersion(version);
  const onError = options.onError ?? 'stopOnError';
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<?qbxml version="${version}"?>`,
    '<QBXML>',
    `  <QBXMLMsgsRq onError="${onError}">`,
    ...requests,
    '  </QBXMLMsgsRq>',
    '</QBXML>',
    '',
  ].join('\n');
}

/**
 * Build an `InvoiceQueryRq` body (without the envelope).
 *
 * The `xs:choice` at the top of the schema is why an ID lookup and a filtered
 * search cannot be combined: QuickBooks would reject the request rather than
 * intersect them.
 */
export function buildInvoiceQueryBody(spec: InvoiceQuerySpec = {}): string {
  const indent = '      ';
  const outer = '    ';
  const requestId = spec.requestId ?? '1';

  const txnIds = asList(spec.txnId);
  const refNumbers = asList(spec.refNumber);

  const hasFilters =
    spec.maxReturned !== undefined ||
    spec.txnDateFrom !== undefined ||
    spec.txnDateTo !== undefined ||
    spec.modifiedDateFrom !== undefined ||
    spec.modifiedDateTo !== undefined ||
    spec.customerFullName !== undefined ||
    spec.refNumberContains !== undefined ||
    spec.refNumberFrom !== undefined ||
    spec.refNumberTo !== undefined;

  if (txnIds.length && refNumbers.length) {
    throw new QbxmlRequestError('Query by TxnID or by RefNumber, not both: qbXML treats them as alternatives.');
  }
  if ((txnIds.length || refNumbers.length) && hasFilters) {
    throw new QbxmlRequestError(
      'A TxnID/RefNumber lookup cannot be combined with filters (MaxReturned, date ranges, EntityFilter). Drop one or the other.',
    );
  }

  assertDate(spec.txnDateFrom, 'txnDateFrom');
  assertDate(spec.txnDateTo, 'txnDateTo');
  assertDate(spec.modifiedDateFrom, 'modifiedDateFrom');
  assertDate(spec.modifiedDateTo, 'modifiedDateTo');

  if (spec.maxReturned !== undefined && (!Number.isInteger(spec.maxReturned) || spec.maxReturned < 1)) {
    throw new QbxmlRequestError(`maxReturned must be a positive whole number; got ${spec.maxReturned}.`);
  }

  const body: string[] = [];

  // --- the xs:choice -------------------------------------------------------
  if (txnIds.length) {
    for (const id of txnIds) body.push(tag('TxnID', id, indent));
  } else if (refNumbers.length) {
    for (const ref of refNumbers) body.push(tag('RefNumber', ref, indent));
  } else {
    if (spec.maxReturned !== undefined) body.push(tag('MaxReturned', spec.maxReturned, indent));

    body.push(
      ...block(
        'ModifiedDateRangeFilter',
        [
          ...(spec.modifiedDateFrom ? [tag('FromModifiedDate', spec.modifiedDateFrom, `${indent}  `)] : []),
          ...(spec.modifiedDateTo ? [tag('ToModifiedDate', spec.modifiedDateTo, `${indent}  `)] : []),
        ],
        indent,
      ),
    );

    body.push(
      ...block(
        'TxnDateRangeFilter',
        [
          ...(spec.txnDateFrom ? [tag('FromTxnDate', spec.txnDateFrom, `${indent}  `)] : []),
          ...(spec.txnDateTo ? [tag('ToTxnDate', spec.txnDateTo, `${indent}  `)] : []),
        ],
        indent,
      ),
    );

    if (spec.customerFullName !== undefined && spec.customerFullName.trim() !== '') {
      body.push(...block('EntityFilter', [tag('FullName', spec.customerFullName.trim(), `${indent}  `)], indent));
    }

    if (spec.refNumberContains !== undefined && spec.refNumberContains.trim() !== '') {
      body.push(
        ...block(
          'RefNumberFilter',
          [
            tag('MatchCriterion', spec.refNumberMatch ?? 'Contains', `${indent}  `),
            tag('RefNumber', spec.refNumberContains.trim(), `${indent}  `),
          ],
          indent,
        ),
      );
    }

    if (spec.refNumberFrom !== undefined || spec.refNumberTo !== undefined) {
      body.push(
        ...block(
          'RefNumberRangeFilter',
          [
            ...(spec.refNumberFrom ? [tag('FromRefNumber', spec.refNumberFrom, `${indent}  `)] : []),
            ...(spec.refNumberTo ? [tag('ToRefNumber', spec.refNumberTo, `${indent}  `)] : []),
          ],
          indent,
        ),
      );
    }
  }

  // --- elements that always come after the choice, in schema order ---------
  body.push(tag('IncludeLineItems', spec.includeLineItems === false ? 'false' : 'true', indent));
  if (spec.includeLinkedTxns !== undefined) {
    body.push(tag('IncludeLinkedTxns', spec.includeLinkedTxns ? 'true' : 'false', indent));
  }
  for (const element of spec.includeRetElements ?? []) {
    body.push(tag('IncludeRetElement', element, indent));
  }
  for (const ownerId of spec.ownerIds ?? [UI_CUSTOM_FIELD_OWNER_ID]) {
    body.push(tag('OwnerID', ownerId, indent));
  }

  return [`${outer}<InvoiceQueryRq requestID="${escapeXml(requestId)}">`, ...body, `${outer}</InvoiceQueryRq>`].join('\n');
}

/** Full request document for an invoice query. */
export function buildInvoiceQuery(spec: InvoiceQuerySpec = {}, options: EnvelopeOptions = {}): string {
  return buildEnvelope([buildInvoiceQueryBody(spec)], options);
}

/**
 * Customer query, used to read custom fields that live on the customer record
 * rather than on the invoice (a common place for Destination or Carrier).
 */
export function buildCustomerQueryBody(spec: CustomerQuerySpec = {}): string {
  const indent = '      ';
  const outer = '    ';
  const requestId = spec.requestId ?? '1';

  if (spec.listId && spec.fullName) {
    throw new QbxmlRequestError('Query a customer by ListID or by FullName, not both.');
  }

  const body: string[] = [];
  if (spec.listId) body.push(tag('ListID', spec.listId, indent));
  else if (spec.fullName) body.push(tag('FullName', spec.fullName, indent));
  else if (spec.maxReturned !== undefined) body.push(tag('MaxReturned', spec.maxReturned, indent));

  for (const ownerId of spec.ownerIds ?? [UI_CUSTOM_FIELD_OWNER_ID]) {
    body.push(tag('OwnerID', ownerId, indent));
  }

  return [`${outer}<CustomerQueryRq requestID="${escapeXml(requestId)}">`, ...body, `${outer}</CustomerQueryRq>`].join('\n');
}

export function buildCustomerQuery(spec: CustomerQuerySpec = {}, options: EnvelopeOptions = {}): string {
  return buildEnvelope([buildCustomerQueryBody(spec)], options);
}

/**
 * `HostQueryRq` asks QuickBooks what it is: product name, country, and the
 * qbXML versions it supports. It touches no company data, which makes it the
 * right "is this connection alive?" probe.
 */
export function buildHostQuery(options: EnvelopeOptions = {}): string {
  return buildEnvelope(['    <HostQueryRq requestID="1" />'], options);
}
