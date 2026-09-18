/**
 * qbXML response -> QuickBooks-shaped objects.
 *
 * Robustness rules, learned from what real QuickBooks files contain:
 *
 *  - every element is optional. A field the company file never filled in is
 *    simply absent, not empty, so the parser defaults rather than throws;
 *  - `InvoiceLineGroupRet` wraps the lines of a group item. Those nested
 *    `InvoiceLineRet` elements are real commodity lines and are flattened in,
 *    tagged with the group they came from;
 *  - `statusCode` 1 means "no matching record", which is a normal answer to a
 *    search and not an error;
 *  - custom fields arrive as `DataExtRet`, and only when the request asked for
 *    `OwnerID` 0. An empty `customFields` array therefore means "none defined,
 *    or none requested" - the caller is told which.
 */

import {
  childNamed,
  childrenNamed,
  elementAt,
  parseXml,
  textAt,
  type XmlElement,
} from './xml.js';
import {
  emptyAddress,
  emptyRef,
  type QbAccount,
  type QbAddress,
  type QbBillRet,
  type QbBillSummary,
  type QbDataExt,
  type QbInvoice,
  type QbInvoiceLine,
  type QbInvoiceSummary,
  type QbRef,
  type QbStatus,
  type QbVendor,
} from './types.js';

export class QbxmlResponseError extends Error {
  readonly status: QbStatus | null;

  constructor(message: string, status: QbStatus | null = null) {
    super(message);
    this.name = 'QbxmlResponseError';
    this.status = status;
  }
}

/** statusCode 1: the request was understood, nothing matched. */
export const STATUS_NO_MATCH = 1;

