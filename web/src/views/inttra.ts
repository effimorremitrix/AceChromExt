/**
 * INTTRA readiness: which package value feeds which INTTRA screen and grid
 * column, from the INTTRA Helper's own mapping tables. Every INTTRA selector
 * is still a placeholder, and the screen says so.
 */

import { el } from '../../../src/ui/dom.js';
import type { ShipmentRecord } from '../state.js';
import type { DashboardActions } from '../app.js';
import type { InttraReadiness } from '../readiness.js';
import { handoffCard, statusPill, table, valueTone } from './shared.js';

export function renderInttra(record: ShipmentRecord, actions: DashboardActions, readiness: InttraReadiness): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(
    el('h2', {}, [el('span', { text: 'INTTRA readiness' }), statusPill(readiness.status)]),
    el('p', { className: 'small muted', text: 'What the INTTRA Helper will fill from this package, screen by screen, and the container grid row by row. A missing value is typed in the Package tab (recorded as yours) or in INTTRA.' }),
  );

  if (!readiness.pkg || !readiness.gate) {
    section.append(el('div', { className: 'notice notice-warn' }, [el('strong', { text: 'Not available. ' }), el('span', { text: readiness.reason })]));
    return section;
  }

  const gate = readiness.gate;
  section.append(
    el('div', { className: `notice ${gate.ok ? '' : 'notice-warn'}` }, [
      el('strong', { text: gate.ok ? 'Ready. ' : 'Not ready to fill. ' }),
      el('span', { text: gate.ok ? 'The Deckhand half is approved and no material conflict is open. The INTTRA Helper will accept this package.' : gate.reasons.join(' ') }),
    ]),
  );
  section.append(
    el('div', { className: 'notice notice-muted small' }, [
      el('strong', { text: 'Selectors: ' }),
      el('span', { text: `${readiness.unverifiedFields} INTTRA field mappings are placeholders that have never been captured from the live portal. The helper writes a field only when it finds it; until the selectors are captured (docs/INTTRA-INTEGRATION.md section 6) it will report most fields as not found. This screen shows which values are ready to be written, not whether the portal will accept them.` }),
    ]),
  );

  for (const screen of readiness.screens) {
    const title = screen.containerIndex === undefined ? screen.label : `${screen.label} - container ${screen.containerIndex + 1}`;
    section.append(
      el('details', { className: 'card', attrs: screen.missing ? { open: 'open' } : {} }, [
        el('summary', {}, [el('strong', { text: title }), el('span', { className: `pill pill-${screen.missing ? 'yellow' : 'green'}`, text: `${screen.ready} ready${screen.missing ? `, ${screen.missing} missing` : ''}` })]),
        table(
          ['INTTRA field', 'Value', 'Where from', 'Status'],
          screen.fields.map((field) => ({
            className: valueTone(field.status),
            cells: [field.label, el('span', { className: 'mono', text: field.value || '-' }), field.provenance, field.status === 'ready' ? 'ready' : field.status === 'missing' ? 'missing (expected)' : 'empty (optional)'],
          })),
        ),
      ]),
    );
  }

  const grid = readiness.grid;
  section.append(
    el('details', { className: 'card', attrs: { open: 'open' } }, [
      el('summary', {}, [el('strong', { text: `Copy Container Details - the grid (${grid.rows.length} row(s))` })]),
      el('p', { className: 'small muted', text: 'One row per container. The helper identifies each column by its heading, never by position, and never presses Add Row: add the rows in INTTRA first.' }),
      grid.rows.length
        ? table(
            ['#', ...grid.columns],
            grid.rows.map((row) => ({
              cells: [String(row.index + 1), ...row.cells.map((cell) => el('span', { className: cell.status === 'missing' ? 'error' : cell.status === 'empty' ? 'muted' : 'mono', text: cell.value || (cell.status === 'missing' ? 'missing' : '-'), title: cell.provenance }))],
            })),
            'web-grid',
          )
        : el('p', { className: 'small warn', text: 'No containers in this package.' }),
    ]),
  );

  const download = el('button', { className: 'button button-primary', text: 'Download filing-package.json', attrs: { type: 'button' } });
  download.addEventListener('click', () => actions.downloadPackage());
  section.append(
    handoffCard(
      'Then, in Chrome',
      [
        '1. Log in to INTTRA yourself and open the Shipping Instruction. The helper never logs in.',
        '2. Open the INTTRA Helper panel, Import, choose the package you download here.',
        '3. On each screen press Fill Current Page; on Copy Container Details add the rows, then Fill Container Grid (or Copy rows as TSV and paste).',
        '4. Read every field. Save, continue and submit in INTTRA yourself.',
      ],
      [download],
    ),
  );
  void record;
  return section;
}
