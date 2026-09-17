/**
 * InttraGridWriter: the Copy Container Details grid.
 *
 * Input is the package's containers; output is one grid row per container,
 * in package order, with every cell written through setInttraFieldValue and
 * read back. The container and its seals travel together on one row: there
 * is no path here that writes a seal column from anything but the container
 * on the same row.
 *
 * How the grid is read, and what is never done:
 *   - the root is found by selector candidates (placeholders until captured);
 *   - columns are identified by HEADER TEXT, matched against the aliases in
 *     mappings/containerGrid.ts. A column that cannot be identified is
 *     reported unresolved and its cells are left alone. Nothing is written
 *     by column position;
 *   - rows are the grid's existing data rows. The helper never presses Add
 *     Row (automationPolicy.ts): when there are fewer rows than containers it
 *     fills what exists and says how many rows to add;
 *   - a cell whose control cannot be resolved (a click-to-edit widget, say)
 *     is reported, not clicked. The Copy rows (TSV) path exists for that grid.
 */

import type { FilingPackage, PackageContainer } from '../../../shared/src/filingPackage.js';
import { describeProvenance } from '../../../shared/src/provenance.js';
import { normalizedContainerNumber } from '../../../shared/src/builder.js';
import { DEFAULT_SETTINGS } from '../../../src/core/settings.js';
import { runTransforms } from '../../../src/ace/transformers/index.js';
import { truncate } from '../../../src/ace/transformers/text.js';
import { highlightField } from '../../../src/content/highlight.js';
import { GRID_COLUMNS, GRID_ROOT_CANDIDATES, type GridColumnSpec } from '../mappings/containerGrid.js';
import { isInttraVisible, readInttraFieldValue, resolveInttraControl, setInttraFieldValue } from './fieldWriter.js';

export type GridKind = 'table' | 'ariaGrid' | 'unknown';

export interface GridHeader {
  index: number;
  text: string;
  /** The GRID_COLUMNS key this heading was identified as, or null. */
  column: string | null;
}

export interface GridDetection {
  found: boolean;
  matchedWith: string | null;
  kind: GridKind;
  headers: GridHeader[];
  /** Column keys from GRID_COLUMNS that no heading matched. */
  missingColumns: string[];
  rowCount: number;
  /** Everything tried, for diagnostics. */
  attempts: Array<{ query: string; matches: number }>;
}

export type GridCellStatus = 'verified' | 'filled' | 'failed' | 'skipped' | 'unresolved' | 'warning' | 'dry-run';

export interface GridCellOutcome {
  row: number;
  column: string;
  label: string;
  status: GridCellStatus;
  expected: string;
  actual: string;
  provenance?: string;
  message?: string;
}

export interface GridFillReport {
  detection: GridDetection;
  rowsNeeded: number;
  rowsAvailable: number;
  containersFilled: number;
  verifiedCells: number;
  warnings: number;
  failed: number;
  unresolved: number;
  cells: GridCellOutcome[];
  messages: string[];
  dryRun: boolean;
  startedAt: string;
}

