/**
 * Spreadsheet column dictionary.
 *
 * The canonical column name is what templates/ACE_Import_Template.xlsx uses.
 * Aliases let real-world exports (QuickBooks, customer packing lists) import
 * without being reshaped by hand first. Header matching is
 * case/space/punctuation-insensitive.
 */

import type { CommodityField, InvoiceField } from '../models/CanonicalInvoice.js';

/** How a cell value is interpreted on the way into the canonical model. */
export type ColumnKind =
  | 'text'
  | 'code'
  | 'scheduleB'
  | 'uom'
  | 'origin'
  | 'country'
  | 'number'
  | 'money'
  | 'weight'
  | 'date'
  | 'eccn';

export interface ColumnSpec {
  /** Canonical header, as written in the import template. */
  column: string;
  aliases: string[];
  kind: ColumnKind;
  /** Where the value lands. 'control' columns steer the import instead. */
  target: 'invoice' | 'commodity' | 'control';
  field?: InvoiceField | CommodityField;
  /** For control columns: what they control. */
  control?: 'line' | 'weightUnit' | 'ignore';
}

export const COLUMN_SPECS: ColumnSpec[] = [
  // ---- control -----------------------------------------------------------
  { column: 'Line', aliases: ['line', 'lineno', 'linenumber', 'linenum', 'row', 'item', 'itemno'], kind: 'number', target: 'control', control: 'line' },
  {
    column: 'ShippingWeightUOM',
    aliases: ['shippingweightuom', 'weightuom', 'weightunit', 'weightunits', 'uomweight', 'grossweightuom'],
    kind: 'text',
    target: 'control',
    control: 'weightUnit',
  },

  // ---- commodity line ----------------------------------------------------
  { column: 'ExportInformationCode', aliases: ['exportinformationcode', 'exportinfocode', 'eic'], kind: 'code', target: 'commodity', field: 'exportInformationCode' },
  { column: 'ScheduleB', aliases: ['scheduleb', 'schedulebnumber', 'schedulebhts', 'hts', 'htsnumber', 'htscode', 'schedulebcode', 'commodityclassificationnumber'], kind: 'scheduleB', target: 'commodity', field: 'scheduleB' },
  { column: 'CommodityDescription', aliases: ['commoditydescription', 'description', 'descriptionofgoods', 'goodsdescription', 'itemdescription', 'product'], kind: 'text', target: 'commodity', field: 'description' },
  { column: 'Quantity1', aliases: ['quantity1', 'qty1', 'quantity', 'qty', 'firstquantity'], kind: 'number', target: 'commodity', field: 'quantity1' },
  { column: 'UOM1', aliases: ['uom1', 'unitofmeasure1', 'uom', 'unitofmeasure', 'unit', 'firstuom'], kind: 'uom', target: 'commodity', field: 'uom1' },
  { column: 'Quantity2', aliases: ['quantity2', 'qty2', 'secondquantity'], kind: 'number', target: 'commodity', field: 'quantity2' },
  { column: 'UOM2', aliases: ['uom2', 'unitofmeasure2', 'seconduom'], kind: 'uom', target: 'commodity', field: 'uom2' },
  { column: 'Origin', aliases: ['origin', 'originofgoods', 'domesticforeign', 'domesticorforeign', 'countryoforigin', 'origincountry'], kind: 'origin', target: 'commodity', field: 'origin' },
  { column: 'ValueOfGoods', aliases: ['valueofgoods', 'value', 'commodityvalue', 'linevalue', 'extendedvalue', 'amount', 'totalvalue', 'usdvalue'], kind: 'money', target: 'commodity', field: 'valueOfGoods' },
  { column: 'ShippingWeight', aliases: ['shippingweight', 'weight', 'grossweight', 'netweight', 'shippingweightkg', 'weightkg', 'shippingweightlb', 'weightlb', 'grossweightlb'], kind: 'weight', target: 'commodity', field: 'shippingWeight' },
  { column: 'ECCN', aliases: ['eccn', 'exportcontrolclassificationnumber'], kind: 'eccn', target: 'commodity', field: 'eccn' },
  { column: 'LicenseCode', aliases: ['licensecode', 'license', 'licencecode', 'licensetypecode', 'licenseexemption', 'licensecodeexemption'], kind: 'code', target: 'commodity', field: 'licenseCode' },

  // ---- shipment / invoice header -----------------------------------------
  { column: 'CustomerName', aliases: ['customername', 'customer', 'consignee', 'ultimateconsignee', 'ultimateconsigneename', 'buyer', 'soldto'], kind: 'text', target: 'invoice', field: 'customerName' },
  { column: 'InvoiceNumber', aliases: ['invoicenumber', 'invoiceno', 'invoice', 'invoicenum', 'shipmentreferencenumber', 'reference'], kind: 'text', target: 'invoice', field: 'invoiceNumber' },
  { column: 'InvoiceDate', aliases: ['invoicedate', 'date', 'exportdate', 'dateofexport', 'estimatedexportdate'], kind: 'date', target: 'invoice', field: 'invoiceDate' },
  { column: 'BillTo', aliases: ['billto', 'billtoaddress', 'billingaddress', 'consigneeaddress', 'address'], kind: 'text', target: 'invoice', field: 'billTo' },
  { column: 'FreightTerms', aliases: ['freightterms', 'incoterms', 'inco', 'termsofsale', 'shippingterms'], kind: 'text', target: 'invoice', field: 'freightTerms' },
  { column: 'PaymentTerms', aliases: ['paymentterms', 'terms'], kind: 'text', target: 'invoice', field: 'paymentTerms' },
  { column: 'PaymentDueDate', aliases: ['paymentduedate', 'duedate', 'dueon'], kind: 'date', target: 'invoice', field: 'paymentDueDate' },
  { column: 'PONumber', aliases: ['ponumber', 'po', 'purchaseordernumber', 'purchaseorder', 'pono', 'customerpo'], kind: 'text', target: 'invoice', field: 'poNumber' },
  { column: 'Carrier', aliases: ['carrier', 'carriername', 'shippingline', 'steamshipline'], kind: 'text', target: 'invoice', field: 'carrier' },
  { column: 'Vessel', aliases: ['vessel', 'vesselname', 'conveyancename', 'conveyance', 'flightnumber', 'voyage'], kind: 'text', target: 'invoice', field: 'vessel' },
  { column: 'BookingNumber', aliases: ['bookingnumber', 'booking', 'bookingno', 'bookingref'], kind: 'text', target: 'invoice', field: 'bookingNumber' },
  { column: 'ContainerNumber', aliases: ['containernumber', 'container', 'containerno', 'equipmentnumber'], kind: 'text', target: 'invoice', field: 'containerNumber' },
  { column: 'SealNumber', aliases: ['sealnumber', 'seal', 'sealno'], kind: 'text', target: 'invoice', field: 'sealNumber' },
  { column: 'Destination', aliases: ['destination', 'countryofultimatedestination', 'ultimatedestination', 'destinationcountry', 'shipto', 'shiptocountry'], kind: 'country', target: 'invoice', field: 'destination' },
];

