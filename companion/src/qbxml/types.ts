/**
 * QuickBooks-shaped types.
 *
 * These mirror the qbXML `InvoiceRet` / `InvoiceLineRet` elements, not the
 * canonical model. Keeping them separate is the point of the adapter: nothing
 * downstream of `mapping/qbToCanonical.ts` knows that QuickBooks exists, and
 * nothing here knows that ACE exists.
 *
 * Every field is optional-by-value (empty string / null) rather than optional
 * by type, because "QuickBooks did not return this element" is the normal case
 * and callers should not have to write `?.` at every step.
 */

/** A QuickBooks list reference, e.g. `CustomerRef`. */
export interface QbRef {
  listId: string;
  fullName: string;
}

/** A custom field as returned in a `DataExtRet` element. */
export interface QbDataExt {
  /** 0 for fields defined in the QuickBooks UI; an integration's GUID otherwise. */
  ownerId: string;
  name: string;
  /** DataExtType, e.g. STR255TYPE, AMTTYPE, DATETYPE. */
  type: string;
  value: string;
}

export interface QbAddress {
  addr1: string;
  addr2: string;
  addr3: string;
  addr4: string;
  addr5: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  /** The address exactly as QuickBooks formats it for printing, when present. */
  lines: string[];
}

export interface QbInvoiceLine {
  txnLineId: string;
  item: QbRef;
  desc: string;
  /** null when QuickBooks returned no Quantity element. */
  quantity: number | null;
  /** The line's unit of measure, only present when U/M is enabled in the file. */
  unitOfMeasure: string;
  rate: number | null;
  amount: number | null;
  classRef: QbRef;
  serviceDate: string;
  /** Built-in per-line free-text fields (`Other1`, `Other2`). */
  other1: string;
  other2: string;
  customFields: QbDataExt[];
  /** Set when the line came out of an `InvoiceLineGroupRet`. */
  groupItem: QbRef | null;
}

export interface QbInvoice {
  txnId: string;
  timeCreated: string;
  timeModified: string;
  editSequence: string;
  refNumber: string;
  /** YYYY-MM-DD, as qbXML always formats DATETYPE. */
  txnDate: string;
  dueDate: string;
  shipDate: string;
  customer: QbRef;
  billAddress: QbAddress | null;
  shipAddress: QbAddress | null;
  poNumber: string;
  terms: QbRef;
  /** Built-in invoice field, commonly carrying the freight/delivery terms. */
  fob: string;
  shipMethod: QbRef;
  /** Built-in header free-text field (`Other`). */
  other: string;
  memo: string;
  subtotal: number | null;
  totalAmount: number | null;
  currency: QbRef;
  exchangeRate: number | null;
  isPending: boolean | null;
  customFields: QbDataExt[];
  lines: QbInvoiceLine[];
}

/** A row of the invoice picker: enough to choose one, without the lines. */
export interface QbInvoiceSummary {
  txnId: string;
  refNumber: string;
  txnDate: string;
  customerName: string;
  totalAmount: number | null;
  lineCount: number | null;
}

/** The status attributes every qbXML `*Rs` element carries. */
export interface QbStatus {
  code: number;
  severity: string;
  message: string;
}

export function emptyRef(): QbRef {
  return { listId: '', fullName: '' };
}

export function emptyAddress(): QbAddress {
  return { addr1: '', addr2: '', addr3: '', addr4: '', addr5: '', city: '', state: '', postalCode: '', country: '', lines: [] };
}

/** One-line form of an address, for the canonical `billTo` field. */
export function formatAddress(address: QbAddress | null): string {
  if (!address) return '';
  if (address.lines.length) return address.lines.join(', ');
  const street = [address.addr1, address.addr2, address.addr3, address.addr4, address.addr5].filter((part) => part !== '');
  const locality = [address.city, address.state, address.postalCode].filter((part) => part !== '').join(' ');
  return [...street, locality, address.country].filter((part) => part !== '').join(', ');
}

/** A row of a `BillQueryRs`: enough to recognise a bill that already exists. */
export interface QbBillSummary {
  txnId: string;
  refNumber: string;
  txnDate: string;
  vendor: QbRef;
  amountDue: number | null;
}

/** One expense line as QuickBooks returns it on a `BillRet`. */
export interface QbBillExpenseLine {
  txnLineId: string;
  account: QbRef;
  amount: number | null;
  memo: string;
}

/** The bill QuickBooks reports back after a `BillAddRq`, or in a full query. */
export interface QbBillRet extends QbBillSummary {
  timeCreated: string;
  editSequence: string;
  dueDate: string;
  terms: QbRef;
  memo: string;
  lines: QbBillExpenseLine[];
}

/** A vendor as returned by `VendorQueryRs`, reduced to what a write needs to check. */
export interface QbVendor {
  listId: string;
  fullName: string;
  isActive: boolean | null;
}

/** An account as returned by `AccountQueryRs`, reduced to what a write needs to check. */
export interface QbAccount {
  listId: string;
  fullName: string;
  accountType: string;
  isActive: boolean | null;
}
