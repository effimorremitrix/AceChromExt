/**
 * The Package tab: the filing package, with every value and where it came from.
 *
 * Shared by the ACE Helper panel and the INTTRA Helper panel. It shows the
 * header, the containers, the conflicts and the notes, lets the operator
 * resolve a conflict or type a value no source holds, and saves the package
 * as filing-package.json. The destination-specific action ("Apply to the ACE
 * fields", "Fill INTTRA") is handed in by the caller.
 */

import {
  approveDeckhand,
  describeProvenance,
  fillGate,
  filingPackageFileName,
  PACKAGE_CONTAINER_FIELDS,
  PACKAGE_CONTAINER_LABELS,
  PACKAGE_HEADER_FIELDS,
  PACKAGE_HEADER_LABELS,
  resolveConflict,
  serializeFilingPackage,
  setManualContainer,
  setManualHeader,
  type FilingPackage,
  type PackageContainerField,
  type PackageHeaderField,
  type Provenanced,
} from '../../shared/src/index.js';
import { el } from './dom.js';

export interface PackageTabContext {
  pkg: FilingPackage | null;
  /** Whether Build is possible right now, and if not, why. */
  buildable: { ok: boolean; reason: string };
  onBuild(): Promise<void>;
  onChange(pkg: FilingPackage): Promise<void>;
  onClear(): Promise<void>;
  setStatus(text: string, tone: 'info' | 'ok' | 'warn' | 'error'): void;
  copyToClipboard(text: string, what: string): void;
  downloadText(text: string, fileName: string): void;
  /** Destination-specific buttons, rendered beside Save. */
  actions?: HTMLElement[];
  destination: string;
}

function sourceTone(item: Provenanced): string {
  switch (item.source) {
    case 'missing':
      return 'red';
    case 'manual':
      return 'blue';
    case 'derived':
      return 'yellow';
    default:
      return item.confidence && item.confidence !== 'high' ? 'yellow' : 'green';
  }
}

function provenanceCell(item: Provenanced): HTMLElement {
  return el('div', { className: 'pkg-prov' }, [
    el('span', { className: `pill pill-${sourceTone(item)}`, text: describeProvenance(item) }),
    item.detail ? el('span', { className: 'small muted', text: item.detail }) : null,
    item.original !== undefined && item.original !== item.value ? el('span', { className: 'small muted', text: `original: ${item.original}` }) : null,
  ]);
}

function editableValue(
  item: Provenanced,
  onCommit: (value: string) => void,
): HTMLElement {
  if (item.source !== 'missing' && item.source !== 'manual') {
    return el('span', { className: 'mono pkg-value', text: item.value });
  }
  const input = el('input', { className: 'input pkg-input', attrs: { type: 'text', value: item.value, placeholder: item.source === 'missing' ? 'enter by hand' : '' } }) as HTMLInputElement;
  input.addEventListener('change', () => onCommit(input.value));
  return input;
}

function renderHeader(pkg: FilingPackage, ctx: PackageTabContext): HTMLElement {
  const table = el('div', { className: 'pkg-table' });
  for (const field of PACKAGE_HEADER_FIELDS) {
    const item = pkg.header[field];
    if (item.source === 'missing' && ['consigneeAddress2', 'consigneeState', 'paymentTerms', 'poNumber', 'freightTerms'].includes(field)) continue;
    table.append(
      el('div', { className: `pkg-row pkg-${sourceTone(item)}` }, [
        el('div', { className: 'pkg-label', text: PACKAGE_HEADER_LABELS[field] }),
        editableValue(item, (value) => {
          void ctx.onChange(setManualHeader(pkg, field as PackageHeaderField, value));
        }),
        provenanceCell(item),
      ]),
    );
  }
  return el('details', { className: 'card', attrs: { open: 'open' } }, [el('summary', {}, [el('strong', { text: 'Shipment header' })]), table]);
}