/** Normalize a header cell to an alias key: lower-case, alphanumerics only. */
export function normalizeHeader(header: unknown): string {
  if (header === null || header === undefined) return '';
  return String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const ALIAS_INDEX: Map<string, ColumnSpec> = (() => {
  const index = new Map<string, ColumnSpec>();
  for (const spec of COLUMN_SPECS) {
    index.set(normalizeHeader(spec.column), spec);
    for (const alias of spec.aliases) {
      const key = normalizeHeader(alias);
      if (!index.has(key)) index.set(key, spec);
    }
  }
  return index;
})();

export function specForHeader(header: unknown): ColumnSpec | undefined {
  const key = normalizeHeader(header);
  if (key === '') return undefined;
  return ALIAS_INDEX.get(key);
}

/**
 * Some headers imply a unit, e.g. "ShippingWeightLb". Returns the implied
 * weight unit, or '' when the header does not say.
 */
export function impliedWeightUnit(header: unknown): string {
  const key = normalizeHeader(header);
  if (/(lb|lbs|pound|pounds)$/.test(key)) return 'lb';
  if (/(kg|kgs|kilo|kilos|kilogram|kilograms)$/.test(key)) return 'kg';
  return '';
}

/** Canonical template column order. */
export const TEMPLATE_COLUMNS: string[] = [
  'Line',
  'ExportInformationCode',
  'ScheduleB',
  'CommodityDescription',
  'Quantity1',
  'UOM1',
  'Quantity2',
  'UOM2',
  'Origin',
  'ValueOfGoods',
  'ShippingWeight',
  'ShippingWeightUOM',
  'ECCN',
  'LicenseCode',
  'CustomerName',
  'InvoiceNumber',
  'InvoiceDate',
  'BillTo',
  'FreightTerms',
  'PaymentTerms',
  'PaymentDueDate',
  'PONumber',
  'Carrier',
  'Vessel',
  'BookingNumber',
  'ContainerNumber',
  'SealNumber',
  'Destination',
];

/** Columns the validator treats as required for a usable commodity line. */
export const REQUIRED_COMMODITY_COLUMNS = ['ScheduleB', 'CommodityDescription', 'Quantity1', 'UOM1', 'ValueOfGoods', 'ShippingWeight'];
