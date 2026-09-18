/**
 * Local configuration for the QuickBooks -> ACE export.
 *
 * Everything QuickBooks cannot know lives here, in a plain JSON file on the
 * user's own machine. There are three kinds of entry, and the distinction is
 * the whole point of the file:
 *
 *   customFields   which QuickBooks *custom field* carries which shipment
 *                  value. QuickBooks calls these DataExt fields; their names
 *                  are whatever the company file happens to use.
 *   items          the customs facts about an item - Schedule B, origin,
 *                  licence code - which no accounting system stores.
 *   manual         a one-off override for a single export.
 *   bill           the rules `ace-export bill` uses to build the vendor bill
 *                  from an invoice: which vendor and expense account an item
 *                  belongs to, each vendor's commission, the memo wording.
 *
 * Nothing here invents a customs value. An item with no Schedule B produces a
 * blank Schedule B and a validation error, never a guess.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { COMMODITY_FIELDS, INVOICE_FIELDS, type CommodityField, type InvoiceField } from '../../src/models/CanonicalInvoice.js';
import { assertMemoTemplate, MemoTemplateError } from './bill/memo.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** How one QuickBooks item becomes one ACE commodity line. */
export interface ItemExportProfile {
  /** Schedule B / HTS number. No default: it is item-specific and legally load-bearing. */
  scheduleB?: string;
  /** D (domestic) or F (foreign), or a country name the transformers can resolve. */
  origin?: string;
  licenseCode?: string;
  eccn?: string;
  exportInformationCode?: string;
  /** Unit of the QuickBooks line Quantity, when the line itself does not say. */
  quantityUom?: string;
  /** Unit ACE reports Quantity 1 in for this Schedule B number, e.g. KG. */
  aceUom1?: string;
  /** Quantity 1 is either the shipping weight in `aceUom1`, or the QuickBooks quantity. */
  quantity1From?: 'weight' | 'quantity';
  /** Weight of one QuickBooks unit, for items sold by the case/bag rather than by weight. */
  unitWeight?: number;
  /** Unit of `unitWeight`, e.g. lb or kg. */
  unitWeightUom?: string;
  /** Replaces the QuickBooks description, for items whose invoice text is not ACE-friendly. */
  description?: string;
}

export interface OutputConfig {
  /** Where the workbook is written. Relative paths resolve against the working directory. */
  directory: string;
  /** `{refNumber}`, `{txnId}`, `{date}` and `{customer}` are substituted. */
  fileNamePattern: string;
  /**
   * Unit written into the ShippingWeight/ShippingWeightUOM columns.
   * 'kg' writes the converted value (what ACE files); 'lb' writes the
   * QuickBooks value and lets the extension convert. Both produce the same
   * kilograms - the conversion is the same code either way.
   */
  weightUom: 'kg' | 'lb';
  /** Write the Audit sheet alongside the Shipment sheet. */
  includeAuditSheet: boolean;
}

/** What `ace-export bill` knows about one QuickBooks item (or its parent). */
export interface BillItemRule {
  /** Vendor full name the goods are bought from. */
  vendor?: string;
  /** Expense account the goods line posts to, e.g. "Purchase:Almonds". */
  account?: string;
}

export interface BillCommissionRule {
  /** Account the commission line posts to, e.g. "Commissions Income". */
  account: string;
  /** Fraction of the goods subtotal, 0 <= rate < 1. 0.02 is two percent. */
  rate: number;
  /** Overrides `bill.commissionMemoTemplate` for this vendor. */
  memoTemplate?: string;
}

export interface BillVendorRule {
  commission?: BillCommissionRule;
}

export interface BillConfig {
  /** QuickBooks item FullName -> its vendor and account. Hierarchical, per field. */
  items: Record<string, BillItemRule>;
  /** QuickBooks vendor FullName -> its commission rule. */
  vendors: Record<string, BillVendorRule>;
  /** QuickBooks customer FullName -> the short name used in memos. */
  customers: Record<string, { shortName: string }>;
  /** Memo on each goods line. */
  memoTemplate: string;
  /** Memo on the commission line. */
  commissionMemoTemplate: string;
  /** Memo on the bill header; empty writes none. */
  billMemoTemplate: string;
  /** Tag each goods line with the invoice's customer (CustomerRef, not billable). */
  tagLinesWithCustomer: boolean;
  /** File name of the calculation workbook `bill --excel` writes. */
  excelFileNamePattern: string;
}

