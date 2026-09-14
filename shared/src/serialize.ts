/**
 * FilingPackage <-> filing-package.json, defensively.
 *
 * The file is untrusted input. The two halves are validated by their own
 * parsers (the canonical shipment by shape, the Deckhand shipment by
 * `parseDeckhandShipment`), the operator's decisions are read with their keys
 * checked, and then the merged values are REBUILT from those rather than
 * trusted from the file. A hand-edited "resolved" value cannot get in: only
 * the sources and the decisions are persisted facts.
 */

import { COMMODITY_FIELDS, INVOICE_FIELDS, type CanonicalShipment } from '../../src/models/CanonicalInvoice.js';
import { parseDeckhandShipment } from '../../deckhand/src/serialize.js';
import { buildFilingPackage } from './builder.js';
import {
  FILING_PACKAGE_SCHEMA_VERSION,
  PACKAGE_CONTAINER_FIELDS,
  PACKAGE_HEADER_FIELDS,
  emptyDecisions,
  type CommercialSource,
  type FilingPackage,
  type PackageContainerField,
  type PackageDecisions,
  type PackageHeaderField,
} from './filingPackage.js';

export class FilingPackageParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilingPackageParseError';
  }
}

const MAX_LINES = 2000;
const MAX_TEXT = 500;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function provenanceRecord(value: unknown): Record<string, { column: string; original: string; transform: string | null; normalized: string }> {
  const out: Record<string, { column: string; original: string; transform: string | null; normalized: string }> = {};
  if (!isObject(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (key === '__proto__' || !isObject(entry)) continue;
    out[key] = {
      column: text(entry['column'], 100),
      original: text(entry['original']),
      transform: typeof entry['transform'] === 'string' ? entry['transform'].slice(0, 200) : null,
      normalized: text(entry['normalized']),
    };
  }
  return out;
}

/** Shape-check a CanonicalShipment. Numbers stay numbers, strings stay strings, everything else is dropped. */
export function parseCanonicalShipment(input: unknown): CanonicalShipment {
  if (!isObject(input) || !isObject(input['invoice']) || !Array.isArray(input['commodities'])) {
    throw new FilingPackageParseError('The commercial half of the package is not a canonical shipment.');
  }
  if (input['commodities'].length > MAX_LINES) throw new FilingPackageParseError('Too many commodity lines.');

  const invoiceRaw = input['invoice'];
  const invoice = Object.fromEntries(INVOICE_FIELDS.map((field) => [field, text(invoiceRaw[field])])) as unknown as CanonicalShipment['invoice'];

  const commodities = input['commodities'].map((raw, index) => {
    if (!isObject(raw)) throw new FilingPackageParseError(`commodities[${index}] is not a commodity line.`);
    const line = Number.isInteger(raw['line']) && (raw['line'] as number) > 0 ? (raw['line'] as number) : index + 1;
    const out: Record<string, unknown> = { line };
    for (const field of COMMODITY_FIELDS) {
      const numeric = field === 'quantity1' || field === 'quantity2' || field === 'valueOfGoods' || field === 'shippingWeight';
      out[field] = numeric ? numberOrNull(raw[field]) : text(raw[field]);
    }
    return out as unknown as CanonicalShipment['commodities'][number];
  });

  const provenanceRaw = isObject(input['provenance']) ? input['provenance'] : {};
  const commodityProvenance: CanonicalShipment['provenance']['commodities'] = {};
  if (isObject(provenanceRaw['commodities'])) {
    for (const [line, record] of Object.entries(provenanceRaw['commodities'])) {
      if (line === '__proto__') continue;
      const number = Number(line);
      if (Number.isInteger(number) && number > 0) commodityProvenance[number] = provenanceRecord(record);
    }
  }

  const sourceRaw = isObject(input['source']) ? input['source'] : {};
  return {
    invoice,
    commodities,
    provenance: { invoice: provenanceRecord(provenanceRaw['invoice']), commodities: commodityProvenance },
    source: {
      fileName: text(sourceRaw['fileName'], 200),
      sheetName: text(sourceRaw['sheetName'], 100),
      importedAt: text(sourceRaw['importedAt'], 40),
      rowCount: Number.isInteger(sourceRaw['rowCount']) ? (sourceRaw['rowCount'] as number) : commodities.length,
      headers: Array.isArray(sourceRaw['headers']) ? sourceRaw['headers'].filter((item): item is string => typeof item === 'string').slice(0, 200) : [],
      unknownHeaders: Array.isArray(sourceRaw['unknownHeaders']) ? sourceRaw['unknownHeaders'].filter((item): item is string => typeof item === 'string').slice(0, 200) : [],
    },
  };
}

function parseCommercialSource(value: unknown): CommercialSource | null {
  if (!isObject(value)) return null;
  const id = value['id'] === 'quickbooks-export' ? 'quickbooks-export' : value['id'] === 'excel' ? 'excel' : null;
  if (!id) return null;
  return { id, label: text(value['label'], 100) || (id === 'excel' ? 'Excel workbook' : 'QuickBooks export'), detail: text(value['detail'], 300) };
}

function parseDecisions(value: unknown): PackageDecisions {
  const out = emptyDecisions();
  if (!isObject(value)) return out;
  if (isObject(value['resolutions'])) {
    for (const [id, choice] of Object.entries(value['resolutions'])) {
      if (id === '__proto__' || id.length > 100) continue;
      if (choice === 'commercial' || choice === 'deckhand') out.resolutions[id] = choice;
    }
  }
  if (isObject(value['manualHeader'])) {
    for (const [field, typed] of Object.entries(value['manualHeader'])) {
      if ((PACKAGE_HEADER_FIELDS as readonly string[]).includes(field) && typeof typed === 'string') {
        out.manualHeader[field as PackageHeaderField] = typed.slice(0, MAX_TEXT);
      }
    }
  }
  if (isObject(value['manualContainers'])) {
    for (const [index, entry] of Object.entries(value['manualContainers'])) {
      const number = Number(index);
      if (!Number.isInteger(number) || number < 0 || number > 500 || !isObject(entry)) continue;
      const fields: Partial<Record<PackageContainerField, string>> = {};
      for (const [field, typed] of Object.entries(entry)) {
        if ((PACKAGE_CONTAINER_FIELDS as readonly string[]).includes(field) && typeof typed === 'string') {
          fields[field as PackageContainerField] = typed.slice(0, MAX_TEXT);
        }
      }
      out.manualContainers[number] = fields;
    }
  }
  return out;
}

/** Parse a decoded JSON value. The merged values are rebuilt, never trusted. */
export function parseFilingPackage(input: unknown): FilingPackage {
  if (!isObject(input)) throw new FilingPackageParseError('A filing package must be a JSON object.');
  if (input['schemaVersion'] !== FILING_PACKAGE_SCHEMA_VERSION) {
    throw new FilingPackageParseError(`Unsupported filing package schema version "${String(input['schemaVersion'])}" (expected ${FILING_PACKAGE_SCHEMA_VERSION}).`);
  }
  const invoice = input['invoice'] === null || input['invoice'] === undefined ? null : parseCanonicalShipment(input['invoice']);
  const shipment = input['shipment'] === null || input['shipment'] === undefined ? null : parseDeckhandShipment(input['shipment']);
  const review = isObject(input['review']) ? input['review'] : {};
  const approved = review['deckhand'] === 'approved';
  const createdAt = text(input['createdAt'], 40);
  const created = new Date(createdAt);

  return buildFilingPackage({
    invoice,
    commercialSource: parseCommercialSource(input['commercialSource']),
    shipment,
    deckhandApproved: approved,
    approvedAt: approved ? text(review['approvedAt'], 40) || null : null,
    decisions: parseDecisions(input['decisions']),
    now: Number.isNaN(created.getTime()) ? new Date() : created,
    ...(text(input['packageId'], 120) ? { packageId: text(input['packageId'], 120) } : {}),
  });
}

export function parseFilingPackageJson(json: string): FilingPackage {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new FilingPackageParseError('The file is not valid JSON.');
  }
  return parseFilingPackage(value);
}

export function serializeFilingPackage(pkg: FilingPackage): string {
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** A quick look at bytes: does this look like a filing package at all? */
export function looksLikeFilingPackage(json: string): boolean {
  return /"schemaVersion"\s*:\s*"1\.0"/.test(json) && /"header"\s*:/.test(json) && /"containers"\s*:/.test(json);
}
