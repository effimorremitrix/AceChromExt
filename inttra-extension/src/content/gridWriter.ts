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
 *   - the root is found by selector candidates (two captured from the live
 *     modal on 2026-09-17, the rest placeholders), and failing those by its
 *     own headings;
 *   - columns are identified by HEADER TEXT, matched against the aliases in
 *     mappings/containerGrid.ts. A heading that is a dropdown (the two seal
 *     headings on the live portal are selects of seal types) is read as the
 *     option it shows, never as its option list. A column that cannot be
 *     identified is reported unresolved and its cells are left alone.
 *     Nothing is written by column position;
 *   - rows are the grid's existing data rows. The helper never presses Add
 *     Row (automationPolicy.ts): when there are fewer rows than containers it
 *     fills what exists and says how many rows to add;
 *   - a cell whose control cannot be resolved (a click-to-edit widget, say)
 *     is reported, not clicked. For that grid gridPasteBlock produces the rows
 *     to paste: one cell per grid column, in the grid's own order, blank where
 *     nothing feeds a column, so the block lines up with the grid.
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

/** What the grid is built from. 'divGrid': not a table and not an ARIA grid, found by its header row's wording alone (the live modal's grid, 2026-09-17). */
export type GridKind = 'table' | 'ariaGrid' | 'divGrid' | 'unknown';

export interface GridHeader {
  index: number;
  text: string;
  /** The GRID_COLUMNS key this heading was identified as, or null. */
  column: string | null;
  /** Every option of a dropdown heading (the seal-type selects on the live portal), for diagnostics. */
  options?: string[];
}

export interface GridDetection {
  found: boolean;
  matchedWith: string | null;
  kind: GridKind;
  headers: GridHeader[];
  /** Column keys from GRID_COLUMNS that no heading matched. */
  missingColumns: string[];
  rowCount: number;
  /** Everything tried, for diagnostics: `matches` after the visibility filter, `raw` before it. */
  attempts: Array<{ query: string; matches: number; raw?: number }>;
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

/** How many ancestors above a Container Number heading's text the header row is looked for. */
const HEADER_CLIMB = 8;

/**
 * A control that is typed into. A form row holds one under each of its labels;
 * a grid's header row holds none (a checkbox to select every row, or a hidden
 * input, is not one).
 */
const TYPED_CONTROL = 'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea';

/**
 * Every text node under a root, in document order, descending into open
 * shadow roots. The text of SCRIPT, STYLE, TEMPLATE, OPTION and OPTGROUP is
 * not heading wording and is skipped, as readHeaderCell skips it.
 */
function textNodesUnder(root: ParentNode): Text[] {
  const found: Text[] = [];
  const stack: Node[] = [root as Node];
  while (stack.length) {
    const node = stack.pop() as Node;
    if (node.nodeType === Node.TEXT_NODE) {
      found.push(node as Text);
      continue;
    }
    if (node.nodeType === Node.ELEMENT_NODE && NOT_HEADING_TEXT.has((node as Element).tagName)) continue;
    const children = Array.from(node.childNodes);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index] as Node);
    const shadow = (node as Element).shadowRoot;
    if (shadow) stack.push(shadow);
  }
  return found;
}

/**
 * Does this wording read as the Container Number heading? An alias exactly,
 * or a prefix of an alias longer than the bare word "container" - so
 * "Container Number *" and "Container No." do, and "Container & Cargo" (the
 * step strip) and "Container Type" (a form label) do not.
 */
function readsAsContainerNumber(text: string, columns: GridColumnSpec[]): boolean {
  const normalized = normalizeHeading(text);
  if (normalized === '') return false;
  const spec = columns.find((column) => column.key === 'ContainerNumber');
  return !!spec && spec.headerAliases.some((alias) => normalized === alias || (alias.length > 'container'.length && normalized.startsWith(alias)));
}

export interface HeaderRowByText {
  /** The element whose children are the heading cells. */
  headerRow: Element;
  cells: Element[];
  /** How many GRID_COLUMNS the row identifies. */
  score: number;
}

