/**
 * The operator workflow, as pure functions over a ShipmentRecord.
 *
 *   import a workbook or a package  ->  paste the email, extract, approve
 *   ->  build the package, resolve conflicts, type what nobody holds
 *   ->  download filing-package.json (and the ACE workbook when useful)
 *
 * Every step below calls the same code the two extension panels and the
 * QuickBooks companion call: `src/sources` for the workbook, `deckhand/` for
 * the extraction and its review, `shared/` for the package. Nothing is
 * re-implemented here; this file only sequences those calls and records what
 * happened. Each function returns a new record and never mutates its input,
 * so the screen can re-render from the result and a test can compare before
 * and after.
 *
 * Rebuild rule, borrowed from the panels: when the invoice or the extraction
 * changes and a package already exists, the package is rebuilt from the new
 * sources with the operator's decisions kept. The merged values are never
 * edited in place.
 */

import { DEFAULT_SETTINGS, type AceHelperSettings } from '../../src/core/settings.js';
import { MappingError } from '../../src/excel/canonicalMapper.js';
import { ExcelReadError } from '../../src/excel/excelReader.js';
import { validateShipment } from '../../src/excel/validator.js';
import { loadFromBytes, SourceError } from '../../src/sources/index.js';
import type { SourceDescriptor } from '../../src/sources/InvoiceDataSource.js';
import { approveShipment, buildReview, extractShipment, type DeckhandInput, type DeckhandShipment } from '../../deckhand/src/index.js';
import {
  aceShipmentFromPackage,
  buildFilingPackage,
  filingPackageFileName,
  FilingPackageError,
  FilingPackageParseError,
  looksLikeFilingPackage,
  parseFilingPackageJson,
  serializeFilingPackage,
  type AceView,
  type CommercialSource,
  type FilingPackage,
} from '../../shared/src/index.js';
import type { CommercialImport, ShipmentRecord } from './state.js';

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowError';
  }
}

let counter = 0;

function newId(): string {
  const generator = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (generator && typeof generator.randomUUID === 'function') return generator.randomUUID();
  counter += 1;
  return `shipment-${Date.now().toString(36)}-${counter}`;
}

function note(record: ShipmentRecord, message: string, now: Date): ShipmentRecord {
  return { ...record, activity: [...record.activity, { at: now.toISOString(), message }] };
}

function describeError(error: unknown): string {
  if (error instanceof ExcelReadError || error instanceof MappingError || error instanceof SourceError) return error.message;
  if (error instanceof FilingPackageParseError) return `Not a filing package: ${error.message}`;
  if (error instanceof FilingPackageError) return error.message;
  return (error as Error).message;
}

// ------------------------------------------------------------- shipments

export function newShipment(name = '', now: Date = new Date()): ShipmentRecord {
  return {
    id: newId(),
    name: name.trim(),
    createdAt: now.toISOString(),
    commercial: null,
    extraction: null,
    emailDraft: '',
    pkg: null,
    activity: [{ at: now.toISOString(), message: 'Shipment opened.' }],
  };
}

export function renameShipment(record: ShipmentRecord, name: string): ShipmentRecord {
  return { ...record, name: name.trim() };
}

/** What to call this shipment on screen: the operator's name, else the package id, else the invoice or booking, else a placeholder. */
export function shipmentLabel(record: ShipmentRecord): string {
  if (record.name !== '') return record.name;
  if (record.pkg) return record.pkg.packageId;
  const invoice = record.commercial?.shipment.invoice.invoiceNumber ?? '';
  const booking = record.extraction?.shipment.bookingReference.value ?? '';
  const parts = [invoice, booking].filter((part) => part !== '');
  return parts.length ? parts.join(' / ') : 'New shipment';
}

// ---------------------------------------------------------------- imports

function commercialSourceOf(source: SourceDescriptor, pkg: FilingPackage | null): CommercialSource | null {
  if (source.id === 'filing-package') return pkg?.commercialSource ?? null;
  if (source.id === 'excel' || source.id === 'quickbooks-export') return { id: source.id, label: source.label, detail: source.detail };
  return null;
}

/** Rebuild the package from the record's current sources, keeping the decisions. */
function rebuild(record: ShipmentRecord, now: Date): FilingPackage | null {
  if (!record.pkg) return null;
  if (!record.commercial && !record.extraction) return null;
  return buildFilingPackage({
    invoice: record.commercial?.shipment ?? null,
    commercialSource: record.commercial ? commercialSourceOf(record.commercial.source, record.pkg) : null,
    shipment: record.extraction?.shipment ?? null,
    deckhandApproved: !!record.extraction?.approvedAt,
    approvedAt: record.extraction?.approvedAt ?? null,
    decisions: record.pkg.decisions,
    now,
  });
}

