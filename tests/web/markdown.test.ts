/**
 * The dashboard's Markdown reader, against the constructs the two bundled
 * guides use, and the Help tab that shows them.
 */

import { describe, expect, it } from 'vitest';

import { headingId, parseMarkdown, plainText, renderInline, renderMarkdown } from '../../web/src/markdown.js';
import { GUIDES, guideByFile } from '../../web/src/guides.js';

const SAMPLE = `# The guide

Intro with **bold**, \`code\`, *italic* and a [link](SETUP-GUIDE.md#2-quickbooks-setup).

## Contents

1. [First](#1-first-step)
2. [Second](#2-second)

---

## 1. First step

1. Open the panel, **Import**, and choose the file. It is parsed in the
   browser; nothing is uploaded.
2. Read the review:

   \`\`\`
   Booking reference      : EBKG18531408   ✓
   \`\`\`

   | Mark | Meaning |
   | --- | --- |
   | ✓ | read with confidence |
   | ⚠ | missing |

3. Approve.

- a bullet
- another with \`code\`

> **Status:** a quote.

| Setting | Default |
| --- | --- |
| Rounding | 2 decimals |
`;

describe('parseMarkdown', () => {
  it('reads headings, paragraphs, rules, quotes and tables', () => {
    const blocks = parseMarkdown(SAMPLE);
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: 'The guide' });
    expect(blocks[1]?.type).toBe('paragraph');
    expect(blocks.some((block) => block.type === 'rule')).toBe(true);
    const quote = blocks.find((block) => block.type === 'quote');
    expect(quote && quote.type === 'quote' && quote.blocks[0]?.type).toBe('paragraph');
    const table = blocks.filter((block) => block.type === 'table').at(-1);
    expect(table).toEqual({ type: 'table', header: ['Setting', 'Default'], rows: [['Rounding', '2 decimals']] });
  });

  it('keeps a code block and a table nested inside an ordered list item', () => {
    const blocks = parseMarkdown(SAMPLE);
    const list = blocks.find((block) => block.type === 'list' && block.ordered && block.items.length === 3);
    expect(list).toBeDefined();
    if (!list || list.type !== 'list') return;
    expect(list.items[0]?.[0]).toEqual({ type: 'paragraph', text: 'Open the panel, **Import**, and choose the file. It is parsed in the browser; nothing is uploaded.' });
    const second = list.items[1] ?? [];
    expect(second.map((block) => block.type)).toEqual(['paragraph', 'code', 'table']);
    expect(second[1]).toMatchObject({ type: 'code', text: 'Booking reference      : EBKG18531408   ✓' });
    expect(second[2]).toMatchObject({ type: 'table', header: ['Mark', 'Meaning'] });
    expect(list.items[2]).toEqual([{ type: 'paragraph', text: 'Approve.' }]);
  });

  it('separates a bulleted list from the ordered one before it', () => {
    const lists = parseMarkdown(SAMPLE).filter((block) => block.type === 'list');
    expect(lists.map((list) => list.type === 'list' && list.ordered)).toEqual([true, true, false]);
  });

  it('keeps the first number of an ordered list, as the guides count from 0', () => {
    const blocks = parseMarkdown('0. [Glance](#0-glance)\n1. [Next](#1-next)\n');
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: true, start: 0 });
    expect(renderMarkdown('0. a\n1. b\n').querySelector('ol')?.getAttribute('start')).toBe('0');
    expect(renderMarkdown('1. a\n2. b\n').querySelector('ol')?.hasAttribute('start')).toBe(false);
  });

  it('gives headings the ids GitHub gives them', () => {
    expect(headingId('1. First step')).toBe('1-first-step');
    expect(headingId('2. Get the identifiers from the email (Deckhand)')).toBe('2-get-the-identifiers-from-the-email-deckhand');
    expect(headingId('Settings, clearing data, the session log')).toBe('settings-clearing-data-the-session-log');
    expect(plainText('**[SETUP-GUIDE.md](SETUP-GUIDE.md)** and `code`')).toBe('SETUP-GUIDE.md and code');
  });
});

describe('renderMarkdown', () => {
  it('builds elements with createElement only, with inline markup as elements', () => {
    const node = renderMarkdown(SAMPLE);
    expect(node.querySelector('h1')?.textContent).toBe('The guide');
    expect(node.querySelector('h1')?.id).toBe('the-guide');
    expect(node.querySelector('strong')?.textContent).toBe('bold');
    expect(node.querySelector('em')?.textContent).toBe('italic');
    expect(node.querySelector('p code')?.textContent).toBe('code');
    expect(node.querySelector('pre code')?.textContent).toContain('EBKG18531408');
    expect(node.querySelectorAll('table')).toHaveLength(2);
    expect(node.querySelector('blockquote strong')?.textContent).toBe('Status:');
    expect(node.querySelector('ol li ol, ol li pre')).not.toBeNull();
    // No markup survives as literal text.
    expect(node.textContent).not.toContain('**');
    expect(node.textContent).not.toContain('](');
  });

  it('drops a link target unless the caller resolves it, and never emits markup from text', () => {
    const plain = renderInline('see [the guide](https://example.invalid/x) <b>not html</b>');
    const holder = document.createElement('div');
    holder.append(...plain);
    expect(holder.querySelector('a')).toBeNull();
    expect(holder.querySelector('b')).toBeNull();
    expect(holder.textContent).toBe('see the guide <b>not html</b>');

    const resolved = renderMarkdown('[Setup](SETUP-GUIDE.md#2-quickbooks-setup)', { link: (href, children) => { const a = document.createElement('a'); a.setAttribute('data-href', href); a.append(...children); return a; }, idPrefix: 'x-' });
    expect(resolved.querySelector('a')?.getAttribute('data-href')).toBe('SETUP-GUIDE.md#2-quickbooks-setup');
  });
});

describe('the bundled guides', () => {
  it('are the repository docs, and every section link in their tables of contents resolves', () => {
    expect(GUIDES.map((guide) => guide.file)).toEqual(['USER-GUIDE.md', 'SETUP-GUIDE.md']);
    expect(guideByFile('setup-guide.md')?.id).toBe('setup');
    for (const guide of GUIDES) {
      expect(guide.text.length).toBeGreaterThan(5000);
      const node = renderMarkdown(guide.text, { idPrefix: `${guide.id}-` });
      const ids = new Set(Array.from(node.querySelectorAll('h1, h2, h3, h4')).map((heading) => heading.id));
      const anchors = [...guide.text.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1] as string);
      expect(anchors.length).toBeGreaterThan(5);
      for (const anchor of anchors) expect(ids.has(`${guide.id}-${anchor}`), `${guide.file}#${anchor}`).toBe(true);
      expect(node.textContent).not.toMatch(/\*\*|\]\(/);
    }
  });
});