function renderContainers(pkg: FilingPackage, ctx: PackageTabContext): HTMLElement {
  const card = el('details', { className: 'card', attrs: { open: 'open' } }, [
    el('summary', {}, [el('strong', { text: `Containers (${pkg.containers.length})` })]),
  ]);
  if (!pkg.containers.length) {
    card.append(el('p', { className: 'small warn', text: 'No containers in this package. Extract them with Deckhand, or enter the container number in the workbook.' }));
    return card;
  }
  for (const container of pkg.containers) {
    const table = el('div', { className: 'pkg-table' });
    for (const field of PACKAGE_CONTAINER_FIELDS) {
      const item = container[field];
      table.append(
        el('div', { className: `pkg-row pkg-${sourceTone(item)}` }, [
          el('div', { className: 'pkg-label', text: PACKAGE_CONTAINER_LABELS[field] }),
          editableValue(item, (value) => {
            void ctx.onChange(setManualContainer(pkg, container.index, field as PackageContainerField, value));
          }),
          provenanceCell(item),
        ]),
      );
    }
    card.append(
      el('div', { className: `pkg-container${container.status === 'valid' ? '' : ' pkg-container-bad'}` }, [
        el('div', { className: 'pkg-container-head' }, [
          el('strong', { text: `${container.index + 1}. ${container.containerNumber.value || '(no number)'}` }),
          el('span', {
            className: `pill pill-${container.status === 'valid' ? 'green' : 'red'}`,
            text: container.status === 'valid' ? 'ISO 6346 valid' : container.status === 'invalid' ? 'check digit fails' : 'not a container number',
          }),
        ]),
        table,
      ]),
    );
  }
  return card;
}

function renderConflicts(pkg: FilingPackage, ctx: PackageTabContext): HTMLElement | null {
  if (!pkg.conflicts.length) return null;
  const card = el('div', { className: 'card pkg-conflicts' }, [el('strong', { text: `Conflicts (${pkg.conflicts.length})` })]);
  card.append(el('p', { className: 'small muted', text: 'The two sources disagree. Nothing was overwritten: pick which one is right, and the package will follow it.' }));
  for (const conflict of pkg.conflicts) {
    const commercial = el('button', {
      className: `button button-small${conflict.resolution === 'commercial' ? ' button-primary' : ''}`,
      text: `Use ${pkg.commercialSource?.label ?? 'commercial'}: ${conflict.commercialValue}`,
      attrs: { type: 'button' },
    });
    commercial.addEventListener('click', () => void ctx.onChange(resolveConflict(pkg, conflict.id, 'commercial')));
    const deckhand = el('button', {
      className: `button button-small${conflict.resolution === 'deckhand' ? ' button-primary' : ''}`,
      text: `Use document: ${conflict.deckhandValue}`,
      attrs: { type: 'button' },
    });
    deckhand.addEventListener('click', () => void ctx.onChange(resolveConflict(pkg, conflict.id, 'deckhand')));
    card.append(
      el('div', { className: `note note-${conflict.resolution === 'unresolved' && conflict.material ? 'error' : 'warning'} pkg-conflict` }, [
        el('div', { text: conflict.message }),
        el('div', { className: 'actions' }, [commercial, deckhand]),
      ]),
    );
  }
  return card;
}

function renderGate(pkg: FilingPackage, ctx: PackageTabContext): HTMLElement {
  const gate = fillGate(pkg);
  const lines = gate.ok ? [`Ready to fill ${ctx.destination}. Review every field there before you save or submit.`] : gate.reasons;
  return el('div', { className: `notice ${gate.ok ? '' : 'notice-warn'}` }, [
    el('strong', { text: gate.ok ? 'Ready. ' : 'Not ready to fill. ' }),
    el('span', { text: lines.join(' ') }),
  ]);
}