/**
 * An ACE workbook: the template filled in by hand, or the one the QuickBooks
 * companion wrote. Read through the extension's own source registry, so the
 * dashboard cannot read a workbook differently from the ACE Helper.
 */
export function importWorkbook(
  record: ShipmentRecord,
  bytes: Uint8Array,
  fileName: string,
  settings: AceHelperSettings = DEFAULT_SETTINGS,
  now: Date = new Date(),
): ShipmentRecord {
  let loaded: ReturnType<typeof loadFromBytes>;
  try {
    loaded = loadFromBytes(bytes, fileName, { settings });
  } catch (error) {
    throw new WorkflowError(describeError(error));
  }
  const commercial: CommercialImport = {
    shipment: loaded.shipment,
    validation: loaded.validation,
    notes: loaded.notes,
    source: loaded.source,
    fileName,
  };
  const next: ShipmentRecord = { ...record, commercial };
  const pkg = rebuild(next, now);
  return note(
    { ...next, pkg },
    `${loaded.source.label} imported from ${fileName}: ${loaded.shipment.commodities.length} line(s), ${loaded.validation.errors} error(s), ${loaded.validation.warnings} warning(s).${pkg ? ' Package rebuilt.' : ''}`,
    now,
  );
}

/**
 * A filing-package.json, from either panel or from `ace-export package`. The
 * file is parsed by the shared parser, which rebuilds the merged values from
 * the two halves and the decisions rather than trusting them; the record
 * then holds the same three things the file carried.
 */
export function importPackage(record: ShipmentRecord, text: string, fileName: string, now: Date = new Date()): ShipmentRecord {
  if (!looksLikeFilingPackage(text)) {
    throw new WorkflowError(`"${fileName}" is not a filing package. Open a filing-package.json written by the ACE Helper, the INTTRA Helper or ace-export.`);
  }
  let pkg: FilingPackage;
  try {
    pkg = parseFilingPackageJson(text);
  } catch (error) {
    throw new WorkflowError(describeError(error));
  }
  const commercial: CommercialImport | null = pkg.invoice
    ? {
        shipment: pkg.invoice,
        validation: validateShipment(pkg.invoice),
        notes: [],
        source: pkg.commercialSource
          ? { id: pkg.commercialSource.id, label: pkg.commercialSource.label, detail: pkg.commercialSource.detail }
          : { id: 'excel', label: 'Excel workbook', detail: 'carried by the package' },
        fileName,
      }
    : null;
  const extraction = pkg.shipment ? { shipment: pkg.shipment, approvedAt: pkg.review.approvedAt } : null;
  return note(
    { ...record, commercial, extraction, pkg },
    `Filing package ${pkg.packageId} opened from ${fileName}: ${pkg.containers.length} container(s), ${pkg.conflicts.length} conflict(s), Deckhand ${pkg.review.deckhand}.`,
    now,
  );
}

/** Either kind of file, decided by its name and contents, never by guessing at bytes. */
export function importFile(
  record: ShipmentRecord,
  bytes: Uint8Array,
  fileName: string,
  settings: AceHelperSettings = DEFAULT_SETTINGS,
  now: Date = new Date(),
): ShipmentRecord {
  if (/\.json$/i.test(fileName)) return importPackage(record, new TextDecoder('utf-8').decode(bytes), fileName, now);
  return importWorkbook(record, bytes, fileName, settings, now);
}

// --------------------------------------------------------------- deckhand

export function setEmailDraft(record: ShipmentRecord, text: string): ShipmentRecord {
  return { ...record, emailDraft: text };
}

/** Extract with Deckhand's rules extractor. The result is pending until approved. */
export function extractDocument(record: ShipmentRecord, input: DeckhandInput, now: Date = new Date()): ShipmentRecord {
  return attachExtraction(record, extractShipment(input), now);
}

/** An extraction produced elsewhere (the shared Deckhand tab extracts on its own) becomes this shipment's pending extraction. */
export function attachExtraction(record: ShipmentRecord, shipment: DeckhandShipment, now: Date = new Date()): ShipmentRecord {
  const review = buildReview(shipment);
  const next: ShipmentRecord = { ...record, extraction: { shipment, approvedAt: null } };
  const pkg = rebuild(next, now);
  return note({ ...next, pkg }, `Deckhand extracted ${shipment.source.name}: ${review.summary}.${pkg ? ' Package rebuilt; approval needed again.' : ''}`, now);
}