/**
 * The header row, found by its wording alone, whatever the grid is built from.
 *
 * The live modal's grid (fifth run, 2026-09-17) is not a table, not an ARIA
 * grid and not inside either captured id: two tables were visible to the
 * helper and neither carried a Container Number heading, so nothing in
 * GRID_SHAPED ever looked at the grid the operator was pasting into. A header
 * row is still the thing whose cells say Container Number, Carrier Seal #,
 * Shipper Seal #; so this starts from the words instead of the markup.
 *
 * From every visible text node that reads as the Container Number heading,
 * climb: the text's parent is tried as the cell, then each ancestor in turn,
 * and the cell's parent is the candidate row. The smallest row whose element
 * children identify Container Number plus at least one more column, through
 * the same identifyHeaders the table reading uses, is the header row. A row
 * with fewer than two children is a wrapper; a row with a typed control under
 * a child is a form row (labels over inputs, the Container & Cargo step) and
 * is never a grid header. Among the matches the row identifying the most
 * columns wins, ties to the first in document order.
 *
 * `seeds` counts the text nodes that read as the heading, for diagnostics:
 * "the words are on the page, and no row around them is a header row" is a
 * different finding from "the words are not on the page".
 */
export function findHeaderRowByText(doc: ParentNode, columns: GridColumnSpec[] = GRID_COLUMNS): { row: HeaderRowByText | null; seeds: number } {
  let best: HeaderRowByText | null = null;
  let seeds = 0;
  for (const text of textNodesUnder(doc)) {
    if (!readsAsContainerNumber(text.textContent ?? '', columns)) continue;
    const start = text.parentElement;
    if (!start || !isInttraVisible(start)) continue;
    seeds += 1;
    let cell: Element | null = start;
    for (let level = 0; cell && level < HEADER_CLIMB; cell = cell.parentElement, level += 1) {
      const row = cell.parentElement;
      if (!row) break;
      const cells = Array.from(row.children);
      if (cells.length < 2) continue;
      if (cells.some((sibling) => sibling.matches(TYPED_CONTROL) || sibling.querySelector(TYPED_CONTROL))) continue;
      const identified = identifyHeaders(cells, columns).filter((header) => header.column !== null);
      if (identified.length < 2 || !identified.some((header) => header.column === 'ContainerNumber')) continue;
      if (!best || identified.length > best.score) best = { headerRow: row, cells, score: identified.length };
      break;
    }
  }
  return { row: best, seeds };
}

export interface ContainerGridMatch {
  root: Element | null;
  /** How many GRID_COLUMNS the header row identifies. */
  score: number;
  /** Set when the grid was found by its wording rather than its shape: the row readGridShape reads the headings from. */
  headerRow: Element | null;
  how: 'shape' | 'wording' | null;
}

/**
 * The container grid on the document, however it is built: a grid-shaped
 * element whose headings say so, and failing that a header row found by its
 * wording alone. The page detector and the content scripts ask this, so that
 * what identifies the screen is what the grid writer would read.
 */
export function findContainerGrid(doc: ParentNode, columns: GridColumnSpec[] = GRID_COLUMNS): ContainerGridMatch {
  const byShape = findGridByHeadings(doc, columns);
  if (byShape.root) return { root: byShape.root, score: byShape.score, headerRow: null, how: 'shape' };
  const byText = findHeaderRowByText(doc, columns).row;
  if (byText) return { root: byText.headerRow.parentElement ?? byText.headerRow, score: byText.score, headerRow: byText.headerRow, how: 'wording' };
  return { root: null, score: 0, headerRow: null, how: null };
}

/**
 * Find the grid root: the first candidate that resolves to exactly one visible
 * element; failing that the grid-shaped element whose headings say it is a
 * container grid; failing that a header row found by its wording, whatever it
 * is built from. Every rung is recorded, with what it matched before and
 * after the visibility filter, so Diagnostics can say which one took.
 */
