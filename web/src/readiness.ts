/**
 * Readiness, in one screen: what ACE will get, what INTTRA will get, and what
 * the operator still has to do.
 *
 * Nothing here is a new rule. ACE readiness is the extension's own data
 * quality gate (`buildPreflight`) and mapping status (`buildMappingStatus`),
 * run offline. INTTRA readiness reads the INTTRA Helper's own mapping tables
 * and grid columns against the package, so the dashboard says "missing" for
 * exactly the fields the helper would skip. The fill gate is the shared one.
 *
 * What the dashboard cannot know is whether a selector resolves on a live
 * portal: that is decided by the extension, in front of the form, and the
 * screens say so rather than pretending.
 */

import { DEFAULT_SETTINGS, type AceHelperSettings } from '../../src/core/settings.js';
import { buildPreflight, type PreflightResult } from '../../src/ui/preflight.js';
import { buildMappingStatus, summarizeMappingStatus, type MappingStatusRow, type MappingStatusSummary } from '../../src/ui/mappingStatus.js';
import { ALL_INTTRA_MAPPINGS, GRID_COLUMNS } from '../../inttra-extension/src/mappings/index.js';
import { inttraPageLabel } from '../../inttra-extension/src/pages.js';
import type { InttraPageId } from '../../inttra-extension/src/models/InttraField.js';
import {
  buildFilingPackage,
  describeProvenance,
  fillGate,
  normalizedContainerNumber,
  PACKAGE_CONTAINER_FIELDS,
  PACKAGE_CONTAINER_LABELS,
  PACKAGE_HEADER_FIELDS,
  PACKAGE_HEADER_LABELS,
  SOURCE_LABELS,
  type FilingPackage,
  type FillGate,
  type PackageContainer,
  type PackageContainerField,
  type PackageHeaderField,
  type Provenanced,
  type ValueSource,
} from '../../shared/src/index.js';
import { buildReview } from '../../deckhand/src/index.js';
import type { ShipmentRecord } from './state.js';
import { aceData, canBuild, type AceData } from './workflow.js';

export type ReadinessStatus = 'ready' | 'review' | 'blocked' | 'unavailable';

// ---------------------------------------------------------------------- ACE

export interface AceReadiness {
  status: ReadinessStatus;
  /** Why it is unavailable, when it is. */
  reason: string;
  data: AceData | null;
  preflight: PreflightResult | null;
  mapping: MappingStatusRow[];
  summary: MappingStatusSummary | null;
  /** Commodity line the line-scoped mapping rows describe. */
  line: number;
}

export interface AceCounts {
  total: number;
  /** Rows with an ACE value to write. */
  withValue: number;
  /** Expected by ACE, no value in the data. */
  missing: number;
  /** Written, but with a note to read. */
  review: number;
  /** Cannot be turned into something ACE accepts. */
  error: number;
}

/** What the offline mapping status can say: the page has not been looked at, so "found" is not among the counts. */
export function aceCounts(rows: MappingStatusRow[]): AceCounts {
  return {
    total: rows.length,
    withValue: rows.filter((row) => row.aceValue !== '').length,
    missing: rows.filter((row) => row.status === 'MISSING').length,
    review: rows.filter((row) => row.status === 'REVIEW').length,
    error: rows.filter((row) => row.status === 'ERROR').length,
  };
}

export function aceReadiness(record: ShipmentRecord, settings: AceHelperSettings = DEFAULT_SETTINGS, line?: number): AceReadiness {
  const data = aceData(record);
  if (!data) {
    return {
      status: 'unavailable',
      reason: 'ACE needs the invoice and its commodity lines. Import the ACE workbook (from the template or from ace-export), or open a package that carries one.',
      data: null,
      preflight: null,
      mapping: [],
      summary: null,
      line: 1,
    };
  }
  const shipment = data.view.shipment;
  const selected = line ?? shipment.commodities[0]?.line ?? 1;
  const preflight = buildPreflight(shipment, data.validation, data.notes);
  const mapping = buildMappingStatus(shipment, { settings, line: selected, source: data.source });
  const summary = summarizeMappingStatus(mapping);
  const status: ReadinessStatus = !preflight.ready || summary.blocked > 0 ? 'blocked' : preflight.warnings.length || summary.review > 0 ? 'review' : 'ready';
  return { status, reason: '', data, preflight, mapping, summary, line: selected };
}

// ------------------------------------------------------------------- INTTRA

export type InttraValueStatus = 'ready' | 'missing' | 'empty';

