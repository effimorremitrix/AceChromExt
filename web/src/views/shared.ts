/** Small view helpers shared by the dashboard tabs. */

import { el } from '../../../src/ui/dom.js';
import type { ReadinessStatus } from '../readiness.js';

export function statusPill(status: ReadinessStatus): HTMLElement {
  const tone = status === 'ready' ? 'green' : status === 'review' ? 'yellow' : status === 'blocked' ? 'red' : 'grey';
  const text = status === 'ready' ? 'Ready' : status === 'review' ? 'Review' : status === 'blocked' ? 'Blocked' : 'Not available';
  return el('span', { className: `pill pill-${tone}`, text });
}

export function valueTone(status: 'ready' | 'missing' | 'empty'): string {
  return status === 'ready' ? '' : status === 'missing' ? 'row-red' : '';
}

export function table(headers: string[], rows: Array<{ className?: string; cells: Array<string | Node> }>, className = ''): HTMLElement {
  const head = el('thead', {}, [el('tr', {}, headers.map((text) => el('th', { text })))]);
  const body = el('tbody', {}, rows.map((row) => el('tr', { className: row.className ?? '' }, row.cells.map((cell) => el('td', {}, [cell])))));
  return el('div', { className: 'web-table-wrap' }, [el('table', { className: `web-table ${className}`.trim() }, [head, body])]);
}

export function handoffCard(title: string, lines: string[], buttons: HTMLElement[]): HTMLElement {
  return el('div', { className: 'card' }, [
    el('strong', { text: title }),
    ...lines.map((line) => el('p', { className: 'small muted', text: line })),
    buttons.length ? el('div', { className: 'actions' }, buttons) : null,
  ]);
}