export function findGridRoot(
  doc: ParentNode,
  columns: GridColumnSpec[] = GRID_COLUMNS,
): { root: Element | null; matchedWith: string | null; headerRow: Element | null; attempts: GridDetection['attempts'] } {
  const attempts: GridDetection['attempts'] = [];
  for (let index = 0; index < GRID_ROOT_CANDIDATES.length; index += 1) {
    const candidate = GRID_ROOT_CANDIDATES[index];
    if (!candidate?.selector) continue;
    const raw = safeQueryAll(doc, candidate.selector);
    const matches = raw.filter((element) => isInttraVisible(element));
    attempts.push({ query: candidate.selector, matches: matches.length, raw: raw.length });
    if (matches.length === 1) return { root: matches[0] as Element, matchedWith: describeCandidate(index), headerRow: null, attempts };
  }

  const byHeadings = findGridByHeadings(doc, columns);
  attempts.push({ query: `${GRID_SHAPED} with a Container Number heading`, matches: byHeadings.root ? 1 : 0, raw: safeQueryAll(doc, GRID_SHAPED).length });
  if (byHeadings.root) {
    return { root: byHeadings.root, matchedWith: `headings: ${byHeadings.score} of ${columns.length} columns identified`, headerRow: null, attempts };
  }

  const byText = findHeaderRowByText(doc, columns);
  attempts.push({ query: 'a header row found by its Container Number wording, whatever it is built from', matches: byText.row ? 1 : 0, raw: byText.seeds });
  if (byText.row) {
    return {
      root: byText.row.headerRow.parentElement ?? byText.row.headerRow,
      matchedWith: `header row by wording: ${byText.row.score} of ${columns.length} columns identified`,
      headerRow: byText.row.headerRow,
      attempts,
    };
  }

  return { root: null, matchedWith: null, headerRow: null, attempts };
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
  if (kind === 'divGrid') return Array.from(row.children);
  return Array.from(row.children).filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH');
}

/** How many ancestors above a header row the rows of a grid that is not a table are looked for. */
const ROWS_CLIMB = 6;

/**
 * The data rows of a grid that is not a table, given its header row.
 *
 * Such a grid keeps its header and its rows in separate containers (a header
 * strip that stays put, a scrolling canvas of rows), so the rows are looked
 * for under each ancestor of the header row in turn. A row is a visible
 * element with exactly as many element children as the header row has
 * cells - an element with role="row" for choice, and otherwise any element,
 * keeping the innermost so that a canvas that happens to hold as many rows as
 * there are columns is not itself taken for a row. The header row, its
 * ancestors and its own cells are never rows. The first ancestor with any
 * rows wins; a grid with no rows yet is found all the same.
 */
function divGridRows(headerRow: Element, width: number): Element[] {
  const isRow = (element: Element): boolean =>
    element !== headerRow && !element.contains(headerRow) && !headerRow.contains(element) && element.children.length === width && isInttraVisible(element);
  let ancestor = headerRow.parentElement;
  for (let level = 0; ancestor && level < ROWS_CLIMB; ancestor = ancestor.parentElement, level += 1) {
    const ariaRows = safeQueryAll(ancestor, '[role="row"]').filter(isRow);
    if (ariaRows.length) return ariaRows;
    const candidates = safeQueryAll(ancestor, '*').filter(isRow);
    const rows = candidates.filter((row) => !candidates.some((other) => other !== row && row.contains(other)));
    if (rows.length) return rows;
  }
  return [];
}

/**
 * Read the header row and the data rows out of whatever the grid is built
 * from. With a header row given (`wordingRow`, found by its wording), the grid
 * is read from that row whatever the markup around it.
 */
export function readGridShape(root: Element, wordingRow?: Element | null): GridShape {
  if (wordingRow) {
    const headerCells = cellsOf(wordingRow, 'divGrid');
    return { kind: 'divGrid', headerCells, rows: divGridRows(wordingRow, headerCells.length).map((row) => cellsOf(row, 'divGrid')) };
  }

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
  // This table's own rows only. An editableGrid-style header holds a table
  // inside every heading cell, and reading those nested rows as this table's
  // would take the last of them - one heading - for the whole header row.
  const allRows = Array.from(table.querySelectorAll('tr')).filter((row) => row.closest('table') === table);
  const theadRows = allRows.filter((row) => row.closest('thead'));
  const headerRow = theadRows[theadRows.length - 1] ?? allRows.find((row) => row.querySelector('th')) ?? allRows[0] ?? null;
  const dataRows = allRows.filter((row) => row !== headerRow && !row.closest('thead') && !row.closest('tfoot') && !row.querySelector('th'));
  return {
    kind: 'table',
    headerCells: headerRow ? cellsOf(headerRow, 'table') : [],
    rows: dataRows.map((row) => cellsOf(row, 'table')),
  };
}

