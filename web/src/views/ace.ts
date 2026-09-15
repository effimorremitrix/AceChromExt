/**
 * ACE readiness: the ACE Helper's own data quality checks and mapping status,
 * computed here without an ACE tab. What it cannot know is whether each
 * selector resolves on the live step; the ACE Helper reports that in front
 * of the form.
 */

import { el } from '../../../src/ui/dom.js';
import type { ShipmentRecord } from '../state.js';
import type { DashboardActions } from '../app.js';
import { aceCounts, type AceReadiness } from '../readiness.js';
import { handoffCard, statusPill, table } from './shared.js';

const STATUS_TONE: Record<string, string> = {
  READY: '',
  'NOT CHECKED': '',
  REVIEW: 'row-yellow',
  MISSING: 'row-yellow',
  ERROR: 'row-red',
  'NOT FOUND': 'row-red',
  AMBIGUOUS: 'row-red',
  EMPTY: '',
};

export function renderAce(record: ShipmentRecord, actions: DashboardActions, readiness: AceReadiness): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(
    el('h2', {}, [el('span', { text: 'ACE readiness' }), statusPill(readiness.status)]),
    el('p', { className: 'small muted', text: 'What the ACE Helper will see when it imports this shipment: the same ten data quality checks and the same field-by-field mapping status. "Not checked" means the value is fine and only the live ACE page can confirm the field exists there.' }),
  );

  if (!readiness.data || !readiness.preflight) {
    section.append(el('div', { className: 'notice notice-warn' }, [el('strong', { text: 'Not available. ' }), el('span', { text: readiness.reason })]));
    return section;
  }

  const data = readiness.data;
  section.append(
    el('div', { className: 'notice notice-muted small' }, [
      el('strong', { text: `${data.source.label}: ` }),
      el('span', { text: data.fromPackage ? 'booking, vessel, container and seal are taken from the approved Deckhand extraction where the package allows it; everything else from the invoice.' : 'read from the imported workbook. Build the package to overlay the approved extraction.' }),
    ]),
  );
  for (const note of data.view.notes) section.append(el('div', { className: `note note-${note.severity} small`, text: note.message }));

  const checks = el('ul', { className: 'check-list' });
  for (const check of readiness.preflight.checks) {
    checks.append(
      el('li', { className: `check check-${check.status}` }, [
        el('span', { className: 'check-mark', text: check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗' }),
        el('span', { className: 'check-label', text: check.label }),
        el('span', { className: 'small muted', text: check.detail }),
      ]),
    );
  }
  section.append(el('div', { className: `card${readiness.preflight.ready ? '' : ' preflight-bad'}` }, [el('strong', { text: 'Data quality checks' }), checks, el('p', { className: 'small muted', text: 'They report; they do not block. A field with a blocking issue is skipped by the ACE Helper, never guessed.' })]));

  const lines = data.view.shipment.commodities;
  const picker = el('select', { className: 'select', attrs: { 'aria-label': 'Commodity line' } }) as HTMLSelectElement;
  for (const line of lines) {
    const option = el('option', { text: `Line ${line.line}: ${line.description || '(no description)'}`, attrs: { value: String(line.line) } }) as HTMLOptionElement;
    if (line.line === readiness.line) option.selected = true;
    picker.append(option);
  }
  picker.addEventListener('change', () => actions.setAceLine(Number(picker.value)));

  const counts = aceCounts(readiness.mapping);
  section.append(
    el('div', { className: 'card' }, [
      el('div', { className: 'readiness' }, [
        el('strong', { text: `Mapping status: ${counts.withValue} of ${counts.total} ACE fields have a value, ${counts.missing} expected value(s) missing, ${counts.review} to review, ${counts.error} cannot be written` }),
        lines.length > 1 ? el('label', { className: 'field' }, [el('span', { text: 'Commodity line' }), picker]) : null,
      ]),
      table(
        ['ACE step', 'ACE field', 'Source', 'Original', 'Transformation', 'ACE value', 'Status'],
        readiness.mapping.map((row) => ({
          className: STATUS_TONE[row.status] ?? '',
          cells: [row.page, row.aceField, row.source, row.original || '-', row.transform ?? '-', el('span', { className: 'mono', text: row.aceValue || '-' }), el('span', { text: `${row.status}${row.message ? `: ${row.message}` : ''}` })],
        })),
      ),
    ]),
  );

  const downloadPackage = el('button', { className: 'button button-primary', text: 'Download filing-package.json', attrs: { type: 'button', ...(record.pkg ? {} : { disabled: 'disabled' }) } });
  downloadPackage.addEventListener('click', () => actions.downloadPackage());
  const downloadWorkbook = el('button', { className: 'button', text: 'Download ACE workbook (.xlsx)', attrs: { type: 'button' } });
  downloadWorkbook.addEventListener('click', () => actions.downloadWorkbook());
  section.append(
    handoffCard(
      'Then, in Chrome',
      [
        '1. Open the ACE Helper panel (toolbar icon, Open full panel) and import the file you download here.',
        '2. Read the preview and the mapping status there; the ACE Helper resolves each field against the open ACE step and writes only what it finds with confidence.',
        '3. Fill Current Page / Fill Current Commodity Line on each step. Save, and submit, in ACE yourself.',
        'The Transportation step (5 fields) has placeholder selectors until captured from live ACE; see docs/ACE-MAPPING.md.',
      ],
      [downloadPackage, downloadWorkbook],
    ),
  );
  return section;
}