export interface AceExportConfig {
  qbxmlVersion: string;
  /**
   * Identifies this application to QuickBooks. The pair (appId, appName) is
   * what the company file's integrated-application certificate is granted to,
   * so changing appName re-triggers the authorization prompt.
   */
  appId: string;
  appName: string;
  /** Empty means "whatever company file is open in QuickBooks right now". */
  companyFile: string;
  /** QuickBooks custom-field (DataExt) name -> canonical invoice field. */
  customFields: Record<string, string>;
  /** Built-in free-text fields: `Other` (header), `Other1`/`Other2` (line). */
  otherFields: Record<string, string>;
  /**
   * Custom fields that live on the *line* (QuickBooks item custom fields) ->
   * canonical commodity field. This is how a company that keeps Schedule B
   * numbers in QuickBooks gets them out without an item profile.
   */
  itemCustomFields: Record<string, string>;
  /** QuickBooks item FullName -> its customs profile. */
  items: Record<string, ItemExportProfile>;
  /** Applied to every line that has no item profile of its own. */
  itemDefaults: ItemExportProfile;
  /** Header values with no QuickBooks source at all, e.g. a fixed carrier. */
  invoiceDefaults: Partial<Record<InvoiceField, string>>;
  /** Overrides applied last, after every QuickBooks value. */
  manual: Partial<Record<InvoiceField, string>>;
  output: OutputConfig;
  bill: BillConfig;
}

export const DEFAULT_CONFIG: AceExportConfig = {
  qbxmlVersion: '16.0',
  appId: '',
  appName: 'ACE Export Helper',
  companyFile: '',
  customFields: {
    Vessel: 'vessel',
    Booking: 'bookingNumber',
    'Booking No': 'bookingNumber',
    Container: 'containerNumber',
    Seal: 'sealNumber',
    Destination: 'destination',
    'Freight Terms': 'freightTerms',
    Carrier: 'carrier',
  },
  otherFields: {},
  itemCustomFields: {},
  items: {},
  itemDefaults: {
    quantity1From: 'weight',
    aceUom1: 'KG',
  },
  invoiceDefaults: {},
  manual: {},
  output: {
    directory: '.',
    fileNamePattern: 'ACE_Invoice_{refNumber}.xlsx',
    weightUom: 'kg',
    includeAuditSheet: true,
  },
  bill: {
    items: {},
    vendors: {},
    customers: {},
    memoTemplate: '{quantity} {description} to {customerShortName}',
    commissionMemoTemplate: 'Commission {ratePercent}% on invoice {refNumber}',
    billMemoTemplate: '',
    tagLinesWithCustomer: false,
    excelFileNamePattern: 'Bill_{refNumber}.xlsx',
  },
};

const INVOICE_FIELD_SET = new Set<string>(INVOICE_FIELDS);
const COMMODITY_FIELD_SET = new Set<string>(COMMODITY_FIELDS);

/**
 * Commodity fields a custom field may fill.
 *
 * Quantity 1, the value and the shipping weight are deliberately absent: those
 * are what the invoice line is *for*, and letting a custom field override them
 * would mean an ACE filing could disagree with the invoice it came from.
 * Quantity 2 is allowed, because some Schedule B numbers require a second
 * reporting quantity that an invoice line has nowhere to put.
 */
export const MAPPABLE_COMMODITY_FIELDS: CommodityField[] = [
  'exportInformationCode',
  'scheduleB',
  'description',
  'uom1',
  'quantity2',
  'uom2',
  'origin',
  'eccn',
  'licenseCode',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringMap(value: unknown, where: string, scope: 'invoice' | 'commodity'): Record<string, string> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new ConfigError(`${where} must be an object of "name": "field" pairs.`);
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === '__proto__') continue;
    if (typeof raw !== 'string') throw new ConfigError(`${where}."${key}" must be a string.`);
    if (scope === 'invoice' && !INVOICE_FIELD_SET.has(raw)) {
      throw new ConfigError(
        `${where}."${key}" points at "${raw}", which is not a canonical invoice field. Valid fields: ${INVOICE_FIELDS.join(', ')}.`,
      );
    }
    if (scope === 'commodity' && (!COMMODITY_FIELD_SET.has(raw) || !MAPPABLE_COMMODITY_FIELDS.includes(raw as CommodityField))) {
      throw new ConfigError(
        `${where}."${key}" points at "${raw}", which is not a commodity field a custom field may fill. Valid fields: ${MAPPABLE_COMMODITY_FIELDS.join(', ')}.`,
      );
    }
    out[key] = raw;
  }
  return out;
}