/** The operator read the review and approved it. Refused while the review has a blocking problem. */
export function approveExtraction(record: ShipmentRecord, now: Date = new Date()): ShipmentRecord {
  if (!record.extraction) throw new WorkflowError('There is no extraction to approve. Paste the email and press Extract first.');
  let approvedAt: string;
  try {
    approvedAt = approveShipment(record.extraction.shipment, now).approvedAt;
  } catch (error) {
    throw new WorkflowError((error as Error).message);
  }
  const next: ShipmentRecord = { ...record, extraction: { shipment: record.extraction.shipment, approvedAt } };
  const pkg = rebuild(next, now);
  return note({ ...next, pkg }, `Deckhand extraction approved (${record.extraction.shipment.containers.length} container(s)).`, now);
}

export function discardExtraction(record: ShipmentRecord, now: Date = new Date()): ShipmentRecord {
  const next: ShipmentRecord = { ...record, extraction: null };
  const pkg = rebuild(next, now);
  return note({ ...next, pkg }, 'Deckhand extraction discarded.', now);
}

// ---------------------------------------------------------------- package

export function canBuild(record: ShipmentRecord): { ok: boolean; reason: string } {
  if (!record.commercial && !record.extraction) {
    return { ok: false, reason: 'Import the invoice (an ACE workbook) or paste the carrier email first. A package needs at least one of them.' };
  }
  return { ok: true, reason: '' };
}

/** Build, or rebuild, the package from the current sources. Existing decisions are kept. */
export function buildPackage(record: ShipmentRecord, now: Date = new Date()): ShipmentRecord {
  const buildable = canBuild(record);
  if (!buildable.ok) throw new WorkflowError(buildable.reason);
  const pkg = buildFilingPackage({
    invoice: record.commercial?.shipment ?? null,
    commercialSource: record.commercial ? commercialSourceOf(record.commercial.source, record.pkg) : null,
    shipment: record.extraction?.shipment ?? null,
    deckhandApproved: !!record.extraction?.approvedAt,
    approvedAt: record.extraction?.approvedAt ?? null,
    decisions: record.pkg?.decisions,
    now,
  });
  return note({ ...record, pkg }, `Filing package ${pkg.packageId} built: ${pkg.containers.length} container(s), ${pkg.conflicts.length} conflict(s).`, now);
}

/**
 * The package changed through one of the shared operations (a conflict
 * resolved, a manual value typed, the Deckhand half approved on the package
 * screen). The record follows it: an approval recorded in the package is
 * copied onto the extraction so the two never disagree.
 */
export function replacePackage(record: ShipmentRecord, pkg: FilingPackage, message: string, now: Date = new Date()): ShipmentRecord {
  let extraction = record.extraction;
  if (pkg.review.deckhand === 'approved' && extraction && !extraction.approvedAt) {
    extraction = { shipment: extraction.shipment, approvedAt: pkg.review.approvedAt };
  }
  return note({ ...record, pkg, extraction }, message, now);
}

export function discardPackage(record: ShipmentRecord, now: Date = new Date()): ShipmentRecord {
  return note({ ...record, pkg: null }, 'Filing package discarded. The invoice and the extraction are kept.', now);
}

export function packageText(record: ShipmentRecord): string | null {
  return record.pkg ? serializeFilingPackage(record.pkg) : null;
}

export function packageFileName(record: ShipmentRecord): string {
  return record.pkg ? filingPackageFileName(record.pkg) : 'filing-package.json';
}

// --------------------------------------------------------------- ACE view

export interface AceData {
  view: AceView;
  validation: ReturnType<typeof validateShipment>;
  notes: CommercialImport['notes'];
  source: SourceDescriptor;
  /** True when the booking, vessel, container and seal come from the approved extraction. */
  fromPackage: boolean;
}

/**
 * What the ACE Helper would see: the package's ACE view when there is a
 * package with commercial data (booking, vessel, container and seal overlaid
 * from the approved extraction), else the imported workbook as it is.
 */
export function aceData(record: ShipmentRecord): AceData | null {
  if (record.pkg && record.pkg.invoice) {
    const view = aceShipmentFromPackage(record.pkg);
    return {
      view,
      validation: validateShipment(view.shipment),
      notes: [...view.notes, ...record.pkg.notes.map((item) => ({ severity: item.severity, message: `Package: ${item.message}` }))],
      source: { id: 'filing-package', label: 'Filing package', detail: `${record.pkg.packageId} - ${record.pkg.commercialSource?.label ?? 'no commercial data'}` },
      fromPackage: true,
    };
  }
  if (record.commercial) {
    return {
      view: { shipment: record.commercial.shipment, notes: [] },
      validation: record.commercial.validation,
      notes: record.commercial.notes,
      source: record.commercial.source,
      fromPackage: false,
    };
  }
  return null;
}