function parseNumber(text: string): number | null {
  if (text.trim() === '') return null;
  const cleaned = text.replace(/[,$\s]/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseBoolean(text: string): boolean | null {
  const lower = text.trim().toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  return null;
}

function parseRef(element: XmlElement | undefined, name: string): QbRef {
  const ref = childNamed(element, name);
  if (!ref) return emptyRef();
  return { listId: textAt(ref, 'ListID'), fullName: textAt(ref, 'FullName') };
}

function parseAddress(element: XmlElement | undefined, name: string): QbAddress | null {
  const node = childNamed(element, name);
  // QuickBooks also returns a pre-formatted `<BillAddressBlock>` alongside the
  // structured address; it is what prints on the invoice, so it wins for display.
  const blockNode = childNamed(element, `${name}Block`);

  if (!node && !blockNode) return null;

  const address = emptyAddress();
  if (node) {
    address.addr1 = textAt(node, 'Addr1');
    address.addr2 = textAt(node, 'Addr2');
    address.addr3 = textAt(node, 'Addr3');
    address.addr4 = textAt(node, 'Addr4');
    address.addr5 = textAt(node, 'Addr5');
    address.city = textAt(node, 'City');
    address.state = textAt(node, 'State');
    address.postalCode = textAt(node, 'PostalCode');
    address.country = textAt(node, 'Country');
  }
  if (blockNode) {
    address.lines = blockNode.children
      .filter((child) => /^Addr\d$/.test(child.name))
      .map((child) => child.text)
      .filter((line) => line !== '');
  }
  return address;
}

function parseDataExts(element: XmlElement | undefined): QbDataExt[] {
  return childrenNamed(element, 'DataExtRet').map((node) => ({
    ownerId: textAt(node, 'OwnerID'),
    name: textAt(node, 'DataExtName'),
    type: textAt(node, 'DataExtType'),
    value: textAt(node, 'DataExtValue'),
  }));
}

function parseLine(element: XmlElement, groupItem: QbRef | null): QbInvoiceLine {
  return {
    txnLineId: textAt(element, 'TxnLineID'),
    item: parseRef(element, 'ItemRef'),
    desc: textAt(element, 'Desc'),
    quantity: parseNumber(textAt(element, 'Quantity')),
    unitOfMeasure: textAt(element, 'UnitOfMeasure'),
    rate: parseNumber(textAt(element, 'Rate')),
    amount: parseNumber(textAt(element, 'Amount')),
    classRef: parseRef(element, 'ClassRef'),
    serviceDate: textAt(element, 'ServiceDate'),
    other1: textAt(element, 'Other1'),
    other2: textAt(element, 'Other2'),
    customFields: parseDataExts(element),
    groupItem,
  };
}

/**
 * Collect `InvoiceLineRet` in document order, descending into
 * `InvoiceLineGroupRet`. Group lines are real lines: a group item on an
 * invoice prints, and is valued, through its members.
 */
function collectLines(invoiceRet: XmlElement): QbInvoiceLine[] {
  const lines: QbInvoiceLine[] = [];
  for (const child of invoiceRet.children) {
    if (child.name === 'InvoiceLineRet') {
      lines.push(parseLine(child, null));
      continue;
    }
    if (child.name === 'InvoiceLineGroupRet') {
      const group = parseRef(child, 'ItemGroupRef');
      for (const member of childrenNamed(child, 'InvoiceLineRet')) {
        lines.push(parseLine(member, group));
      }
    }
  }
  return lines;
}

export function parseInvoiceRet(element: XmlElement): QbInvoice {
  return {
    txnId: textAt(element, 'TxnID'),
    timeCreated: textAt(element, 'TimeCreated'),
    timeModified: textAt(element, 'TimeModified'),
    editSequence: textAt(element, 'EditSequence'),
    refNumber: textAt(element, 'RefNumber'),
    txnDate: textAt(element, 'TxnDate'),
    dueDate: textAt(element, 'DueDate'),
    shipDate: textAt(element, 'ShipDate'),
    customer: parseRef(element, 'CustomerRef'),
    billAddress: parseAddress(element, 'BillAddress'),
    shipAddress: parseAddress(element, 'ShipAddress'),
    poNumber: textAt(element, 'PONumber'),
    terms: parseRef(element, 'TermsRef'),
    fob: textAt(element, 'FOB'),
    shipMethod: parseRef(element, 'ShipMethodRef'),
    other: textAt(element, 'Other'),
    memo: textAt(element, 'Memo'),
    subtotal: parseNumber(textAt(element, 'Subtotal')),
    totalAmount: parseNumber(textAt(element, 'TotalAmount')),
    currency: parseRef(element, 'CurrencyRef'),
    exchangeRate: parseNumber(textAt(element, 'ExchangeRate')),
    isPending: parseBoolean(textAt(element, 'IsPending')),
    customFields: parseDataExts(element),
    lines: collectLines(element),
  };
}

export interface QbResponse<T> {
  status: QbStatus;
  results: T[];
}

function readStatus(element: XmlElement): QbStatus {
  return {
    code: Number(element.attributes['statusCode'] ?? '0'),
    severity: element.attributes['statusSeverity'] ?? '',
    message: element.attributes['statusMessage'] ?? '',
  };
}

/**
 * Find the single `*Rs` element of the named type inside a response document,
 * and fail with QuickBooks' own message when it reports an error.
 */
function responseElement(xml: string, responseName: string): XmlElement {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (error) {
    throw new QbxmlResponseError(`QuickBooks returned something that is not valid XML: ${(error as Error).message}`);
  }

  if (root.name !== 'QBXML') {
    throw new QbxmlResponseError(`Expected a <QBXML> response; got <${root.name}>.`);
  }

  const messages = childNamed(root, 'QBXMLMsgsRs');
  if (!messages) {
    throw new QbxmlResponseError('The response has no <QBXMLMsgsRs> element.');
  }

  const found = childNamed(messages, responseName);
  if (!found) {
    const present = messages.children.map((child) => child.name).join(', ') || 'nothing';
    throw new QbxmlResponseError(`The response has no <${responseName}>; it contains ${present}.`);
  }
  return found;
}

function assertUsableStatus(element: XmlElement, what: string): QbStatus {
  const status = readStatus(element);
  if (status.code !== 0 && status.code !== STATUS_NO_MATCH) {
    throw new QbxmlResponseError(
      `QuickBooks rejected the ${what} (status ${status.code}, ${status.severity}): ${status.message}`,
      status,
    );
  }
  return status;
}

/**
 * The strict form, for a response to a write. A statusCode of 1 on a
 * `BillAddRs` does not mean "no match"; it means nothing was added, and a
 * caller that shrugged at it would report a bill that does not exist.
 */
function assertOkStatus(element: XmlElement, what: string): QbStatus {
  const status = readStatus(element);
  if (status.code !== 0) {
    throw new QbxmlResponseError(
      `QuickBooks did not accept the ${what} (status ${status.code}, ${status.severity}): ${status.message}`,
      status,
    );
  }
  return status;
}

/** Parse an `InvoiceQueryRs` document into full invoices. */
export function parseInvoiceQueryResponse(xml: string): QbResponse<QbInvoice> {
  const element = responseElement(xml, 'InvoiceQueryRs');
  const status = assertUsableStatus(element, 'invoice query');
  return { status, results: childrenNamed(element, 'InvoiceRet').map(parseInvoiceRet) };
}

/** The same document, reduced to what the invoice picker shows. */
export function parseInvoiceQuerySummaries(xml: string): QbResponse<QbInvoiceSummary> {
  const element = responseElement(xml, 'InvoiceQueryRs');
  const status = assertUsableStatus(element, 'invoice query');
  const results = childrenNamed(element, 'InvoiceRet').map((node) => {
    const lineCount = childrenNamed(node, 'InvoiceLineRet').length + childrenNamed(node, 'InvoiceLineGroupRet').length;
    return {
      txnId: textAt(node, 'TxnID'),
      refNumber: textAt(node, 'RefNumber'),
      txnDate: textAt(node, 'TxnDate'),
      customerName: textAt(node, 'CustomerRef/FullName'),
      totalAmount: parseNumber(textAt(node, 'TotalAmount')),
      lineCount: lineCount || null,
    };
  });
  return { status, results };
}

export interface QbCustomer {
  listId: string;
  fullName: string;
  companyName: string;
  billAddress: QbAddress | null;
  shipAddress: QbAddress | null;
  terms: QbRef;
  customFields: QbDataExt[];
}

export function parseCustomerQueryResponse(xml: string): QbResponse<QbCustomer> {
  const element = responseElement(xml, 'CustomerQueryRs');
  const status = assertUsableStatus(element, 'customer query');
  const results = childrenNamed(element, 'CustomerRet').map((node) => ({
    listId: textAt(node, 'ListID'),
    fullName: textAt(node, 'FullName'),
    companyName: textAt(node, 'CompanyName'),
    billAddress: parseAddress(node, 'BillAddress'),
    shipAddress: parseAddress(node, 'ShipAddress'),
    terms: parseRef(node, 'TermsRef'),
    customFields: parseDataExts(node),
  }));
  return { status, results };
}

export interface QbHost {
  productName: string;
  majorVersion: string;
  minorVersion: string;
  country: string;
  supportedQbxmlVersions: string[];
  isAutomaticLogin: boolean | null;
}

export function parseHostQueryResponse(xml: string): QbResponse<QbHost> {
  const element = responseElement(xml, 'HostQueryRs');
  const status = assertUsableStatus(element, 'host query');
  const results = childrenNamed(element, 'HostRet').map((node) => ({
    productName: textAt(node, 'ProductName'),
    majorVersion: textAt(node, 'MajorVersion'),
    minorVersion: textAt(node, 'MinorVersion'),
    country: textAt(node, 'Country'),
    supportedQbxmlVersions: childrenNamed(node, 'SupportedQBXMLVersion').map((child) => child.text),
    isAutomaticLogin: parseBoolean(textAt(node, 'IsAutomaticLogin')),
  }));
  return { status, results };
}

/**
 * Names of every custom field present on an invoice and its lines, which is
 * what the configuration screen offers the user to map. Returned in first-seen
 * order so it reads like the invoice.
 */
export function customFieldNames(invoice: QbInvoice): string[] {
  const names: string[] = [];
  const add = (name: string): void => {
    if (name !== '' && !names.includes(name)) names.push(name);
  };
  for (const field of invoice.customFields) add(field.name);
  for (const line of invoice.lines) {
    for (const field of line.customFields) add(field.name);
  }
  return names;
}

/** Look up a custom field by name, case-insensitively. */
export function customFieldValue(fields: QbDataExt[], name: string): string {
  const wanted = name.trim().toLowerCase();
  const found = fields.find((field) => field.name.trim().toLowerCase() === wanted);
  return found?.value ?? '';
}

function parseBillSummary(node: XmlElement): QbBillSummary {
  return {
    txnId: textAt(node, 'TxnID'),
    refNumber: textAt(node, 'RefNumber'),
    txnDate: textAt(node, 'TxnDate'),
    vendor: parseRef(node, 'VendorRef'),
    amountDue: parseNumber(textAt(node, 'AmountDue')),
  };
}

function parseBillRet(node: XmlElement): QbBillRet {
  return {
    ...parseBillSummary(node),
    timeCreated: textAt(node, 'TimeCreated'),
    editSequence: textAt(node, 'EditSequence'),
    dueDate: textAt(node, 'DueDate'),
    terms: parseRef(node, 'TermsRef'),
    memo: textAt(node, 'Memo'),
    lines: childrenNamed(node, 'ExpenseLineRet').map((line) => ({
      txnLineId: textAt(line, 'TxnLineID'),
      account: parseRef(line, 'AccountRef'),
      amount: parseNumber(textAt(line, 'Amount')),
      memo: textAt(line, 'Memo'),
    })),
  };
}

/** `BillQueryRs`, as the duplicate check reads it. "No match" is a normal answer. */
export function parseBillQueryResponse(xml: string): QbResponse<QbBillSummary> {
  const element = responseElement(xml, 'BillQueryRs');
  const status = assertUsableStatus(element, 'bill query');
  return { status, results: childrenNamed(element, 'BillRet').map(parseBillSummary) };
}

/**
 * `BillAddRs`: the bill QuickBooks created. Strict on status, and strict on
 * the presence of a `BillRet`, because "QuickBooks said OK but returned no
 * bill" is not an outcome the caller can report honestly.
 */
export function parseBillAddResponse(xml: string): QbBillRet {
  const element = responseElement(xml, 'BillAddRs');
  assertOkStatus(element, 'bill');
  const ret = childNamed(element, 'BillRet');
  if (!ret) throw new QbxmlResponseError('QuickBooks reported success but returned no BillRet.');
  return parseBillRet(ret);
}

export function parseVendorQueryResponse(xml: string): QbResponse<QbVendor> {
  const element = responseElement(xml, 'VendorQueryRs');
  const status = assertUsableStatus(element, 'vendor query');
  const results = childrenNamed(element, 'VendorRet').map((node) => ({
    listId: textAt(node, 'ListID'),
    fullName: textAt(node, 'FullName'),
    isActive: parseBoolean(textAt(node, 'IsActive')),
  }));
  return { status, results };
}

export function parseAccountQueryResponse(xml: string): QbResponse<QbAccount> {
  const element = responseElement(xml, 'AccountQueryRs');
  const status = assertUsableStatus(element, 'account query');
  const results = childrenNamed(element, 'AccountRet').map((node) => ({
    listId: textAt(node, 'ListID'),
    fullName: textAt(node, 'FullName'),
    accountType: textAt(node, 'AccountType'),
    isActive: parseBoolean(textAt(node, 'IsActive')),
  }));
  return { status, results };
}

/** Convenience for tests and the transport layer. */
export function elementOf(xml: string, path: string): XmlElement | undefined {
  return elementAt(parseXml(xml), path);
}