function readInvoiceFieldMap(value: unknown, where: string): Partial<Record<InvoiceField, string>> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new ConfigError(`${where} must be an object of "field": "value" pairs.`);
  const out: Partial<Record<InvoiceField, string>> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === '__proto__') continue;
    if (!INVOICE_FIELD_SET.has(key)) {
      throw new ConfigError(`${where}."${key}" is not a canonical invoice field. Valid fields: ${INVOICE_FIELDS.join(', ')}.`);
    }
    if (typeof raw !== 'string') throw new ConfigError(`${where}."${key}" must be a string.`);
    out[key as InvoiceField] = raw;
  }
  return out;
}

function readItemProfile(value: unknown, where: string): ItemExportProfile {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new ConfigError(`${where} must be an object.`);

  const profile: ItemExportProfile = {};
  const strings: Array<keyof ItemExportProfile> = [
    'scheduleB',
    'origin',
    'licenseCode',
    'eccn',
    'exportInformationCode',
    'quantityUom',
    'aceUom1',
    'unitWeightUom',
    'description',
  ];
  for (const key of strings) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string') throw new ConfigError(`${where}.${key} must be a string.`);
    (profile[key] as string) = raw;
  }

  if (value['quantity1From'] !== undefined) {
    const raw = value['quantity1From'];
    if (raw !== 'weight' && raw !== 'quantity') {
      throw new ConfigError(`${where}.quantity1From must be "weight" or "quantity"; got ${JSON.stringify(raw)}.`);
    }
    profile.quantity1From = raw;
  }

  if (value['unitWeight'] !== undefined) {
    const raw = value['unitWeight'];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new ConfigError(`${where}.unitWeight must be a positive number.`);
    }
    profile.unitWeight = raw;
  }

  return profile;
}

function readItems(value: unknown): Record<string, ItemExportProfile> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new ConfigError('items must be an object keyed by QuickBooks item full name.');
  const out: Record<string, ItemExportProfile> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === '__proto__') continue;
    out[key] = readItemProfile(raw, `items."${key}"`);
  }
  return out;
}

function readOutput(value: unknown): OutputConfig {
  const output: OutputConfig = { ...DEFAULT_CONFIG.output };
  if (value === undefined) return output;
  if (!isPlainObject(value)) throw new ConfigError('output must be an object.');

  if (value['directory'] !== undefined) {
    if (typeof value['directory'] !== 'string') throw new ConfigError('output.directory must be a string.');
    output.directory = value['directory'];
  }
  if (value['fileNamePattern'] !== undefined) {
    if (typeof value['fileNamePattern'] !== 'string') throw new ConfigError('output.fileNamePattern must be a string.');
    if (!value['fileNamePattern'].toLowerCase().endsWith('.xlsx')) {
      throw new ConfigError('output.fileNamePattern must end in .xlsx.');
    }
    output.fileNamePattern = value['fileNamePattern'];
  }
  if (value['weightUom'] !== undefined) {
    if (value['weightUom'] !== 'kg' && value['weightUom'] !== 'lb') {
      throw new ConfigError('output.weightUom must be "kg" or "lb".');
    }
    output.weightUom = value['weightUom'];
  }
  if (value['includeAuditSheet'] !== undefined) {
    if (typeof value['includeAuditSheet'] !== 'boolean') throw new ConfigError('output.includeAuditSheet must be true or false.');
    output.includeAuditSheet = value['includeAuditSheet'];
  }
  return output;
}

function readTemplate(value: unknown, where: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new ConfigError(`${where} must be a string.`);
  try {
    assertMemoTemplate(value, where);
  } catch (error) {
    if (error instanceof MemoTemplateError) throw new ConfigError(error.message);
    throw error;
  }
  return value;
}

function readBillItems(value: unknown): Record<string, BillItemRule> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new ConfigError('bill.items must be an object keyed by QuickBooks item full name.');
  const out: Record<string, BillItemRule> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === '__proto__') continue;
    const where = `bill.items."${key}"`;
    if (!isPlainObject(raw)) throw new ConfigError(`${where} must be an object.`);
    const rule: BillItemRule = {};
    for (const field of ['vendor', 'account'] as const) {
      const item = raw[field];
      if (item === undefined) continue;
      if (typeof item !== 'string' || item.trim() === '') throw new ConfigError(`${where}.${field} must be a non-empty string.`);
      rule[field] = item;
    }
    out[key] = rule;
  }
  return out;
}

