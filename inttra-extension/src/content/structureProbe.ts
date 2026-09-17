/**
 * What the answering document is built from, for the capture that settles
 * the grid's markup.
 *
 * Five live runs on 2026-09-17 each ended in a guess about the Copy Container
 * Details grid: which tab or frame answered, whether the captured ids were in
 * the DOM, what the header row is made of. Diagnostics carried the grid
 * attempts (each rung and its matches) and nothing that would have answered
 * any of those. This probe does, without DevTools, which the operator's
 * browser refuses to paste into: it reads what is around the words
 * "Container Number" wherever they appear as text, and says what it can see
 * of the frames and the markers. Read-only; nothing here writes, clicks or
 * leaves the document.
 */

import { INTTRA_PAGE_SIGNATURES } from '../pages.js';
import { isInttraVisible } from './fieldWriter.js';
import { readHeaderCell } from './gridWriter.js';

/** How the Container Number heading's wording is recognised for the probe: wider than the grid writer's aliases on purpose, so a near miss is still shown. */
const CONTAINER_NUMBER_WORDS = /container\s*(number|no\b\.?|nbr|#)/i;

/** How many ancestors of the heading's text are described, and how many of those levels have their sibling cells listed. */
const ANCESTOR_LEVELS = 8;
const ROW_LEVELS = 4;

/** How many occurrences of the words are described at most, and how long a sibling's text may be. */
const MAX_OCCURRENCES = 3;
const MAX_CELLS = 12;
const MAX_CELL_TEXT = 40;

export interface StructureRow {
  /** How many ancestors above the text's parent this row is (0: the text's grandparent). */
  level: number;
  /** The row as `tag#id.class`. */
  row: string;
  /** The row's element children, read as header cells would be, in order. */
  cells: string[];
}

export interface StructureOccurrence {
  /** The text as found, collapsed. */
  text: string;
  /** The text's parent and its ancestors, nearest first, as `tag#id.class`. */
  ancestors: string[];
  /** For the first levels whose row has two or more children: the siblings of the cell at that level. */
  rows: StructureRow[];
  visible: boolean;
}

export interface InttraStructureProbe {
  /** Is the answering document the tab's top frame? A grid drawn in a frame the helper is not injected into would explain a screen that is never identified. */
  topFrame: boolean;
  /** Every <iframe> in the document, as the host of its src, or `(no src)`. */
  frames: string[];
  /** Each marker selector of every screen signature, and whether it is absent, in the DOM but hidden, or visible. */
  markers: Array<{ selector: string; state: 'absent' | 'hidden' | 'visible' }>;
  /** Where the words "Container Number" appear as text, with what is around them. */
  containerNumber: StructureOccurrence[];
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** `tag#id.class.class`, enough to find the element again in DevTools. */
export function describeElement(element: Element): string {
  const id = element.id ? `#${element.id}` : '';
  const classes = Array.from(element.classList)
    .slice(0, 4)
    .map((name) => `.${name}`)
    .join('');
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

function textNodes(doc: Document): Text[] {
  const found: Text[] = [];
  const stack: Node[] = [doc];
  while (stack.length) {
    const node = stack.pop() as Node;
    if (node.nodeType === Node.TEXT_NODE) {
      found.push(node as Text);
      continue;
    }
    if (node.nodeType === Node.ELEMENT_NODE && ['SCRIPT', 'STYLE', 'TEMPLATE', 'OPTION', 'OPTGROUP'].includes((node as Element).tagName)) continue;
    const children = Array.from(node.childNodes);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index] as Node);
    const shadow = (node as Element).shadowRoot;
    if (shadow) stack.push(shadow);
  }
  return found;
}

function frameHost(frame: Element, base: string): string {
  const src = frame.getAttribute('src');
  if (!src) return '(no src)';
  try {
    return new URL(src, base).host || src;
  } catch {
    return src;
  }
}

function markerState(doc: Document, selector: string): 'absent' | 'hidden' | 'visible' {
  let matches: Element[] = [];
  try {
    matches = Array.from(doc.querySelectorAll(selector));
  } catch {
    return 'absent';
  }
  if (!matches.length) return 'absent';
  return matches.some((element) => isInttraVisible(element)) ? 'visible' : 'hidden';
}

function occurrence(text: Text): StructureOccurrence | null {
  const start = text.parentElement;
  if (!start) return null;
  const ancestors: string[] = [];
  const rows: StructureRow[] = [];
  let cell: Element | null = start;
  for (let level = 0; cell && level < ANCESTOR_LEVELS; cell = cell.parentElement, level += 1) {
    ancestors.push(describeElement(cell));
    const row = cell.parentElement;
    if (!row || rows.length >= ROW_LEVELS || row.children.length < 2) continue;
    rows.push({
      level,
      row: describeElement(row),
      cells: Array.from(row.children)
        .slice(0, MAX_CELLS)
        .map((sibling) => readHeaderCell(sibling).text.slice(0, MAX_CELL_TEXT)),
    });
  }
  return { text: collapse(text.textContent ?? ''), ancestors, rows, visible: isInttraVisible(start) };
}

/** Is this document the top frame of its tab? A cross-origin `top` cannot be read, but it can be compared. */
export function isTopFrame(win: Window): boolean {
  try {
    return win.top === win;
  } catch {
    return false;
  }
}

export function probeStructure(doc: Document = document, win: Window = window): InttraStructureProbe {
  const containerNumber: StructureOccurrence[] = [];
  for (const text of textNodes(doc)) {
    if (containerNumber.length >= MAX_OCCURRENCES) break;
    if (!CONTAINER_NUMBER_WORDS.test(text.textContent ?? '')) continue;
    const found = occurrence(text);
    if (found) containerNumber.push(found);
  }
  const selectors = INTTRA_PAGE_SIGNATURES.flatMap((signature) => signature.markerSelectors);
  return {
    topFrame: isTopFrame(win),
    frames: Array.from(doc.querySelectorAll('iframe')).map((frame) => frameHost(frame, doc.location?.href ?? '')),
    markers: selectors.map((selector) => ({ selector, state: markerState(doc, selector) })),
    containerNumber,
  };
}