export function renderPackageTab(ctx: PackageTabContext): HTMLElement {
  const section = el('section', { className: 'panel-section' });
  section.append(
    el('h2', { text: 'Filing package' }),
    el('p', { className: 'small muted', text: `One shipment, every source: the invoice from QuickBooks or Excel, the booking, containers and seals from Deckhand, and anything you type. Every value says where it came from. Saved as filing-package.json, it can be loaded into the ACE Helper and the INTTRA Helper alike.` }),
  );

  const pkg = ctx.pkg;
  if (!pkg) {
    const build = el('button', { className: 'button button-primary', text: 'Build filing package', attrs: { type: 'button', ...(ctx.buildable.ok ? {} : { disabled: 'disabled' }) } });
    build.addEventListener('click', () => void ctx.onBuild());
    section.append(el('div', { className: 'actions' }, [build]));
    if (!ctx.buildable.ok) section.append(el('p', { className: 'small muted', text: ctx.buildable.reason }));
    return section;
  }

  section.append(
    el('div', { className: 'card' }, [
      el('div', { className: 'invoice-number', text: pkg.packageId }),
      el('div', { className: 'small muted', text: `Commercial data: ${pkg.commercialSource ? `${pkg.commercialSource.label} - ${pkg.commercialSource.detail}` : 'none'}` }),
      el('div', { className: 'small muted', text: `Deckhand: ${pkg.shipment ? `${pkg.shipment.source.name}, ${pkg.review.deckhand}` : 'none'}` }),
      el('div', { className: 'small muted', text: `Built ${new Date(pkg.createdAt).toLocaleString()}` }),
    ]),
  );

  section.append(renderGate(pkg, ctx));

  if (pkg.review.deckhand === 'pending') {
    const approve = el('button', { className: 'button button-primary', text: 'Approve the Deckhand extraction', attrs: { type: 'button' } });
    approve.addEventListener('click', () => {
      void (async () => {
        try {
          await ctx.onChange(approveDeckhand(pkg));
          ctx.setStatus('Deckhand extraction approved.', 'ok');
        } catch (error) {
          ctx.setStatus((error as Error).message, 'error');
        }
      })();
    });
    section.append(el('div', { className: 'actions' }, [approve]));
  }

  const conflicts = renderConflicts(pkg, ctx);
  if (conflicts) section.append(conflicts);

  if (pkg.notes.length) {
    section.append(
      el('details', { className: 'card', attrs: pkg.notes.some((note) => note.severity !== 'info') ? { open: 'open' } : {} }, [
        el('summary', { text: `Notes (${pkg.notes.length})` }),
        el('ul', { className: 'small note-list' }, pkg.notes.map((note) => el('li', { className: `note note-${note.severity}`, text: note.message }))),
      ]),
    );
  }

  section.append(renderHeader(pkg, ctx));
  section.append(renderContainers(pkg, ctx));

  if (pkg.cargo.length) {
    section.append(
      el('details', { className: 'card' }, [
        el('summary', { text: `Cargo lines (${pkg.cargo.length})` }),
        ...pkg.cargo.map((line) =>
          el('div', { className: 'pkg-table small' }, [
            el('div', { className: 'pkg-row' }, [el('div', { className: 'pkg-label', text: `Line ${line.line}` }), el('span', { className: 'mono', text: line.description.value }), provenanceCell(line.description)]),
            el('div', { className: 'pkg-row' }, [el('div', { className: 'pkg-label', text: 'Schedule B / HS' }), el('span', { className: 'mono', text: `${line.scheduleB.value} / ${line.hsCode.value || '-'}` }), provenanceCell(line.hsCode)]),
            el('div', { className: 'pkg-row' }, [el('div', { className: 'pkg-label', text: 'Weight (kg) / value' }), el('span', { className: 'mono', text: `${line.weightKg.value || '-'} / ${line.valueOfGoods.value || '-'}` }), provenanceCell(line.weightKg)]),
          ]),
        ),
      ]),
    );
  }

  const save = el('button', { className: 'button button-primary', text: 'Save filing-package.json', attrs: { type: 'button' } });
  save.addEventListener('click', () => ctx.downloadText(serializeFilingPackage(pkg), filingPackageFileName(pkg)));
  const copy = el('button', { className: 'button button-small', text: 'Copy JSON', attrs: { type: 'button' } });
  copy.addEventListener('click', () => ctx.copyToClipboard(serializeFilingPackage(pkg), 'Filing package'));
  const rebuild = el('button', { className: 'button button-small', text: 'Rebuild from sources', attrs: { type: 'button' } });
  rebuild.addEventListener('click', () => void ctx.onBuild());
  const clear = el('button', { className: 'button button-small button-danger', text: 'Discard package', attrs: { type: 'button' } });
  clear.addEventListener('click', () => void ctx.onClear());

  section.append(el('div', { className: 'actions' }, [save, ...(ctx.actions ?? []), copy, rebuild, clear]));
  section.append(el('p', { className: 'small muted', text: 'The file is written to this machine only. It holds the invoice, the extraction and your decisions; keep it with the shipment.' }));
  return section;
}