export interface InttraFieldReadiness {
  key: string;
  label: string;
  value: string;
  provenance: string;
  /** 'missing' when the screen expects it and no source holds it; 'empty' when it is optional and empty. */
  status: InttraValueStatus;
  expected: boolean;
}

export interface InttraScreenReadiness {
  page: InttraPageId;
  label: string;
  /** For Container & Cargo: which container the rows describe. */
  containerIndex?: number;
  fields: InttraFieldReadiness[];
  ready: number;
  missing: number;
}

export interface InttraGridRow {
  index: number;
  containerNumber: string;
  cells: InttraFieldReadiness[];
}

export interface InttraReadiness {
  status: ReadinessStatus;
  reason: string;
  pkg: FilingPackage | null;
  gate: FillGate | null;
  screens: InttraScreenReadiness[];
  grid: { columns: string[]; rows: InttraGridRow[] };
  /** Placeholder selectors: the helper must still find every field on the live screen. */
  unverifiedFields: number;
}

/** `header.x` or `container.x`, as the INTTRA filler resolves it. */
function packageValue(source: string, pkg: FilingPackage, container: PackageContainer | null): Provenanced | null {
  const [root, field] = source.split('.');
  if (root === 'header' && field) return pkg.header[field as PackageHeaderField] ?? null;
  if (root === 'container' && field && container) {
    if (field === 'containerNumber') return { ...container.containerNumber, value: normalizedContainerNumber(container) };
    return container[field as PackageContainerField] ?? null;
  }
  return null;
}

function fieldReadiness(key: string, label: string, item: Provenanced | null, expected: boolean): InttraFieldReadiness {
  const value = item?.value ?? '';
  const present = value !== '' && item?.source !== 'missing';
  return {
    key,
    label,
    value,
    provenance: item && present ? describeProvenance(item) + (item.detail ? ` - ${item.detail}` : '') : (item?.detail ?? 'not held by any source'),
    status: present ? 'ready' : expected ? 'missing' : 'empty',
    expected,
  };
}

const INTTRA_FORM_PAGES: InttraPageId[] = ['generalDetails', 'containerCargo', 'printInstructions', 'blDocuments'];

export function inttraReadiness(record: ShipmentRecord): InttraReadiness {
  const pkg = record.pkg;
  if (!pkg) {
    const buildable = canBuild(record);
    return {
      status: 'unavailable',
      reason: buildable.ok ? 'Build the filing package first; the INTTRA Helper fills from it.' : buildable.reason,
      pkg: null,
      gate: null,
      screens: [],
      grid: { columns: GRID_COLUMNS.map((column) => column.label), rows: [] },
      unverifiedFields: ALL_INTTRA_MAPPINGS.filter((mapping) => mapping.verificationStatus === 'placeholder').length,
    };
  }

  const gate = fillGate(pkg);
  const screens: InttraScreenReadiness[] = [];
  for (const page of INTTRA_FORM_PAGES) {
    const mappings = ALL_INTTRA_MAPPINGS.filter((mapping) => mapping.page === page);
    if (!mappings.length) continue;
    const containerScoped = mappings.some((mapping) => mapping.scope === 'container');
    const targets: Array<PackageContainer | null> = containerScoped ? (pkg.containers.length ? pkg.containers : []) : [null];
    for (const container of targets) {
      const fields = mappings
        .filter((mapping) => (container ? mapping.scope === 'container' : mapping.scope === 'shipment'))
        .map((mapping) => fieldReadiness(mapping.key, mapping.label, packageValue(mapping.source, pkg, container), !!mapping.expected));
      screens.push({
        page,
        label: inttraPageLabel(page),
        ...(container ? { containerIndex: container.index } : {}),
        fields,
        ready: fields.filter((field) => field.status === 'ready').length,
        missing: fields.filter((field) => field.status === 'missing').length,
      });
    }
  }

  const rows: InttraGridRow[] = pkg.containers.map((container) => ({
    index: container.index,
    containerNumber: normalizedContainerNumber(container),
    cells: GRID_COLUMNS.map((column) => fieldReadiness(column.key, column.label, packageValue(`container.${column.source}`, pkg, container), !!column.expected)),
  }));

  const missing = screens.reduce((sum, screen) => sum + screen.missing, 0) + rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell.status === 'missing').length, 0);
  const status: ReadinessStatus = !gate.ok ? 'blocked' : missing > 0 || !pkg.containers.length ? 'review' : 'ready';
  return {
    status,
    reason: '',
    pkg,
    gate,
    screens,
    grid: { columns: GRID_COLUMNS.map((column) => column.label), rows },
    unverifiedFields: ALL_INTTRA_MAPPINGS.filter((mapping) => mapping.verificationStatus === 'placeholder').length,
  };
}

