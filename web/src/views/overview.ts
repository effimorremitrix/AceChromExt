/**
 * Overview: where this shipment stands and what to do next.
 *
 * Two questions, answered on one screen: "what do I still need to fix before
 * filing?" (the step list, with the next open step highlighted) and "what
 * goes to the extensions?" (the two download cards).
 */

import { el } from '../../../src/ui/dom.js';
import { fillGate } from '../../../shared/src/index.js';
import type { ShipmentRecord } from '../state.js';
import type { DashboardActions } from '../app.js';
import { loadSampleShipment, shipmentLabel } from '../workflow.js';
import { aceCounts, type AceReadiness, type InttraReadiness, type NextAction } from '../readiness.js';
import { handoffCard, statusPill } from './shared.js';

export interface OverviewModel {
  ace: AceReadiness;
  inttra: InttraReadiness;
  steps: NextAction[];
  onRename(name: string): void;
  onRemove(): void;
}

function statusLine(status: 'pass' | 'warn' | 'fail', text: string): HTMLElement {
  return el('li', { className: `status-line status-${status}` }, [
    el('span', { className: 'status-mark', text: status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗' }),
    el('span', { text }),
  ]);
}

export function renderOverview(record: ShipmentRecord, actions: DashboardActions, model: OverviewModel): HTMLElement {
  const section = el('section', { className: 'panel-section' });

  const name = el('input', { className: 'web-name', attrs: { type: 'text', value: record.name, placeholder: shipmentLabel(record), 'aria-label': 'Shipment name' } }) as HTMLInputElement;
  name.addEventListener('change', () => model.onRename(name.value));
  const remove = el('button', { className: 'button button-small button-danger', text: 'Close shipment', attrs: { type: 'button' } });
  remove.addEventListener('click', () => model.onRemove());
  section.append(el('div', { className: 'web-hero' }, [name, el('div', { className: 'actions' }, [remove])]));

  // ---- status ----
  const lines: HTMLElement[] = [];
  const commercial = record.commercial;
  lines.push(commercial ? statusLine('pass', `${commercial.source.label} loaded: ${commercial.fileName} (${commercial.shipment.commodities.length} line(s))`) : statusLine('warn', 'No invoice yet: import the ACE workbook or a filing package'));
  if (commercial) {
    const { errors, warnings } = commercial.validation;
    lines.push(errors ? statusLine('fail', `${errors} blocking data quality issue(s), ${warnings} to review`) : warnings ? statusLine('warn', `${warnings} data quality warning(s) to review`) : statusLine('pass', 'Data quality checks pass'));
  }
  const extraction = record.extraction;
  lines.push(!extraction ? statusLine('warn', 'No Deckhand extraction yet: paste the carrier email') : extraction.approvedAt ? statusLine('pass', `Deckhand extraction approved (${extraction.shipment.containers.length} container(s))`) : statusLine('warn', 'Deckhand extraction awaiting your review'));
  const pkg = record.pkg;
  if (pkg) {
    const unresolved = pkg.conflicts.filter((conflict) => conflict.resolution === 'unresolved').length;
    lines.push(statusLine('pass', `Filing package ${pkg.packageId} built (${pkg.containers.length} container(s))`));
    if (pkg.conflicts.length) lines.push(unresolved ? statusLine('fail', `${unresolved} conflict(s) to resolve between the invoice and the email`) : statusLine('pass', `${pkg.conflicts.length} conflict(s) resolved`));
    const gate = fillGate(pkg);
    lines.push(gate.ok ? statusLine('pass', 'Package ready for the extensions to fill from') : statusLine('fail', `Not ready to fill: ${gate.reasons.join(' ')}`));
  } else {
    lines.push(statusLine('warn', 'No filing package built yet'));
  }

  const statusChildren: Array<HTMLElement | null> = [el('strong', { text: 'Status' }), el('ul', { className: 'status-list web-mt' }, lines)];
  if (!commercial) {
    const sample = el('button', { className: 'button button-small', text: 'Load sample shipment', attrs: { type: 'button', title: 'Loads a bundled synthetic invoice and carrier email. Sample data, not a filing.' } });
    sample.addEventListener('click', () => actions.update(loadSampleShipment, 'Sample shipment loaded. This is sample data, not a filing.'));
    statusChildren.push(el('div', { className: 'actions web-mt' }, [sample, el('span', { className: 'small muted', text: 'Nothing to import yet? Try the bundled sample: synthetic data, marked as sample, never a filing.' })]));
  }
  section.append(
    el('div', { className: 'web-two' }, [
      el('div', { className: 'card' }, statusChildren),
      el('div', { className: 'card' }, [
        el('strong', { text: 'Readiness' }),
        el('div', { className: 'readiness web-mt' }, [el('span', { text: 'ACE (the ACE Helper fills from this)' }), statusPill(model.ace.status)]),
        el('p', { className: 'small muted', text: model.ace.preflight ? aceSummary(model.ace) : model.ace.reason }),
        el('div', { className: 'readiness' }, [el('span', { text: 'INTTRA (the INTTRA Helper fills from this)' }), statusPill(model.inttra.status)]),
        el('p', { className: 'small muted', text: model.inttra.gate ? (model.inttra.gate.ok ? `${model.inttra.grid.rows.length} container row(s); ${model.inttra.screens.reduce((sum, screen) => sum + screen.missing, 0)} expected screen value(s) missing.` : model.inttra.gate.reasons.join(' ')) : model.inttra.reason }),
        el('div', { className: 'actions' }, [linkTo(actions, 'ace', 'ACE detail'), linkTo(actions, 'inttra', 'INTTRA detail'), linkTo(actions, 'provenance', 'Where every value came from')]),
      ]),
    ]),
  );

  // ---- next steps ----
  const list = el('ol', { className: 'web-steps' });
  let nextMarked = false;
  model.steps.forEach((step, index) => {
    const isNext = !step.done && !nextMarked;
    if (isNext) nextMarked = true;
    const body = el('div', { className: 'web-step-body' }, [
      el('span', { text: step.step }),
      step.detail ? el('span', { className: 'small muted', text: step.detail }) : null,
    ]);
    if (step.tab && !step.done) {
      const go = el('button', { className: 'link-button', text: `Go to ${step.tab === 'overview' ? 'the downloads below' : step.tab}`, attrs: { type: 'button' } });
      go.addEventListener('click', () => (step.tab === 'overview' ? undefined : actions.goTo(step.tab as Exclude<typeof step.tab, undefined>)));
      body.append(go);
    }
    list.append(
      el('li', { className: `web-step${step.done ? ' web-step-done' : ''}${isNext ? ' web-step-next' : ''}` }, [
        el('span', { className: 'web-step-mark', text: step.done ? '✓' : String(index + 1) }),
        body,
      ]),
    );
  });
  section.append(el('div', { className: 'card' }, [el('strong', { text: 'What you still need to do' }), list]));

  // ---- hand-off ----
  const downloadPackage = el('button', { className: 'button button-primary', text: 'Download filing-package.json', attrs: { type: 'button', ...(pkg ? {} : { disabled: 'disabled' }) } });
  downloadPackage.addEventListener('click', () => actions.downloadPackage());
  const downloadWorkbook = el('button', { className: 'button', text: 'Download ACE workbook (.xlsx)', attrs: { type: 'button', ...(model.ace.data ? {} : { disabled: 'disabled' }) } });
  downloadWorkbook.addEventListener('click', () => actions.downloadWorkbook());
  section.append(
    el('div', { className: 'web-handoff' }, [
      handoffCard(
        'For both extensions: the filing package',
        ['One file with the invoice, the approved extraction, your decisions, and where every value came from. Import it in the ACE Helper panel or the INTTRA Helper panel (Import tab).', pkg ? `Ready: ${pkg.packageId}.` : 'Available once the package is built.'],
        [downloadPackage],
      ),
      handoffCard(
        'For the ACE Helper only: the Excel fallback',
        ['The same Shipment sheet the ACE Helper has always read, plus a Provenance sheet. Use it when the package is not wanted, or to hand the invoice to somebody who only has the ACE Helper.', model.ace.data ? (model.ace.data.fromPackage ? 'Booking, vessel, container and seal come from the approved extraction.' : 'Written from the imported workbook as it is.') : 'Available once the invoice is imported.'],
        [downloadWorkbook],
      ),
    ]),
  );

  // ---- activity ----
  section.append(
    el('details', { className: 'card' }, [
      el('summary', { text: `Activity (${record.activity.length})` }),
      el('ul', { className: 'web-activity' }, record.activity.map((entry) => el('li', {}, [el('time', { text: new Date(entry.at).toLocaleTimeString() }), el('span', { text: entry.message })]))),
    ]),
  );

  return section;
}

function aceSummary(ace: AceReadiness): string {
  const counts = aceCounts(ace.mapping);
  const parts = [`${counts.withValue} of ${counts.total} ACE fields have a value`];
  if (counts.missing) parts.push(`${counts.missing} expected value(s) missing`);
  if (counts.error) parts.push(`${counts.error} cannot be written`);
  parts.push(`${ace.preflight?.blocking.length ?? 0} blocking issue(s), ${ace.preflight?.warnings.length ?? 0} to review`);
  return `${parts.join('; ')}.`;
}

function linkTo(actions: DashboardActions, tab: 'ace' | 'inttra' | 'provenance', text: string): HTMLElement {
  const button = el('button', { className: 'button button-small', text, attrs: { type: 'button' } });
  button.addEventListener('click', () => actions.goTo(tab));
  return button;
}