function readBillVendors(value: unknown): Record<string, BillVendorRule> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new ConfigError('bill.vendors must be an object keyed by QuickBooks vendor full name.');
  const out: Record<string, BillVendorRule> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === '__proto__') continue;
    const where = `bill.vendors."${key}"`;
    if (!isPlainObject(raw)) throw new ConfigError(`${where} must be an object.`);
    const rule: BillVendorRule = {};
    if (raw['commission'] !== undefined) {
      const commission = raw['commission'];
      if (!isPlainObject(commission)) throw new ConfigError(`${where}.commission must be an object with account and rate.`);
      const account = commission['account'];
      if (typeof account !== 'string' || account.trim() === '') {
        throw new ConfigError(`${where}.commission.account must be a non-empty string.`);
      }
      const rate = commission['rate'];
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate >= 1) {
        throw new ConfigError(`${where}.commission.rate must be a number from 0 up to but not including 1 (0.02 is two percent).`);
      }
      rule.commission = { account, rate };
      if (commission['memoTemplate'] !== undefined) {
        rule.commission.memoTemplate = readTemplate(commission['memoTemplate'], `${where}.commission.memoTemplate`, '');
      }
    }
    out[key] = rule;
  }
  return out;
}

function readBillCustomers(value: unknown): Record<string, { shortName: string }> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new ConfigError('bill.customers must be an object keyed by QuickBooks customer full name.');
  const out: Record<string, { shortName: string }> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === '__proto__') continue;
    const where = `bill.customers."${key}"`;
    if (!isPlainObject(raw)) throw new ConfigError(`${where} must be an object with a shortName.`);
    const shortName = raw['shortName'];
    if (typeof shortName !== 'string' || shortName.trim() === '') throw new ConfigError(`${where}.shortName must be a non-empty string.`);
    out[key] = { shortName };
  }
  return out;
}

function readBill(value: unknown): BillConfig {
  const defaults = DEFAULT_CONFIG.bill;
  if (value === undefined) return structuredClone(defaults);
  if (!isPlainObject(value)) throw new ConfigError('bill must be an object.');

  const bill: BillConfig = {
    items: readBillItems(value['items']),
    vendors: readBillVendors(value['vendors']),
    customers: readBillCustomers(value['customers']),
    memoTemplate: readTemplate(value['memoTemplate'], 'bill.memoTemplate', defaults.memoTemplate),
    commissionMemoTemplate: readTemplate(value['commissionMemoTemplate'], 'bill.commissionMemoTemplate', defaults.commissionMemoTemplate),
    billMemoTemplate: readTemplate(value['billMemoTemplate'], 'bill.billMemoTemplate', defaults.billMemoTemplate),
    tagLinesWithCustomer: defaults.tagLinesWithCustomer,
    excelFileNamePattern: defaults.excelFileNamePattern,
  };
  if (value['tagLinesWithCustomer'] !== undefined) {
    if (typeof value['tagLinesWithCustomer'] !== 'boolean') throw new ConfigError('bill.tagLinesWithCustomer must be true or false.');
    bill.tagLinesWithCustomer = value['tagLinesWithCustomer'];
  }
  if (value['excelFileNamePattern'] !== undefined) {
    if (typeof value['excelFileNamePattern'] !== 'string') throw new ConfigError('bill.excelFileNamePattern must be a string.');
    if (!value['excelFileNamePattern'].toLowerCase().endsWith('.xlsx')) throw new ConfigError('bill.excelFileNamePattern must end in .xlsx.');
    bill.excelFileNamePattern = value['excelFileNamePattern'];
  }
  return bill;
}

