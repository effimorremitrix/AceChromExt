/**
 * Help: the operator's guide and the setup guide, from the repository's own
 * docs, readable without leaving the page.
 *
 * Links between the two guides switch guides here; links to a section stay
 * on the page; links to any other document are shown as the document's
 * name, because the page loads nothing from anywhere and opens no link out.
 */

import { el } from '../../../src/ui/dom.js';
import { GUIDES, guideByFile, guideById, type GuideId } from '../guides.js';
import { headingId, renderMarkdown } from '../markdown.js';
import type { DashboardActions } from '../app.js';

export interface HelpModel {
  guide: GuideId;
  onSelect(guide: GuideId, anchor?: string): void;
}

function idPrefix(guide: GuideId): string {
  return `${guide}-guide-`;
}

/** Scroll to a heading of the shown guide, by the anchor the guide's own links use. */
export function scrollToAnchor(guide: GuideId, anchor: string): void {
  const target = document.getElementById(`${idPrefix(guide)}${anchor.replace(/^#/, '')}`);
  if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
}

export function renderHelp(actions: DashboardActions, model: HelpModel): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  const current = guideById(model.guide);

  const picker = el('div', { className: 'actions web-help-picker', attrs: { role: 'tablist' } });
  for (const guide of GUIDES) {
    const button = el('button', {
      className: `button${guide.id === model.guide ? ' button-primary' : ''}`,
      text: guide.label,
      attrs: { type: 'button', role: 'tab', 'aria-selected': guide.id === model.guide ? 'true' : 'false', 'data-guide': guide.id },
    });
    button.addEventListener('click', () => model.onSelect(guide.id));
    picker.append(button);
  }

  section.append(
    el('h2', { text: 'Help' }),
    el('p', { className: 'small muted', text: `The same guides as docs/${GUIDES.map((guide) => guide.file).join(' and docs/')} in the repository, bundled into this page when it was built. Nothing is loaded from anywhere while you read.` }),
    picker,
  );

  const link = (href: string, children: Node[]): Node => {
    const [file, anchor] = href.split('#') as [string, string | undefined];
    if (file === '') {
      // A section of the guide being shown.
      const target = `#${idPrefix(model.guide)}${anchor ?? ''}`;
      const node = el('a', { className: 'link', attrs: { href: target } }, children);
      node.addEventListener('click', (event) => {
        event.preventDefault();
        scrollToAnchor(model.guide, anchor ?? '');
      });
      return node;
    }
    const other = guideByFile(file);
    if (other) {
      const node = el('a', { className: 'link', attrs: { href: `#${idPrefix(other.id)}${anchor ?? ''}` } }, children);
      node.addEventListener('click', (event) => {
        event.preventDefault();
        model.onSelect(other.id, anchor);
      });
      return node;
    }
    // Another document of the repository, or anything outside: named, not linked.
    return el('span', { className: 'web-doc-ref', title: `${file} is in the repository's docs folder; this page opens no link.` }, [...children, el('span', { className: 'small muted', text: ` (docs/${file})` })]);
  };

  section.append(el('div', { className: 'card web-help' }, [renderMarkdown(current.text, { link, idPrefix: idPrefix(current.id) })]));
  void actions;
  void headingId;
  return section;
}