export interface HeaderReading {
  /** What the cell shows: its static text plus, for a dropdown, only the option it shows. */
  text: string;
  /** Wordings to identify the column by, most trusted first: the selected option, then the static text. */
  candidates: string[];
  /** Every option of a dropdown heading, for diagnostics and the capture request. */
  options?: string[];
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Elements whose text is not heading wording. An OPTION is read through its <select>, never as text. */
const NOT_HEADING_TEXT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'OPTION', 'OPTGROUP']);

/**
 * Read a header cell the way the operator sees it.
 *
 * On the live portal (2026-09-17) the two seal headings are dropdowns of seal
 * types, and a <select>'s textContent is every option run together:
 * "Carrier Seal #Shipper Seal #Customs Seal #...". Read that way both seal
 * columns carry the same wording whichever option each shows: the first is
 * claimed by prefix as Carrier Seal #, the second matches nothing, and the
 * shipper's seal is never pasted. With Shipper Seal # as the first option the
 * carrier's column would be claimed as the shipper's instead, and the seal
 * would land in the wrong column, silently.
 *
 * What identifies a dropdown heading is the option it shows, so that is what
 * is read, ahead of any static text beside it. The option list is recorded
 * for diagnostics and never contributes to identification.
 */
export function readHeaderCell(cell: Element): HeaderReading {
  const statics: string[] = [];
  const options: string[] = [];
  let chosen = '';
  const readSelect = (select: HTMLSelectElement): void => {
    for (const option of Array.from(select.options)) options.push(collapse(option.textContent ?? ''));
    const selected = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : undefined;
    const shown = collapse(selected?.textContent ?? '');
    if (shown !== '' && chosen === '') chosen = shown;
  };
  const walk = (parent: Element): void => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        statics.push(child.textContent ?? '');
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as Element;
      if (element instanceof HTMLSelectElement) {
        readSelect(element);
        continue;
      }
      if (NOT_HEADING_TEXT.has(element.tagName)) continue;
      walk(element);
    }
  };
  if (cell instanceof HTMLSelectElement) readSelect(cell);
  else walk(cell);
  const staticText = collapse(statics.join(' '));
  const candidates = [chosen, staticText].filter((text) => text !== '');
  return { text: candidates.join(' '), candidates, ...(options.length ? { options } : {}) };
}

/**
 * Which GRID_COLUMNS key each heading is, by wording alone.
 *
 * Two passes over the row. First every heading that matches an alias exactly
 * claims its column; only then does a heading that merely starts with an alias
 * get to claim what is left. One pass in cell order would let a "Seal Type"
 * column to the left of "Shipper Seal #" take ShipperSeal through the
 * four-letter alias "seal", and the real seal column would then match nothing.
 * A key, once claimed, is never claimed again.
 */
function identifyHeaders(headerCells: Element[], columns: GridColumnSpec[]): GridHeader[] {
  const readings = headerCells.map((cell) => readHeaderCell(cell));
  const keys: Array<string | null> = readings.map(() => null);
  const taken = new Set<string>();
  const claim = (index: number, pick: (normalized: string) => GridColumnSpec | undefined): void => {
    if (keys[index] !== null) return;
    for (const candidate of readings[index]?.candidates ?? []) {
      const normalized = normalizeHeading(candidate);
      if (normalized === '') continue;
      const spec = pick(normalized);
      if (spec) {
        keys[index] = spec.key;
        taken.add(spec.key);
        return;
      }
    }
  };
  readings.forEach((_reading, index) => claim(index, (normalized) => columns.find((spec) => !taken.has(spec.key) && spec.headerAliases.includes(normalized))));
  readings.forEach((_reading, index) =>
    claim(index, (normalized) => columns.find((spec) => !taken.has(spec.key) && spec.headerAliases.some((alias) => alias.length >= 4 && normalized.startsWith(alias)))),
  );
  return readings.map((reading, index) => ({ index, text: reading.text, column: keys[index] ?? null, ...(reading.options ? { options: reading.options } : {}) }));
}

