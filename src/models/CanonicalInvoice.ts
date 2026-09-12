/**
 * Canonical shipment model.
 *
 * This model is deliberately independent of the ACE DOM: Excel (and, later,
 * QuickBooks) maps *into* this shape, and every ACE write reads *out of* it.
 * Nothing in this file may import anything browser- or ACE-specific.
 */

/** Shipment-level (header) data. One per import. */
export interface CanonicalInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  billTo: string;
  poNumber: string;
  freightTerms: string;
  paymentTerms: string;
  paymentDueDate: string;
  carrier: string;
  vessel: string;
  bookingNumber: string;
  containerNumber: string;
  sealNumber: string;
  destination: string;
}

/** One commodity line. Each spreadsheet row becomes one of these. */
export interface CanonicalCommodity {
  /** 1-based ACE commodity line number. */
  line: number;
  exportInformationCode: string;
  scheduleB: string;
  description: string;
  quantity1: number | null;
  uom1: string;
  quantity2: number | null;
  uom2: string;
  origin: string;
  valueOfGoods: number | null;
  shippingWeight: number | null;
  eccn: string;
  licenseCode: string;
}

/**
 * What happened to a single field on its way from the spreadsheet into the
 * canonical model. Kept alongside (not inside) the model so the model itself
 * stays a plain data contract.
 */
export interface FieldProvenance {
  /** Spreadsheet header the value came from, e.g. "ShippingWeight". */
  column: string;
  /** Cell content exactly as it appeared, e.g. "176,000 lb". */
  original: string;
  /** Human-readable transformation, e.g. "lb x 0.45359237". Null when copied verbatim. */
  transform: string | null;
  /** Value after transformation, formatted for display. */
  normalized: string;
}

export interface ProvenanceIndex {
  invoice: Record<string, FieldProvenance>;
  /** Keyed by commodity line number, then by canonical field name. */
  commodities: Record<number, Record<string, FieldProvenance>>;
}

export interface ImportSource {
  fileName: string;
  sheetName: string;
  /** ISO timestamp of the import. */
  importedAt: string;
  rowCount: number;
  /** Headers found in the sheet, in sheet order. */
  headers: string[];
  /** Headers present in the sheet that the mapper did not recognise. */
  unknownHeaders: string[];
}

export interface CanonicalShipment {
  invoice: CanonicalInvoice;
  commodities: CanonicalCommodity[];
  provenance: ProvenanceIndex;
  source: ImportSource;
}

export function emptyInvoice(): CanonicalInvoice {
  return {
    invoiceNumber: '',
    invoiceDate: '',
    customerName: '',
    billTo: '',
    poNumber: '',
    freightTerms: '',
    paymentTerms: '',
    paymentDueDate: '',
    carrier: '',
    vessel: '',
    bookingNumber: '',
    containerNumber: '',
    sealNumber: '',
    destination: '',
  };
}

export function emptyCommodity(line: number): CanonicalCommodity {
  return {
    line,
    exportInformationCode: '',
    scheduleB: '',
    description: '',
    quantity1: null,
    uom1: '',
    quantity2: null,
    uom2: '',
    origin: '',
    valueOfGoods: null,
    shippingWeight: null,
    eccn: '',
    licenseCode: '',
  };
}

export function emptyProvenance(): ProvenanceIndex {
  return { invoice: {}, commodities: {} };
}

/** Field names of CanonicalInvoice, used by mappings and the preview UI. */
export const INVOICE_FIELDS = [
  'invoiceNumber',
  'invoiceDate',
  'customerName',
  'billTo',
  'poNumber',
  'freightTerms',
  'paymentTerms',
  'paymentDueDate',
  'carrier',
  'vessel',
  'bookingNumber',
  'containerNumber',
  'sealNumber',
  'destination',
] as const;

export const COMMODITY_FIELDS = [
  'exportInformationCode',
  'scheduleB',
  'description',
  'quantity1',
  'uom1',
  'quantity2',
  'uom2',
  'origin',
  'valueOfGoods',
  'shippingWeight',
  'eccn',
  'licenseCode',
] as const;

export type InvoiceField = (typeof INVOICE_FIELDS)[number];
export type CommodityField = (typeof COMMODITY_FIELDS)[number];
