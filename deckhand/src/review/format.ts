/**
 * Text output of an extraction: the review block a person reads, and the
 * container rows a portal grid or a spreadsheet takes.
 *
 * The one rule that governs everything below: a seal reaches a row only
 * through the container it was extracted with. Unassigned seals appear in no
 * row; they are printed under the block instead.
 */

import type { DeckhandShipment } from '../model.js';
import { containerDisplay, DECKHAND_FIELD_LABELS } from '../model.js';
import { buildReview, markGlyph } from './reviewModel.js';

const WIDTH = 22;
const row = (label: string, value: string): string => `${label.padEnd(WIDTH)} : ${value}`;

/** The review block, in the shape the brief specifies. Every field is printed, missing included. */
export function formatBlock(shipment: DeckhandShipment, options: { ascii?: boolean } = {}): string {
  const ascii = options.ascii ?? false;
  const review = buildReview(shipment);
  const lines: string[] = [];

  for (const header of review.headerRows) {
    lines.push(row(header.label, `${header.value || '(missing)'}  ${markGlyph(header.mark, ascii)}`));
  }
  lines.push('');

  if (review.containers.length === 0) {
    lines.push(row('Containers', '(none recognised)'));
  } else {
    lines.push('Containers');
    const width = Math.max(...shipment.containers.map((container) => containerDisplay(container).length));
    for (const container of review.containers) {
      const seal = container.carrierSeal.value ? `carrier seal ${container.carrierSeal.value}` : `carrier seal (${container.carrierSeal.note})`;
      const shipper = container.shipperSeal.value ? `  shipper seal ${container.shipperSeal.value}` : '';
      const flag = container.number.mark === 'warn' ? `  <-- ${container.number.note.toUpperCase()}` : '';
      lines.push(`  ${String(container.index + 1).padStart(2)}. ${container.number.value.padEnd(width)}  ${markGlyph(container.number.mark, ascii)}  ${seal}  ${markGlyph(container.carrierSeal.mark, ascii)}${shipper}${flag}`);
    }
  }

  if (review.unassignedSeals.length) {
    lines.push('');
    lines.push('NOT PAIRED - the document did not show these seals beside a container:');
    for (const seal of review.unassignedSeals) lines.push(`  seal ${seal}`);
  }

  lines.push('');
  const unsure = review.uncertainties.map((item) => item.message);
  lines.push(row('Anything I am unsure of', unsure.length ? (unsure[0] as string) : 'nothing'));
  for (const line of unsure.slice(1)) lines.push(row('', line));

  return lines.join('\n');
}

/** Column headings for the container rows, in the order a container grid usually wants them. */
export const CONTAINER_ROW_COLUMNS = ['Container Number', 'Carrier Seal', 'Shipper Seal'] as const;

export interface ContainerRow {
  container: string;
  carrierSeal: string;
  shipperSeal: string;
}

/** One row per container, seals only where the document paired them. */
export function containerRows(shipment: DeckhandShipment): ContainerRow[] {
  return shipment.containers.map((container) => ({
    container: containerDisplay(container),
    carrierSeal: container.sealConflict ? '' : container.carrierSeal?.raw ?? '',
    shipperSeal: container.sealConflict ? '' : container.shipperSeal?.raw ?? '',
  }));
}

/** Portal grids and Excel both split a pasted block on CRLF. */
const CRLF = '\r\n';

/** Tab separated, no header row, no trailing newline: pasted straight into a grid that already has headings. */
export function formatTsv(shipment: DeckhandShipment): string {
  return containerRows(shipment)
    .map((item) => `${item.container}\t${item.carrierSeal}\t${item.shipperSeal}`)
    .join(CRLF);
}

/** The two columns of the INTTRA container template: the number, and the seal on it. */
export const CONTAINER_SEAL_COLUMNS = ['Container Number', 'Seal Number'] as const;

/**
 * Container and seal, and nothing else.
 *
 * The three-column rows above carry a shipper seal column because the grid has
 * one. Most carrier emails have a single SEAL# column, the template being
 * filled has two cells per row, and the third column is then an empty column
 * to delete by hand every time. So this is the same rows with the carrier seal
 * only.
 *
 * A shipper seal is NOT promoted into the gap when the carrier seal is
 * missing. They are different numbers on different bolts, and a row that is
 * blank is fixed in seconds where a row carrying the wrong seal is not fixed
 * at all. `shipperSealsOmitted` below is how the screen says so out loud.
 */
export function formatContainerSealTsv(shipment: DeckhandShipment): string {
  return containerRows(shipment)
    .map((item) => `${item.container}\t${item.carrierSeal}`)
    .join(CRLF);
}

/** One column, in the row order of the other: for a grid that will not take two at once. */
export function formatContainerColumn(shipment: DeckhandShipment): string {
  return containerRows(shipment)
    .map((item) => item.container)
    .join(CRLF);
}

/** The seal column, aligned row for row with formatContainerColumn. */
export function formatSealColumn(shipment: DeckhandShipment): string {
  return containerRows(shipment)
    .map((item) => item.carrierSeal)
    .join(CRLF);
}

/**
 * How many rows would lose a seal by taking the two-column shape: rows with a
 * shipper seal and no carrier seal. Zero for the ordinary email, which has one
 * seal column; above zero it has to be said before anything is pasted.
 */
export function shipperSealsOmitted(shipment: DeckhandShipment): number {
  return containerRows(shipment).filter((item) => item.carrierSeal === '' && item.shipperSeal !== '').length;
}

const csvCell = (value: string): string => (/["\n\r,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** The same columns with a header row, CRLF as RFC 4180 asks. */
export function formatCsv(shipment: DeckhandShipment): string {
  const lines = [
    CONTAINER_ROW_COLUMNS.map(csvCell).join(','),
    ...containerRows(shipment).map((item) => [item.container, item.carrierSeal, item.shipperSeal].map(csvCell).join(',')),
  ];
  return `${lines.join(CRLF)}${CRLF}`;
}

/**
 * A file name that is recognisable a day later. The reference comes out of an
 * email, so it is untrusted text: everything but letters, digits, dash and
 * underscore becomes a dash, which leaves nothing to build a path out of.
 */
export function safeFileStem(reference: string | null, fallback: string): string {
  const stem = (reference ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return stem === '' ? fallback : stem;
}

export function deckhandFileName(shipment: DeckhandShipment, extension: 'json' | 'csv'): string {
  const stem = safeFileStem(shipment.bookingReference.value ?? shipment.shipmentReference.value, 'shipment');
  return `deckhand-${stem}.${extension}`;
}

export function fieldLabel(field: keyof typeof DECKHAND_FIELD_LABELS): string {
  return DECKHAND_FIELD_LABELS[field];
}