export function normalizeHeading(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function safeQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function describeCandidate(index: number): string {
  const candidate = GRID_ROOT_CANDIDATES[index];
  return candidate?.selector ?? `candidate ${index}`;
}

/** Anything on the page that could structurally be a grid. */
const GRID_SHAPED = 'table, [role="grid"], [role="treegrid"]';

/**
 * The grid, identified by its own column headings.
 *
 * This is the fallback that matters on the real portal. The selector ladder
 * above asks "is there exactly one element matching this guess?", and on
 * ship.inttra.e2open.com the answer is no for every rung: the ids and
 * attributes are not the guessed ones, and the last-resort `table` matches
 * several, because the Copy Container Details grid is a modal drawn over a
 * workspace that has tables of its own. Requiring exactly one match then
 * rejects the page's only real grid (observed 2026-09-17: the popup offered
 * "Fill this screen" for the step behind the modal because no grid was found).
 *
 * Headings do not have that problem. A container grid is the thing whose
 * header row says Container Number, and GRID_COLUMNS already carries the
 * aliases for every column we fill. So every grid-shaped element is scored by
 * how many of those columns its header row identifies, and the best-scoring
 * one wins - provided it has a Container Number column, which is what makes it
 * a container grid rather than some other table.
 *
 * Ties go to the innermost candidate, because a grid nested inside a layout
 * table would otherwise be beaten by its own wrapper.
 */
export function findGridByHeadings(
  doc: ParentNode,
  columns: GridColumnSpec[] = GRID_COLUMNS,
): { root: Element | null; score: number } {
  const candidates = safeQueryAll(doc, GRID_SHAPED).filter((element) => isInttraVisible(element));
  let best: { root: Element; score: number; depth: number } | null = null;

  for (const root of candidates) {
    const headers = identifyHeaders(readGridShape(root).headerCells, columns);
    const identified = headers.map((header) => header.column).filter((key): key is string => key !== null);
    if (!identified.includes('ContainerNumber')) continue;
    const depth = safeQueryAll(root, GRID_SHAPED).length;
    const better = !best || identified.length > best.score || (identified.length === best.score && depth < best.depth);
    if (better) best = { root, score: identified.length, depth };
  }

  return best ? { root: best.root, score: best.score } : { root: null, score: 0 };
}

/**
 * Find the grid root: the first candidate that resolves to exactly one visible
 * element, and failing that the grid-shaped element whose headings say it is a
 * container grid.
 */
export function findGridRoot(doc: ParentNode, columns: GridColumnSpec[] = GRID_COLUMNS): { root: Element | null; matchedWith: string | null; attempts: GridDetection['attempts'] } {
  const attempts: GridDetection['attempts'] = [];
  for (let index = 0; index < GRID_ROOT_CANDIDATES.length; index += 1) {
    const candidate = GRID_ROOT_CANDIDATES[index];
    if (!candidate?.selector) continue;
    const matches = safeQueryAll(doc, candidate.selector).filter((element) => isInttraVisible(element));
    attempts.push({ query: candidate.selector, matches: matches.length });
    if (matches.length === 1) return { root: matches[0] as Element, matchedWith: describeCandidate(index), attempts };
  }

  const byHeadings = findGridByHeadings(doc, columns);
  attempts.push({ query: `${GRID_SHAPED} with a Container Number heading`, matches: byHeadings.root ? 1 : 0 });
  if (byHeadings.root) {
    return { root: byHeadings.root, matchedWith: `headings: ${byHeadings.score} of ${columns.length} columns identified`, attempts };
  }

  return { root: null, matchedWith: null, attempts };
}

interface GridShape {
  kind: GridKind;
  headerCells: Element[];
  rows: Element[][];
}

function cellsOf(row: Element, kind: GridKind): Element[] {
  if (kind === 'ariaGrid') {
    const cells = Array.from(row.children).filter((cell) => ['gridcell', 'cell', 'columnheader', 'rowheader'].includes(cell.getAttribute('role') ?? ''));
    return cells.length ? cells : Array.from(row.querySelectorAll('[role="gridcell"], [role="cell"]'));
  }
  return Array.from(row.children).filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH');
}

/** Read the header row and the data rows out of whatever the grid is built from. */
export function readGridShape(root: Element): GridShape {
  const ariaRows = safeQueryAll(root, '[role="row"]');
  if (root.getAttribute('role') === 'grid' || root.getAttribute('role') === 'treegrid' || (root.tagName !== 'TABLE' && ariaRows.length)) {
    const rows = ariaRows.length ? ariaRows : [];
    const headerRow = rows.find((row) => row.querySelector('[role="columnheader"]')) ?? rows[0] ?? null;
    const dataRows = rows.filter((row) => row !== headerRow && !row.querySelector('[role="columnheader"]'));
    return {
      kind: 'ariaGrid',
      headerCells: headerRow ? cellsOf(headerRow, 'ariaGrid') : [],
      rows: dataRows.map((row) => cellsOf(row, 'ariaGrid')),
    };
  }

  const table = root.tagName === 'TABLE' ? root : root.querySelector('table');
  if (!table) return { kind: 'unknown', headerCells: [], rows: [] };
  const allRows = Array.from(table.querySelectorAll('tr'));
  const theadRows = allRows.filter((row) => row.closest('thead'));
  const headerRow = theadRows[theadRows.length - 1] ?? allRows.find((row) => row.querySelector('th')) ?? allRows[0] ?? null;
  const dataRows = allRows.filter((row) => row !== headerRow && !row.closest('thead') && !row.closest('tfoot') && !row.querySelector('th'));
  return {
    kind: 'table',
    headerCells: headerRow ? cellsOf(headerRow, 'table') : [],
    rows: dataRows.map((row) => cellsOf(row, 'table')),
  };
}

function identifyHeaders(headerCells: Element[], columns: GridColumnSpec[]): GridHeader[] {
  const taken = new Set<string>();
  return headerCells.map((cell, index) => {
    const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
    const normalized = normalizeHeading(text);
    let column: string | null = null;
    if (normalized !== '') {
      // Exact alias first, then a heading that starts with an alias ("Carrier Seal # *").
      const exact = columns.find((spec) => !taken.has(spec.key) && spec.headerAliases.includes(normalized));
      const prefixed = exact ?? columns.find((spec) => !taken.has(spec.key) && spec.headerAliases.some((alias) => alias.length >= 4 && normalized.startsWith(alias)));
      if (prefixed) {
        column = prefixed.key;
        taken.add(prefixed.key);
      }
    }
    return { index, text, column };
  });
}

export function detectGrid(doc: ParentNode, columns: GridColumnSpec[] = GRID_COLUMNS): GridDetection & { root: Element | null; shape: GridShape | null } {
  const { root, matchedWith, attempts } = findGridRoot(doc, columns);
  if (!root) {
    return { found: false, matchedWith: null, kind: 'unknown', headers: [], missingColumns: columns.map((spec) => spec.key), rowCount: 0, attempts, root: null, shape: null };
  }
  const shape = readGridShape(root);
  const headers = identifyHeaders(shape.headerCells, columns);
  const identified = new Set(headers.map((header) => header.column).filter((key): key is string => key !== null));
  return {
    found: identified.size > 0,
    matchedWith,
    kind: shape.kind,
    headers,
    missingColumns: columns.filter((spec) => !identified.has(spec.key)).map((spec) => spec.key),
    rowCount: shape.rows.length,
    attempts,
    root,
    shape,
  };
}

export interface GridFillOptions {
  doc?: ParentNode;
  dryRun?: boolean;
  overwrite?: boolean;
  highlightDurationMs?: number;
  dispatchBlur?: boolean;
  columns?: GridColumnSpec[];
}

/** The value a column takes from a container, transformed for the grid. */
export function gridCellValue(container: PackageContainer, spec: GridColumnSpec): { text: string; provenance: string; transform: string | null; error?: string } {
  const item = container[spec.source];
  const raw = spec.source === 'containerNumber' ? normalizedContainerNumber(container) : item.value;
  if (raw === '' || item.source === 'missing') return { text: '', provenance: describeProvenance(item), transform: null };
  const transformed = runTransforms(raw, spec.transforms, { settings: DEFAULT_SETTINGS });
  if (transformed.error) return { text: '', provenance: describeProvenance(item), transform: null, error: transformed.error };
  const { value } = truncate(transformed.text, spec.maxLength);
  return { text: value, provenance: describeProvenance(item), transform: transformed.transform };
}

/** Tab-separated rows in the grid's own column order when a grid was detected, otherwise in GRID_COLUMNS order. */
export function gridRowsAsTsv(pkg: FilingPackage, detection: GridDetection | null, columns: GridColumnSpec[] = GRID_COLUMNS): string {
  const order: GridColumnSpec[] = detection && detection.found
    ? detection.headers.map((header) => columns.find((spec) => spec.key === header.column) ?? null).filter((spec): spec is GridColumnSpec => spec !== null)
    : columns;
  return pkg.containers
    .map((container) => order.map((spec) => gridCellValue(container, spec).text).join('\t'))
    .join('\r\n');
}

export function fillContainerGrid(pkg: FilingPackage, options: GridFillOptions = {}): GridFillReport {
  const doc = options.doc ?? document;
  const columns = options.columns ?? GRID_COLUMNS;
  const dryRun = options.dryRun ?? false;
  const overwrite = options.overwrite ?? false;
  const detection = detectGrid(doc, columns);
  const { root: _root, shape, ...plainDetection } = detection;
  void _root;

  const report: GridFillReport = {
    detection: plainDetection,
    rowsNeeded: pkg.containers.length,
    rowsAvailable: detection.rowCount,
    containersFilled: 0,
    verifiedCells: 0,
    warnings: 0,
    failed: 0,
    unresolved: 0,
    cells: [],
    messages: [],
    dryRun,
    startedAt: new Date().toISOString(),
  };

  if (!shape || !detection.found) {
    report.messages.push(
      detection.matchedWith
        ? `A grid was found (${detection.matchedWith}) but none of its headings matched a known column. Capture the header row with DevTools (see Diagnostics).`
        : 'No container grid was found on this page. Open Copy Container Details, or capture the grid root with DevTools (see Diagnostics).',
    );
    return report;
  }
  if (detection.missingColumns.length) {
    report.messages.push(`Columns not identified in the grid's headings, left alone: ${detection.missingColumns.join(', ')}.`);
  }
  if (!pkg.containers.length) {
    report.messages.push('The package has no containers; nothing to write.');
    return report;
  }
  if (shape.rows.length < pkg.containers.length) {
    report.messages.push(
      `The grid has ${shape.rows.length} row(s) and the package has ${pkg.containers.length} container(s). Add ${pkg.containers.length - shape.rows.length} row(s) in INTTRA (the helper never presses Add Row), then fill again; existing rows are filled below.`,
    );
  }

  const columnByKey = new Map(columns.map((spec) => [spec.key, spec]));

  pkg.containers.forEach((container, rowIndex) => {
    const cells = shape.rows[rowIndex];
    if (!cells) return;
    let wroteSomething = false;

    for (const header of detection.headers) {
      if (!header.column) continue;
      const spec = columnByKey.get(header.column);
      if (!spec) continue;
      const cell = cells[header.index] ?? null;
      const { text, provenance, error } = gridCellValue(container, spec);
      const base: GridCellOutcome = { row: rowIndex + 1, column: spec.key, label: spec.label, status: 'skipped', expected: text, actual: '', provenance };

      if (error) {
        report.cells.push({ ...base, status: 'failed', message: error });
        report.failed += 1;
        continue;
      }
      if (text === '') {
        report.cells.push({ ...base, status: spec.expected ? 'warning' : 'skipped', message: spec.expected ? 'No value in the package for this column.' : 'No value in the package.' });
        if (spec.expected) report.warnings += 1;
        continue;
      }
      const resolved = resolveInttraControl(cell);
      if (!cell || !resolved.element) {
        report.cells.push({ ...base, status: 'unresolved', message: 'No writable control in this cell. If the grid opens an editor on click, paste the rows instead (Copy rows).' });
        report.unresolved += 1;
        continue;
      }
      const existing = readInttraFieldValue(cell);
      if (existing.trim() !== '' && existing.trim() !== text && !overwrite) {
        report.cells.push({ ...base, status: 'warning', actual: existing, message: `The cell already holds "${existing}". Left untouched; turn on overwrite to replace it.` });
        report.warnings += 1;
        continue;
      }
      if (dryRun) {
        report.cells.push({ ...base, status: 'dry-run', actual: existing, message: `Would write "${text}" (${resolved.kind}).` });
        continue;
      }
      const result = setInttraFieldValue(cell, text, { blur: options.dispatchBlur ?? true });
      const element = resolved.element as HTMLElement;
      if (!result.ok) {
        highlightField(element, 'error', options.highlightDurationMs ?? 6000, `grid.${rowIndex + 1}.${spec.key}`);
        report.cells.push({ ...base, status: 'failed', actual: result.readBack, message: result.reason ?? 'The value did not stick.' });
        report.failed += 1;
        continue;
      }
      wroteSomething = true;
      highlightField(element, result.reason ? 'transformed' : 'filled', options.highlightDurationMs ?? 6000, `grid.${rowIndex + 1}.${spec.key}`);
      const status: GridCellStatus = result.reason ? 'filled' : 'verified';
      if (status === 'verified') report.verifiedCells += 1;
      else report.warnings += 1;
      report.cells.push({ ...base, status, actual: result.readBack, ...(result.reason ? { message: result.reason } : {}) });
    }
    if (wroteSomething) report.containersFilled += 1;
  });

  return report;
}
