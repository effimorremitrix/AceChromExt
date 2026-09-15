/**
 * A small Markdown reader for the guides bundled into the dashboard.
 *
 * The page never assigns innerHTML (tests/webInvariants.test.ts), so the
 * guides are parsed into blocks and rendered with createElement, the same
 * way every other screen is built. It reads what the repository's guides
 * use and nothing more: headings, paragraphs, fenced code, tables, nested
 * ordered and bulleted lists, block quotes, rules, and inline bold, italic,
 * code and links. Anything else renders as its literal text.
 */

import { el } from '../../src/ui/dom.js';

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; text: string; language: string }
  | { type: 'list'; ordered: boolean; items: Block[][]; start?: number }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'rule' };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*```\s*([\w-]*)\s*$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|?\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function startsBlock(line: string, next: string | undefined): boolean {
  return HEADING.test(line) || FENCE.test(line) || RULE.test(line) || LIST_ITEM.test(line) || QUOTE.test(line) || (TABLE_ROW.test(line) && next !== undefined && TABLE_SEPARATOR.test(next));
}

function splitCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

export function parseMarkdown(text: string): Block[] {
  return parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'));
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] as string;
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] as string)) {
        body.push(lines[index] as string);
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', text: body.join('\n'), language: fence[1] ?? '' });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: (heading[1] as string).length, text: heading[2] as string });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] as string)) {
        inner.push((QUOTE.exec(lines[index] as string) as RegExpExecArray)[1] as string);
        index += 1;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(inner) });
      continue;
    }

    if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1] as string)) {
      const header = splitCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index] as string) && !isBlank(lines[index] as string)) {
        rows.push(splitCells(lines[index] as string));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const indent = (item[1] as string).length;
      const ordered = /\d/.test(item[2] as string);
      const start = ordered ? Number.parseInt(item[2] as string, 10) : 1;
      const items: Block[][] = [];
      while (index < lines.length) {
        const current = LIST_ITEM.exec(lines[index] as string);
        if (!current || (current[1] as string).length !== indent || /\d/.test(current[2] as string) !== ordered) break;
        const contentIndent = indent + (current[2] as string).length + 1;
        const own: string[] = [current[3] as string];
        index += 1;
        // Continuation: lines indented at least to the content, and blank
        // lines that are followed by one. Anything else ends the item.
        while (index < lines.length) {
          const next = lines[index] as string;
          if (isBlank(next)) {
            let look = index + 1;
            while (look < lines.length && isBlank(lines[look] as string)) look += 1;
            const after = lines[look];
            if (after !== undefined && /^\s+/.test(after) && (after.match(/^\s*/) as RegExpMatchArray)[0].length >= contentIndent) {
              own.push('');
              index += 1;
              continue;
            }
            break;
          }
          const leading = (next.match(/^\s*/) as RegExpMatchArray)[0].length;
          if (leading >= contentIndent) {
            own.push(next.slice(contentIndent));
            index += 1;
            continue;
          }
          // A lazy continuation line of the item's first paragraph.
          if (!LIST_ITEM.test(next) && !startsBlock(next, lines[index + 1]) && own[own.length - 1] !== '' && leading <= indent) {
            own.push(next.trim());
            index += 1;
            continue;
          }
          break;
        }
        items.push(parseBlocks(own));
        while (index < lines.length && isBlank(lines[index] as string)) {
          // Blank lines between items of the same list.
          const look = lines[index + 1];
          const following = look === undefined ? null : LIST_ITEM.exec(look);
          if (following && (following[1] as string).length === indent) index += 1;
          else break;
        }
      }
      blocks.push({ type: 'list', ordered, items, ...(ordered && start !== 1 ? { start } : {}) });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && !isBlank(lines[index] as string) && !startsBlock(lines[index] as string, lines[index + 1])) {
      paragraph.push((lines[index] as string).trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

/** Inline markup stripped: the heading's words, for its id and for search. */
export function plainText(markup: string): string {
  return markup
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

/** The id GitHub gives a heading, so the guides' own tables of contents keep working. */
export function headingId(text: string): string {
  return plainText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

export interface RenderOptions {
  /** How a link renders. Default: its text, with the target dropped. */
  link?: (href: string, children: Node[]) => Node;
  /** Prefix for heading ids, so two documents on one page do not collide. */
  idPrefix?: string;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n](?:[^*\n]|\*(?!\*))*?\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s\n](?:[^*\n])*?\*)/;

export function renderInline(markup: string, options: RenderOptions = {}): Node[] {
  const nodes: Node[] = [];
  let rest = markup;
  while (rest !== '') {
    const match = INLINE.exec(rest);
    if (!match) {
      nodes.push(document.createTextNode(rest));
      break;
    }
    if (match.index > 0) nodes.push(document.createTextNode(rest.slice(0, match.index)));
    const token = match[0];
    if (match[1]) {
      nodes.push(el('code', { text: token.slice(1, -1) }));
    } else if (match[2]) {
      nodes.push(el('strong', {}, renderInline(token.slice(2, -2), options)));
    } else if (match[3]) {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) as RegExpExecArray;
      const children = renderInline(parts[1] as string, options);
      nodes.push(options.link ? options.link(parts[2] as string, children) : el('span', {}, children));
    } else {
      nodes.push(el('em', {}, renderInline(token.slice(1, -1), options)));
    }
    rest = rest.slice(match.index + token.length);
  }
  return nodes;
}

export function renderBlocks(blocks: Block[], options: RenderOptions = {}): Node[] {
  return blocks.map((block) => {
    switch (block.type) {
      case 'heading': {
        const tag = `h${Math.min(block.level, 6)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        return el(tag, { attrs: { id: `${options.idPrefix ?? ''}${headingId(block.text)}` } }, renderInline(block.text, options));
      }
      case 'paragraph':
        return el('p', {}, renderInline(block.text, options));
      case 'code':
        return el('pre', { attrs: block.language ? { 'data-language': block.language } : {} }, [el('code', { text: block.text })]);
      case 'list':
        return el(block.ordered ? 'ol' : 'ul', { attrs: block.start !== undefined ? { start: String(block.start) } : {} }, block.items.map((item) => el('li', {}, renderBlocks(item, options))));
      case 'table':
        return el('div', { className: 'web-table-wrap' }, [
          el('table', { className: 'web-table' }, [
            el('thead', {}, [el('tr', {}, block.header.map((cell) => el('th', {}, renderInline(cell, options))))]),
            el('tbody', {}, block.rows.map((row) => el('tr', {}, row.map((cell) => el('td', {}, renderInline(cell, options)))))),
          ]),
        ]);
      case 'quote':
        return el('blockquote', {}, renderBlocks(block.blocks, options));
      case 'rule':
        return el('hr');
      default:
        return document.createTextNode('');
    }
  });
}

/** Markdown text -> a DOM node, built with createElement only. */
export function renderMarkdown(text: string, options: RenderOptions = {}): HTMLElement {
  return el('div', { className: 'doc' }, renderBlocks(parseMarkdown(text), options));
}