export function detectGrid(doc: ParentNode, columns: GridColumnSpec[] = GRID_COLUMNS): GridDetection & { root: Element | null; shape: GridShape | null } {
  const { root, matchedWith, headerRow, attempts } = findGridRoot(doc, columns);
  if (!root) {
    return { found: false, matchedWith: null, kind: 'unknown', headers: [], missingColumns: columns.map((spec) => spec.key), rowCount: 0, attempts, root: null, shape: null };
  }
  const shape = readGridShape(root, headerRow);
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

/**
 * Does this grid hold anything that can be typed into?
 *
 * A click-to-edit grid has no control in its cells until a cell is clicked, so
 * Fill can never write a single value into it, however good the selectors are.
 * Asking the question before offering the button is the difference between an
 * operator clicking Fill, reading why it failed, and then clicking Copy rows -
 * and simply being offered Copy rows first.
 *
 * True when any data cell of an identified column resolves a writable control.
 * False for a grid with no such cell, and false when there is no grid at all.
 */
export function gridAcceptsTyping(doc: ParentNode, columns: GridColumnSpec[] = GRID_COLUMNS): boolean {
  const detection = detectGrid(doc, columns);
  if (!detection.found || !detection.shape) return false;
  const indexes = detection.headers.filter((header) => header.column !== null).map((header) => header.index);
  for (const cells of detection.shape.rows) {
    for (const index of indexes) {
      if (resolveInttraControl(cells[index] ?? null).element) return true;
    }
  }
  return false;
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

export interface GridPasteBlock {
  /** Tab-separated cells, CRLF between rows, no trailing newline. */
  tsv: string;
  rows: number;
  /** Cells per row; every row has exactly this many. */
  width: number;
  /** The pasted columns in order: the grid heading and the package column feeding it (null: pasted blank). */
  columns: Array<{ heading: string; column: string | null }>;
  /** Headings inside the width that no package column feeds. */
  blank: string[];
  /** True when the order is the detected grid's own; false when it is GRID_COLUMNS. */
  fromGrid: boolean;
}

/** A cell must stay one cell: a line break inside a value would start a new grid row, a tab a new column. */
const flat = (text: string): string => text.replace(/[\t\r\n]+/g, ' ').trim();

/**
 * The block to paste into Copy Container Details.
 *
 * One cell per grid column, in the grid's own order when a grid was detected
 * and in GRID_COLUMNS order otherwise; blank where the package has nothing
 * for a column, and blank where the column could not be identified. The
 * second is the point: a paste is positional, so a column left OUT of the row
 * shifts every value after it one column to the left. Observed 2026-09-17,
 * when the unidentified Shipper Seal # column was dropped from the row, the
 * container numbers landed, and the seals were pasted nowhere.
 *
 * The block starts at the Container Number column, which is the cell the
 * operator pastes into; anything left of it (a row selector, say) is not in
 * the block. Each row is cut at the right-most column that holds a value in
 * ANY row, so nothing right of the last value is overwritten with blanks;
 * columns inside that width that are empty ARE pasted blank, which is why the
 * operator pastes into the first empty row.
 */
export function gridPasteBlock(pkg: FilingPackage, detection: GridDetection | null, columns: GridColumnSpec[] = GRID_COLUMNS): GridPasteBlock {
  const fromGrid = !!detection?.found;
  const gridOrder: Array<{ heading: string; spec: GridColumnSpec | null }> = fromGrid && detection
    ? detection.headers.map((header) => ({ heading: header.text || `column ${header.index + 1}`, spec: columns.find((spec) => spec.key === header.column) ?? null }))
    : columns.map((spec) => ({ heading: spec.label, spec }));
  const anchor = Math.max(0, gridOrder.findIndex(({ spec }) => spec?.key === 'ContainerNumber'));
  const order = gridOrder.slice(anchor);
  const values = pkg.containers.map((container) => order.map(({ spec }) => (spec ? flat(gridCellValue(container, spec).text) : '')));
  const width = Math.max(1, ...values.map((row) => row.reduce((last, cell, index) => (cell !== '' ? index + 1 : last), 0)));
  const rows = values.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
  const pasted = order.slice(0, width);
  return {
    tsv: rows.map((row) => row.join('\t')).join('\r\n'),
    rows: rows.length,
    width,
    columns: pasted.map(({ heading, spec }) => ({ heading, column: spec?.key ?? null })),
    blank: pasted.filter(({ spec }) => spec === null).map(({ heading }) => heading),
    fromGrid,
  };
}

/** The paste block's text alone: tab-separated rows in the grid's own column order. */
export function gridRowsAsTsv(pkg: FilingPackage, detection: GridDetection | null, columns: GridColumnSpec[] = GRID_COLUMNS): string {
  return gridPasteBlock(pkg, detection, columns).tsv;
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
