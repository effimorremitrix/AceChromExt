/**
 * The review screen, as data.
 *
 * Nothing extracted goes into a filing package, and from there into a form,
 * until a person has looked at it and pressed Approve. This module builds
 * what that person looks at: one row per field and per container, each with
 * a mark, so the screen in either extension and the text the companion prints
 * are the same rows and can never drift apart.
 *
 *   ✓   read with confidence and, for a container number, valid
 *   ?   read, but not with confidence; confirm it against the source
 *   ⚠   missing, failed a check, or could not be paired
 *
 * Approval is gated only by the errors that would file something wrong: a
 * failed check digit, a seal the document contradicts, or a container the
 * document did not pair. Missing values do not block approval, because a
 * missing value is filled by hand, whereas a wrong one is filed.
 */

import type { DeckhandContainer, DeckhandField, DeckhandShipment, Uncertainty } from '../model.js';
import { containerDisplay, DECKHAND_FIELD_LABELS, DECKHAND_HEADER_FIELDS } from '../model.js';

export type ReviewMark = 'ok' | 'check' | 'warn';

export interface ReviewRow {
  /** Dotted path into the shipment, e.g. "vessel" or "containers.0.carrierSeal". */
  path: string;
  label: string;
  /** What will be filed, or '' when missing. */
  value: string;
  mark: ReviewMark;
  /** Why the mark is what it is, in one short phrase. */
  note: string;
  /** Where in the source it was read, when known. */
  evidence?: string;
}

export interface ContainerReview {
  index: number;
  number: ReviewRow;
  carrierSeal: ReviewRow;
  shipperSeal: ReviewRow;
  mark: ReviewMark;
}

export interface ShipmentReview {
  headerRows: ReviewRow[];
  containers: ContainerReview[];
  unassignedSeals: string[];
  uncertainties: Uncertainty[];
  /** Uncertainties with severity 'error': the ones that block approval. */
  blocking: Uncertainty[];
  canApprove: boolean;
  summary: string;
}

function markOf(field: DeckhandField): ReviewMark {
  if (field.value === null) return 'warn';
  return field.confidence === 'high' ? 'ok' : 'check';
}

function headerRow(path: string, label: string, field: DeckhandField): ReviewRow {
  const mark = markOf(field);
  return {
    path,
    label,
    value: field.value ?? '',
    mark,
    note: mark === 'ok' ? 'read from the document' : mark === 'check' ? 'read, but not certain' : 'missing',
    ...(field.evidence ? { evidence: field.evidence } : {}),
  };
}

function sealRow(container: DeckhandContainer, index: number, kind: 'carrierSeal' | 'shipperSeal'): ReviewRow {
  const path = `containers.${index}.${kind}`;
  const label = kind === 'carrierSeal' ? 'Carrier seal' : 'Shipper seal';
  if (container.sealConflict) {
    return { path, label, value: '', mark: 'warn', note: 'two different seals given; fill from the source' };
  }
  const seal = container[kind];
  if (!seal) {
    if (kind === 'shipperSeal') return { path, label, value: '', mark: 'ok', note: 'none in the document' };
    if (container.evidence === null) return { path, label, value: '', mark: 'warn', note: 'not paired: the document did not show a seal beside this container' };
    return { path, label, value: '', mark: 'warn', note: 'missing' };
  }
  return {
    path,
    label,
    value: seal.raw,
    mark: seal.confidence === 'high' ? 'ok' : 'check',
    note: seal.confidence === 'high' ? `read beside the container (${container.evidence ?? 'same line'})` : 'read, but not certain',
    ...(seal.label ? { evidence: `labelled "${seal.label}"` } : {}),
  };
}

function containerRow(container: DeckhandContainer, index: number): ReviewRow {
  const path = `containers.${index}.containerNumber`;
  const value = containerDisplay(container);
  const { status, confidence } = container.containerNumber;
  if (status === 'invalid') return { path, label: 'Container', value, mark: 'warn', note: 'ISO 6346 check digit fails; retype from the source' };
  if (status === 'malformed') return { path, label: 'Container', value, mark: 'warn', note: 'not a container number format' };
  const mark: ReviewMark = confidence === 'high' ? 'ok' : 'check';
  const mentions = container.mentions > 1 ? `, mentioned ${container.mentions} times` : '';
  return {
    path,
    label: 'Container',
    value,
    mark,
    note: `${mark === 'ok' ? 'valid ISO 6346' : 'valid number, but read from a list'}${mentions}`,
    evidence: `line ${container.lines.join(', ')}`,
  };
}

function worst(marks: ReviewMark[]): ReviewMark {
  if (marks.includes('warn')) return 'warn';
  if (marks.includes('check')) return 'check';
  return 'ok';
}

export function buildReview(shipment: DeckhandShipment): ShipmentReview {
  const headerRows = DECKHAND_HEADER_FIELDS.map((field) => headerRow(field, DECKHAND_FIELD_LABELS[field], shipment[field]));

  const containers = shipment.containers.map((container, index) => {
    const number = containerRow(container, index);
    const carrierSeal = sealRow(container, index, 'carrierSeal');
    const shipperSeal = sealRow(container, index, 'shipperSeal');
    return { index, number, carrierSeal, shipperSeal, mark: worst([number.mark, carrierSeal.mark, shipperSeal.mark]) };
  });

  const blocking = shipment.uncertainties.filter((item) => item.severity === 'error');
  const okCount = [...headerRows, ...containers.flatMap((item) => [item.number, item.carrierSeal])].filter((row) => row.mark === 'ok').length;
  const warnCount = [...headerRows, ...containers.flatMap((item) => [item.number, item.carrierSeal])].filter((row) => row.mark === 'warn').length;

  const parts = [
    `${shipment.containers.length} container${shipment.containers.length === 1 ? '' : 's'}`,
    `${okCount} value${okCount === 1 ? '' : 's'} read with confidence`,
    ...(warnCount ? [`${warnCount} to fill or check by hand`] : []),
    ...(shipment.unassignedSeals.length ? [`${shipment.unassignedSeals.length} seal(s) not paired`] : []),
    ...(blocking.length ? [`${blocking.length} problem(s) that must be fixed before approval`] : []),
  ];

  return {
    headerRows,
    containers,
    unassignedSeals: shipment.unassignedSeals.map((seal) => seal.raw),
    uncertainties: shipment.uncertainties,
    blocking,
    canApprove: blocking.length === 0 && shipment.containers.length > 0,
    summary: parts.join(', '),
  };
}

export interface ApprovedShipment {
  shipment: DeckhandShipment;
  approvedAt: string;
}

/**
 * The one way a DeckhandShipment becomes eligible for a filing package.
 * Throws when the review has blocking problems, so a caller cannot approve
 * past a failed check digit by accident.
 */
export function approveShipment(shipment: DeckhandShipment, now: Date = new Date()): ApprovedShipment {
  const review = buildReview(shipment);
  if (!review.canApprove) {
    const reasons = review.blocking.map((item) => item.message);
    if (shipment.containers.length === 0) reasons.push('No containers were extracted; there is nothing to approve.');
    throw new Error(`Cannot approve this extraction: ${reasons.join(' ')}`);
  }
  return { shipment, approvedAt: now.toISOString() };
}

/** The mark as one character, for text output. */
export function markGlyph(mark: ReviewMark, ascii = false): string {
  if (ascii) return mark === 'ok' ? 'v' : mark === 'check' ? '?' : '!';
  return mark === 'ok' ? '✓' : mark === 'check' ? '?' : '⚠';
}