// --------------------------------------------------------------- next steps

export type DashboardTab = 'overview' | 'import' | 'deckhand' | 'package' | 'ace' | 'inttra' | 'provenance' | 'help';

export interface NextAction {
  /** What to do, as an instruction. */
  step: string;
  done: boolean;
  /** Where to do it in the dashboard, when it is done here. Undefined means outside: in Chrome, ACE or INTTRA. */
  tab?: DashboardTab;
  detail?: string;
}

/**
 * The operator's list, in order, with what is already done ticked off. It
 * ends in the two portals on purpose: the dashboard prepares, the extensions
 * fill, and the operator submits.
 */
export function nextActions(record: ShipmentRecord, ace: AceReadiness = aceReadiness(record), inttra: InttraReadiness = inttraReadiness(record)): NextAction[] {
  const actions: NextAction[] = [];
  const commercial = record.commercial;
  const extraction = record.extraction;
  const pkg = record.pkg;

  actions.push({
    step: 'Import the invoice: the ACE workbook from ace-export or the filled-in template, or an existing filing-package.json.',
    done: !!commercial,
    tab: 'import',
    ...(commercial ? { detail: `${commercial.source.label}: ${commercial.fileName}` } : {}),
  });
  actions.push({
    step: 'Paste the carrier or producer email and extract the booking, containers and seals.',
    done: !!extraction,
    tab: 'deckhand',
    ...(extraction ? { detail: `${extraction.shipment.containers.length} container(s) from ${extraction.shipment.source.name}` } : {}),
  });
  if (extraction) {
    const review = buildReview(extraction.shipment);
    actions.push({
      step: extraction.approvedAt ? 'Deckhand extraction reviewed and approved.' : review.canApprove ? 'Read the extraction against the email and approve it.' : 'Fix the extraction problems in the email text and extract again; approval is blocked.',
      done: !!extraction.approvedAt,
      tab: 'deckhand',
      ...(!extraction.approvedAt && review.blocking.length ? { detail: review.blocking.map((item) => item.message).join(' ') } : {}),
    });
  }
  actions.push({ step: 'Build the filing package from the invoice and the extraction.', done: !!pkg, tab: 'package', ...(pkg ? { detail: pkg.packageId } : {}) });

  if (pkg) {
    const unresolved = pkg.conflicts.filter((conflict) => conflict.resolution === 'unresolved');
    if (pkg.conflicts.length) {
      actions.push({
        step: unresolved.length ? `Resolve ${unresolved.length} conflict(s) between the invoice and the email.` : 'All conflicts resolved.',
        done: unresolved.length === 0,
        tab: 'package',
        ...(unresolved.length ? { detail: unresolved.map((conflict) => conflict.message).join(' ') } : {}),
      });
    }
    const missingHeader = PACKAGE_HEADER_FIELDS.filter((field) => pkg.header[field].source === 'missing' && ['bookingReference', 'vessel', 'voyage', 'portOfLoading', 'portOfDischarge', 'carrier'].includes(field));
    const missingContainers = pkg.containers.flatMap((container) =>
      PACKAGE_CONTAINER_FIELDS.filter((field) => container[field].source === 'missing' && ['carrierSeal', 'packageType', 'packageCount', 'grossWeightKg'].includes(field)).map((field) => `${normalizedContainerNumber(container)}: ${PACKAGE_CONTAINER_LABELS[field]}`),
    );
    const missingList = [...missingHeader.map((field) => PACKAGE_HEADER_LABELS[field]), ...missingContainers];
    if (missingList.length) {
      actions.push({
        step: `Enter ${missingList.length} value(s) no source holds, or type them in the portal.`,
        done: false,
        tab: 'package',
        detail: missingList.join('; '),
      });
    }
  }

  if (ace.preflight) {
    actions.push({
      step: ace.preflight.blocking.length ? `Fix ${ace.preflight.blocking.length} blocking data quality issue(s) at the source and re-import.` : 'ACE data quality checks pass.',
      done: ace.preflight.blocking.length === 0,
      tab: 'ace',
      ...(ace.preflight.blocking.length ? { detail: ace.preflight.blocking.slice(0, 3).map((issue) => `${issue.line ? `line ${issue.line}: ` : ''}${issue.message}`).join(' ') } : {}),
    });
  }

  actions.push({ step: 'Download filing-package.json and keep it with the shipment.', done: false, tab: 'overview', detail: pkg ? undefined : 'Available once the package is built.' });
  actions.push({ step: 'In Chrome, open the ACE Helper panel, import the package (or the ACE workbook), read the preview, fill each step, and submit in ACE yourself.', done: false, ...(ace.status === 'unavailable' ? { detail: ace.reason } : {}) });
  actions.push({ step: 'In Chrome, open the INTTRA Helper panel, import the package, fill each screen and the container grid, and submit in INTTRA yourself.', done: false, ...(inttra.status === 'unavailable' ? { detail: inttra.reason } : {}) });
  return actions;
}

