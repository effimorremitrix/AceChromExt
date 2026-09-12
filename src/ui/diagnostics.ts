/**
 * Developer diagnostics view.
 *
 * Off by default. When ACE changes its DOM this is the panel that says which
 * logical field stopped resolving and exactly what to capture from DevTools to
 * fix the mapping.
 */

import type { DiagnosticsSnapshot } from '../core/messages.js';
import { clear, el } from './dom.js';

function statusClass(status: string): string {
  switch (status) {
    case 'FOUND':
      return 'pill pill-green';
    case 'AMBIGUOUS':
      return 'pill pill-red';
    case 'NOT_WRITABLE':
      return 'pill pill-yellow';
    default:
      return 'pill pill-red';
  }
}

export function renderDiagnostics(container: HTMLElement, snapshot: DiagnosticsSnapshot | null): void {
  clear(container);

  if (!snapshot) {
    container.append(el('p', { className: 'muted', text: 'Run diagnostics on an open ACE page to see field detection results.' }));
    return;
  }

  const { page } = snapshot;

  container.append(
    el('div', { className: 'diag-head' }, [
      el('div', {}, [
        el('span', { className: 'label', text: 'Current ACE page: ' }),
        el('strong', { text: page.label }),
        el('span', { className: `pill pill-${page.confidence === 'high' ? 'green' : page.confidence === 'none' ? 'red' : 'yellow'}`, text: `confidence: ${page.confidence}` }),
      ]),
      el('div', { className: 'muted small', text: snapshot.url }),
      el('div', { className: 'muted small', text: `Generated ${new Date(snapshot.generatedAt).toLocaleTimeString()}` }),
    ]),
  );

  if (page.evidence.length) {
    container.append(
      el('details', { className: 'diag-block' }, [
        el('summary', { text: 'Page detection evidence' }),
        el(
          'ul',
          { className: 'small' },
          page.evidence.map((line) => el('li', { text: line })),
        ),
        el(
          'ul',
          { className: 'small muted' },
          page.scores.map((score) => el('li', { text: `${score.page}: score ${score.score}` })),
        ),
      ]),
    );
  }

  if (!snapshot.fields.length) {
    container.append(el('p', { className: 'muted', text: 'No fields are mapped for this page.' }));
    return;
  }

  const found = snapshot.fields.filter((field) => field.detection.status === 'FOUND').length;
  container.append(
    el('p', { className: 'small', text: `Detected ${found} of ${snapshot.fields.length} mapped fields.` }),
  );

  const list = el('div', { className: 'diag-fields' });

  for (const field of snapshot.fields) {
    const detection = field.detection;

    const header = el('summary', {}, [
      el('span', { className: 'diag-key', text: field.key }),
      el('span', { className: statusClass(detection.status), text: detection.status }),
      field.verificationStatus === 'placeholder'
        ? el('span', { className: 'pill pill-grey', text: 'selector unverified' })
        : null,
    ]);

    const body = el('div', { className: 'diag-body' }, [
      el('div', { className: 'small' }, [
        el('span', { className: 'label', text: 'Logical field: ' }),
        el('span', { text: `${field.label} (${field.scope})` }),
      ]),
      detection.matchedWith
        ? el('div', { className: 'small' }, [
            el('span', { className: 'label', text: 'Matched by: ' }),
            el('code', { text: `${detection.matchedBy ?? '?'} -> ${detection.matchedWith}` }),
            el('span', { className: 'muted', text: ` (confidence ${detection.confidence})` }),
          ])
        : null,
      detection.ambiguousCount
        ? el('div', { className: 'small warn', text: `${detection.ambiguousCount} elements matched; the field is not written.` })
        : null,
      el('div', { className: 'small' }, [
        el('span', { className: 'label', text: 'Candidates tried:' }),
        el(
          'ol',
          { className: 'small mono' },
          detection.attempts.map((attempt) =>
            el('li', {
              text: `[${attempt.strategy}${attempt.verified ? ', verified' : ''}] ${attempt.query} -> ${attempt.matches} match(es)`,
            }),
          ),
        ),
      ]),
      field.devtoolsHint && detection.status !== 'FOUND'
        ? el('div', { className: 'hint-box small' }, [
            el('strong', { text: 'Capture from ACE DevTools: ' }),
            el('span', { text: field.devtoolsHint }),
          ])
        : null,
    ]);

    list.append(el('details', { className: 'diag-field' }, [header, body]));
  }

  container.append(list);
}