/** Validate a parsed JSON object into a configuration, filling in defaults. */
export function normalizeConfig(input: unknown): AceExportConfig {
  if (input === undefined || input === null) return structuredClone(DEFAULT_CONFIG);
  if (!isPlainObject(input)) throw new ConfigError('The configuration file must contain a JSON object.');

  const config: AceExportConfig = {
    qbxmlVersion: typeof input['qbxmlVersion'] === 'string' ? input['qbxmlVersion'] : DEFAULT_CONFIG.qbxmlVersion,
    appId: typeof input['appId'] === 'string' ? input['appId'] : DEFAULT_CONFIG.appId,
    appName: typeof input['appName'] === 'string' ? input['appName'] : DEFAULT_CONFIG.appName,
    companyFile: typeof input['companyFile'] === 'string' ? input['companyFile'] : DEFAULT_CONFIG.companyFile,
    customFields: input['customFields'] === undefined
      ? { ...DEFAULT_CONFIG.customFields }
      : readStringMap(input['customFields'], 'customFields', 'invoice'),
    otherFields: readStringMap(input['otherFields'], 'otherFields', 'invoice'),
    itemCustomFields: readStringMap(input['itemCustomFields'], 'itemCustomFields', 'commodity'),
    items: readItems(input['items']),
    itemDefaults: input['itemDefaults'] === undefined
      ? { ...DEFAULT_CONFIG.itemDefaults }
      : { ...DEFAULT_CONFIG.itemDefaults, ...readItemProfile(input['itemDefaults'], 'itemDefaults') },
    invoiceDefaults: readInvoiceFieldMap(input['invoiceDefaults'], 'invoiceDefaults'),
    manual: readInvoiceFieldMap(input['manual'], 'manual'),
    output: readOutput(input['output']),
    bill: readBill(input['bill']),
  };

  if (!/^\d{1,2}\.\d$/.test(config.qbxmlVersion)) {
    throw new ConfigError(`qbxmlVersion must look like "16.0"; got "${config.qbxmlVersion}".`);
  }
  if (config.appName.trim() === '') {
    throw new ConfigError('appName must not be empty: QuickBooks shows it in the authorization prompt.');
  }

  return config;
}

export function loadConfigFile(path: string): AceExportConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigError(`Could not read the configuration file "${path}": ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`"${path}" is not valid JSON: ${(error as Error).message}`);
  }
  return normalizeConfig(parsed);
}

export function writeConfigFile(path: string, config: AceExportConfig): void {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/**
 * Item names are hierarchical ("Almonds:Shelled Almonds:Carmel"). The names a
 * rule may live under, nearest first: the item itself, then each parent.
 */
export function itemNameCandidates(itemFullName: string): string[] {
  const parts = itemFullName.split(':');
  const names: string[] = [];
  for (let depth = parts.length; depth > 0; depth -= 1) names.push(parts.slice(0, depth).join(':'));
  return names;
}

/** The profile that applies to one item: its own entry over the defaults. */
export function profileForItem(config: AceExportConfig, itemFullName: string): ItemExportProfile {
  // A profile on the parent applies to its children unless the child has its
  // own; the child's profile then replaces the parent's whole, not per field.
  for (const name of itemNameCandidates(itemFullName)) {
    const profile = config.items[name];
    if (profile) return { ...config.itemDefaults, ...profile };
  }
  return { ...config.itemDefaults };
}

export interface ResolvedBillRule {
  vendor: { value: string; source: string } | null;
  account: { value: string; source: string } | null;
}

/**
 * The vendor and account for one item, each resolved separately to the
 * nearest name in the hierarchy that sets it. Unlike `profileForItem`, this
 * is per field: `bill.items."Almonds"` may name the vendor while
 * `bill.items."Almonds:Carmel"` names only the account. `source` is the
 * config key the value came from, for the preview.
 */
export function billRuleForItem(config: AceExportConfig, itemFullName: string): ResolvedBillRule {
  const resolved: ResolvedBillRule = { vendor: null, account: null };
  for (const name of itemNameCandidates(itemFullName)) {
    const rule = config.bill.items[name];
    if (!rule) continue;
    if (resolved.vendor === null && rule.vendor !== undefined) {
      resolved.vendor = { value: rule.vendor, source: `bill.items."${name}".vendor` };
    }
    if (resolved.account === null && rule.account !== undefined) {
      resolved.account = { value: rule.account, source: `bill.items."${name}".account` };
    }
    if (resolved.vendor && resolved.account) break;
  }
  return resolved;
}

/** A starter configuration carrying the sample invoice's item, for `init`. */
export function starterConfig(): AceExportConfig {
  const config = structuredClone(DEFAULT_CONFIG);
  config.items = {
    'Shelled Almonds': {
      scheduleB: '0802.12.0000',
      origin: 'D',
      licenseCode: 'C33',
      eccn: 'EAR99',
      exportInformationCode: 'OS',
      quantityUom: 'lb',
      aceUom1: 'KG',
      quantity1From: 'weight',
    },
  };
  config.bill.items = {
    'Shelled Almonds': { vendor: 'Blue Diamond Growers', account: 'Cost of Goods Sold:Almonds' },
  };
  config.bill.vendors = {
    'Blue Diamond Growers': { commission: { account: 'Commissions Income', rate: 0.02 } },
  };
  config.bill.customers = {
    'Aydin Kuruyemis San Ve Tic A.S': { shortName: 'Aydin' },
  };
  return config;
}