// -------------------------------------------------------------- provenance

export interface ProvenanceRow {
  scope: 'header' | 'cargo' | 'container';
  /** "Header", "Line 1", "Container 2 (MSCU1234566)". */
  where: string;
  field: string;
  label: string;
  value: string;
  source: ValueSource;
  sourceLabel: string;
  /** The one-line description the panels show: "Deckhand, confirmed by QuickBooks". */
  description: string;
  detail: string;
  original: string;
  transform: string;
}

function row(scope: ProvenanceRow['scope'], where: string, field: string, label: string, item: Provenanced): ProvenanceRow {
  return {
    scope,
    where,
    field,
    label,
    value: item.value,
    source: item.source,
    sourceLabel: SOURCE_LABELS[item.source],
    description: describeProvenance(item),
    detail: item.detail ?? '',
    original: item.original !== undefined && item.original !== item.value ? item.original : '',
    transform: item.transform ?? '',
  };
}

/**
 * Every value with where it came from. Read from the package; with no
 * package yet, from a preview package built from the current sources, so the
 * question "where did this come from?" has an answer before Build is pressed.
 */
export function provenanceRows(record: ShipmentRecord): { rows: ProvenanceRow[]; preview: boolean } {
  let pkg = record.pkg;
  let preview = false;
  if (!pkg) {
    if (!record.commercial && !record.extraction) return { rows: [], preview: false };
    pkg = buildFilingPackage({
      invoice: record.commercial?.shipment ?? null,
      commercialSource: record.commercial && record.commercial.source.id !== 'filing-package' && record.commercial.source.id !== 'web' ? { id: record.commercial.source.id, label: record.commercial.source.label, detail: record.commercial.source.detail } : null,
      shipment: record.extraction?.shipment ?? null,
      deckhandApproved: !!record.extraction?.approvedAt,
      approvedAt: record.extraction?.approvedAt ?? null,
    });
    preview = true;
  }
  const rows: ProvenanceRow[] = [];
  for (const field of PACKAGE_HEADER_FIELDS) rows.push(row('header', 'Header', field, PACKAGE_HEADER_LABELS[field], pkg.header[field]));
  for (const line of pkg.cargo) {
    const where = `Line ${line.line}`;
    rows.push(row('cargo', where, 'description', 'Description', line.description));
    rows.push(row('cargo', where, 'scheduleB', 'Schedule B', line.scheduleB));
    rows.push(row('cargo', where, 'hsCode', 'HS code', line.hsCode));
    rows.push(row('cargo', where, 'quantity', 'Quantity', line.quantity));
    rows.push(row('cargo', where, 'uom', 'UOM', line.uom));
    rows.push(row('cargo', where, 'valueOfGoods', 'Value of goods', line.valueOfGoods));
    rows.push(row('cargo', where, 'weightKg', 'Weight (kg)', line.weightKg));
    rows.push(row('cargo', where, 'origin', 'Origin', line.origin));
    rows.push(row('cargo', where, 'eccn', 'ECCN', line.eccn));
    rows.push(row('cargo', where, 'licenseCode', 'License code', line.licenseCode));
    rows.push(row('cargo', where, 'exportInformationCode', 'Export information code', line.exportInformationCode));
  }
  for (const container of pkg.containers) {
    const where = `Container ${container.index + 1} (${normalizedContainerNumber(container) || 'no number'})`;
    for (const field of PACKAGE_CONTAINER_FIELDS) rows.push(row('container', where, field, PACKAGE_CONTAINER_LABELS[field], container[field]));
  }
  return { rows, preview };
}

/** Case-insensitive match on any column, for the search box. */
export function filterProvenance(rows: ProvenanceRow[], query: string): ProvenanceRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return rows;
  return rows.filter((item) => [item.where, item.label, item.value, item.sourceLabel, item.description, item.detail, item.original, item.transform].some((text) => text.toLowerCase().includes(needle)));
}
