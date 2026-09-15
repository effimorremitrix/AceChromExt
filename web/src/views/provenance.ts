/**
 * Provenance: every value, where it came from, in one searchable table.
 * "Where did this value come from?" should take one look, not a hunt.
 */

import { el } from '../../../src/ui/dom.js';
import type { ShipmentRecord } from '../state.js';
import type { DashboardActions } from '../app.js';
import { filterProvenance, type ProvenanceRow } from '../readiness.js';
import { table } from './shared.js';

const TONE: Record<ProvenanceRow['source'], string> = {
  quickbooks: 'green',
  excel: 'green',
  deckhand: 'green',
  derived: 'yellow',
  manual: 'blue',
  missing: 'red',
};

export function renderProvenance(record: ShipmentRecord, actions: DashboardActions, model: { rows: ProvenanceRow[]; preview: boolean }): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(
    el('h2', { text: 'Provenance' }),
    el('p', { className: 'small muted', text: 'Green: read from QuickBooks, Excel or the email with confidence. Yellow: derived (a total, a unit conversion, an HS code from the Schedule B) or read with low confidence. Blue: typed by you. Red: no source holds it.' }),
  );
  if (!model.rows.length) {
    section.append(el('p', { className: 'web-empty', text: 'Import the invoice or extract an email first.' }));
    return section;
  }
  if (model.preview) {
    section.append(el('div', { className: 'notice notice-muted small', text: 'Preview: the package has not been built yet, so these rows are computed from the current sources with no operator decisions applied.' }));
  }

  const search = el('input', { className: 'input web-search', attrs: { type: 'search', placeholder: 'Filter: a value, a field, a source...', value: actions.state.provenanceQuery, 'aria-label': 'Filter provenance rows' } }) as HTMLInputElement;
  search.addEventListener('change', () => actions.setProvenanceQuery(search.value));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') actions.setProvenanceQuery(search.value);
  });
  const rows = filterProvenance(model.rows, actions.state.provenanceQuery);
  section.append(el('div', { className: 'readiness' }, [search, el('span', { className: 'web-count', text: `${rows.length} of ${model.rows.length} values` })]));

  const hideEmptyMissing = rows.filter((row) => !(row.source === 'missing' && row.scope === 'header' && ['consigneeAddress2', 'consigneeState', 'paymentTerms', 'poNumber', 'freightTerms', 'shipmentReference'].includes(row.field)));
  section.append(
    el('div', { className: 'card' }, [
      table(
        ['Where', 'Field', 'Value', 'Source', 'Detail', 'Original', 'Transformation'],
        hideEmptyMissing.map((row) => ({
          className: row.source === 'missing' ? 'row-red' : row.source === 'manual' ? 'row-blue' : row.source === 'derived' ? 'row-yellow' : '',
          cells: [
            row.where,
            row.label,
            el('span', { className: 'mono', text: row.value || '(missing)' }),
            el('span', { className: `pill pill-${TONE[row.source]}`, text: row.description }),
            row.detail || '-',
            row.original || '-',
            row.transform || '-',
          ],
        })),
      ),
    ]),
  );
  void record;
  return section;
}
