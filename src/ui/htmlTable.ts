/**
 * The table the clipboard is already carrying.
 *
 * When a booking table is copied out of a mail client, the clipboard holds two
 * flavours of it: `text/html`, which is the real <table> with real rows and
 * cells, and `text/plain`, which is whatever that client could flatten it to.
 * A <textarea> takes the plain one and discards the other - and the plain one,
 * depending on the client, is either one cell per line or a run of spaces.
 *
 * That matters more here than it looks. The extractor in deckhand/ reads a
 * table correctly: give it the DOC CUT sheet with its rows intact and it
 * returns every container beside its own seal. Flatten the rows first and the
 * seal column is gone, because a seal is only ever paired with a container
 * through the row they share, and there is no longer a shared row. The
 * containers still come out, by shape; the seals do not.
 *
 * So the table is taken from the markup before the textarea can lose it. Every
 * cell keeps the row it was in, because the row is right there in the <tr>;
 * nothing is inferred, counted or aligned, and no rule here pairs anything
 * with anything - that stays where it belongs, in deckhand/.
 *
 * This lives in src/ui/ rather than in deckhand/ on purpose: it needs the DOM,
 * and deckhand/ is pure by invariant.
 *
 * On safety: parseFromString builds a detached document. It runs no script,
 * loads no image and fires no event. Nothing below reads anything but
 * textContent, tagName and colspan.
 */

/** Cell text. HTML collapses whitespace, and a tab or newline inside a cell would split it. */
function cellText(cell: Element): string {
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The table an element belongs to, so a table nested in a layout table is read on its own. */
function ownerTable(element: Element): Element | null {
  return element.closest('table');
}

/**
 * The rows of one table, rectangular. A cell spanning several columns is
 * expanded to that many cells, so everything below it stays in the column it
 * was typed in.
 */
export function tableRows(table: Element): string[][] {
  const rows: string[][] = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    if (ownerTable(tr) !== table) continue;
    const cells: string[] = [];
    for (const cell of Array.from(tr.querySelectorAll('th, td'))) {
      if (ownerTable(cell) !== table) continue;
      const span = Math.min(Math.max(Number(cell.getAttribute('colspan')) || 1, 1), 32);
      cells.push(cellText(cell));
      for (let i = 1; i < span; i += 1) cells.push('');
    }
    if (cells.length > 0) rows.push(cells);
  }

  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  return rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]);
}

/** Tab separated, one row per line: the shape the extractor reads best. */
export function toTsv(rows: string[][]): string {
  return rows.map((row) => row.join('\t')).join('\n');
}

/**
 * A table worth keeping: two or more rows, two or more columns, and something
 * written in it. Mail clients build layout out of one-cell and one-column
 * tables, and turning those into tab separated lines would only add noise.
 */
function isDataTable(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  if ((rows[0]?.length ?? 0) < 2) return false;
  return rows.some((row) => row.some((cell) => cell !== ''));
}

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI',
  'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL',
]);
const SKIP = new Set(['HEAD', 'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** The visible text of a node, with a line break where the markup put one. */
function textOf(node: Node): string {
  if (node.nodeType === TEXT_NODE) return (node.nodeValue ?? '').replace(/ /g, ' ');
  if (node.nodeType !== ELEMENT_NODE) return '';
  const tag = (node as Element).tagName.toUpperCase();
  if (SKIP.has(tag)) return '';
  if (tag === 'BR') return '\n';
  let out = '';
  for (const child of Array.from(node.childNodes)) out += textOf(child);
  return BLOCK.has(tag) ? `${out}\n` : out;
}

/** Collapse the whitespace HTML would have collapsed, leaving the tabs we inserted alone. */
function tidy(text: string): string {
  return text
    .replace(/[^\S\t\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface PastedTable {
  rows: number;
  columns: number;
}

export interface PastedHtml {
  /** The whole message as text, with every data table rewritten as tab separated rows. */
  text: string;
  /** What was rewritten, so the screen can say so rather than silently changing a paste. */
  tables: PastedTable[];
}

/**
 * Turn the `text/html` flavour of a paste into text, keeping its tables as
 * tables. Null when there is no data table in it: there is then nothing to
 * improve on, and the browser's own paste is left to happen.
 */
export function readHtmlClipboard(html: string): PastedHtml | null {
  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
  if (!parsed.body) return null;

  const tables: PastedTable[] = [];
  // Innermost first, so a data table becomes text before the layout table that
  // wraps it is walked; by then its cells are text and are not read twice.
  const found = Array.from(parsed.querySelectorAll('table')).reverse();
  for (const table of found) {
    const rows = tableRows(table);
    if (!isDataTable(rows)) continue;
    tables.push({ rows: rows.length, columns: rows[0]?.length ?? 0 });
    table.replaceWith(parsed.createTextNode(`\n${toTsv(rows)}\n`));
  }

  if (tables.length === 0) return null;
  const text = tidy(textOf(parsed.body));
  return text === '' ? null : { text, tables: tables.reverse() };
}

/** "10 rows x 6 columns", or "2 tables: 10 rows x 6 columns, 3 rows x 2 columns". */
export function describeTables(tables: PastedTable[]): string {
  const each = tables.map((t) => `${t.rows} row${t.rows === 1 ? '' : 's'} x ${t.columns} column${t.columns === 1 ? '' : 's'}`);
  return each.length === 1 ? (each[0] as string) : `${each.length} tables: ${each.join(', ')}`;
}
