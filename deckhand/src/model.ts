/**
 * DeckhandShipment: what an email or a shipping document said about a shipment.
 *
 * This model knows nothing about ACE, INTTRA, QuickBooks or a browser. It is
 * the output of extraction and the input to review, and it is built on four
 * rules that are worth more than any parser:
 *
 *   1. A seal reaches a container only through evidence that the source showed
 *      them together. There is no code path anywhere that pairs the nth
 *      container with the nth seal. A seal on the wrong container is worse
 *      than a missing seal.
 *   2. Missing is a value. A field the source did not carry is `value: null`
 *      and is still rendered, never silently dropped.
 *   3. Confidence is per field. There is no overall score.
 *   4. Nothing is corrected. A container number that fails its ISO 6346 check
 *      digit is carried verbatim and flagged; the person retypes it from the
 *      source.
 */

import type { ContainerStatus } from './iso6346.js';

export const DECKHAND_SCHEMA_VERSION = '1.0' as const;

/**
 * Per field, never one overall score.
 *
 *   high    read directly behind an unambiguous label, or from a table cell
 *           under a recognised heading
 *   low     recognised by shape or position only, or read from a line that
 *           carried more than one candidate
 *   unsure  not found, or the reader could not commit to a value
 *
 * A rules-based extractor cannot honestly say "0.96", so the scale is coarse
 * on purpose. A model-based extractor plugged in later maps onto the same
 * three words.
 */
export type Confidence = 'high' | 'low' | 'unsure';

/** A value the extractor was asked for. `null` means it was not found, and it is still rendered. */
export interface DeckhandField {
  value: string | null;
  confidence: Confidence;
  /** Where it was read from, so a person can find it again: the label, or the line number. */
  evidence?: string;
}

export function missingField(): DeckhandField {
  return { value: null, confidence: 'unsure' };
}

export interface ContainerNumberField {
  /** Exactly as it appeared in the source. */
  raw: string;
  /** Canonical form, or null when the text is not the ISO 6346 shape. */
  normalized: string | null;
  status: ContainerStatus;
  confidence: Confidence;
}

/** Seal numbers follow no standard and carry no check digit, so there is no status here. */
export interface SealField {
  raw: string;
  confidence: Confidence;
  /** The label the seal was read behind, e.g. "Seal No" or "Shipper Seal". */
  label?: string;
}

/**
 * Why this container and this seal are believed to belong together. A pairing
 * cannot be constructed without stating its evidence, which is what stops
 * "they were both in the email, in order" from ever becoming a pairing. There
 * is deliberately no value meaning "same position in two lists".
 */
export type PairEvidence =
  /** One row of a table. */
  | 'same_row'
  /** One line of text. */
  | 'same_line'
  /** One labelled block: "Container 1: ..." followed directly by "Seal: ...". */
  | 'same_block';

export interface DeckhandContainer {
  containerNumber: ContainerNumberField;
  /** The seal the carrier applies. Null when the source showed no seal beside this container. */
  carrierSeal: SealField | null;
  /** A second seal the shipper applied, when the source labelled one as such. */
  shipperSeal: SealField | null;
  /**
   * How the seals were tied to this container. Null when the container was
   * seen with no seal beside it at all, which is a fact worth stating rather
   * than a gap to fill.
   */
  evidence: PairEvidence | null;
  /** How many times the source mentioned this container. More than one means mentions were merged. */
  mentions: number;
  /**
   * The source claimed two different seals for this container. Neither is
   * used, the seal field is null, and the review screen says so: a blank cell
   * is recoverable in thirty seconds and the wrong seal is not recoverable.
   */
  sealConflict: boolean;
  /** 1-based line numbers in the source where this container was seen. */
  lines: number[];
}

export type UncertaintyCode =
  | 'missing-field'
  | 'low-confidence'
  | 'ambiguous-field'
  | 'no-containers'
  | 'unassigned-seals'
  | 'unpaired-container'
  | 'seal-missing'
  | 'seal-conflict'
  | 'check-digit'
  | 'malformed-container'
  | 'reader';

export interface Uncertainty {
  code: UncertaintyCode;
  /** 'error' means the value must not be filed as it stands; 'warning' means look at it. */
  severity: 'warning' | 'error';
  message: string;
  /** The field or container the uncertainty is about, when it is about one. */
  field?: string;
  container?: string;
}

export interface DeckhandSource {
  kind: 'text' | 'file';
  /** File name or a caption for pasted text. */
  name: string;
  /** Which extractor produced this. */
  extractor: string;
  extractedAt: string;
  /** Characters of text the extractor read. */
  textLength: number;
}

export interface DeckhandShipment {
  schemaVersion: typeof DECKHAND_SCHEMA_VERSION;
  bookingReference: DeckhandField;
  shipmentReference: DeckhandField;
  vessel: DeckhandField;
  voyage: DeckhandField;
  portOfLoading: DeckhandField;
  portOfDischarge: DeckhandField;
  /** One entry per distinct container, in the order the source first mentioned each. */
  containers: DeckhandContainer[];
  /**
   * Seals the source did not show beside any container. They are listed so
   * nothing is silently dropped, and they are never zipped onto the containers.
   */
  unassignedSeals: SealField[];
  /** Everything the reader must know before trusting the fields above. */
  uncertainties: Uncertainty[];
  source: DeckhandSource;
}

export const DECKHAND_HEADER_FIELDS = [
  'bookingReference',
  'shipmentReference',
  'vessel',
  'voyage',
  'portOfLoading',
  'portOfDischarge',
] as const;

export type DeckhandHeaderField = (typeof DECKHAND_HEADER_FIELDS)[number];

export const DECKHAND_FIELD_LABELS: Record<DeckhandHeaderField, string> = {
  bookingReference: 'Booking reference',
  shipmentReference: 'Shipment reference',
  vessel: 'Vessel',
  voyage: 'Voyage',
  portOfLoading: 'Port of loading',
  portOfDischarge: 'Port of discharge',
};

export function emptyDeckhandShipment(source: Partial<DeckhandSource> = {}): DeckhandShipment {
  return {
    schemaVersion: DECKHAND_SCHEMA_VERSION,
    bookingReference: missingField(),
    shipmentReference: missingField(),
    vessel: missingField(),
    voyage: missingField(),
    portOfLoading: missingField(),
    portOfDischarge: missingField(),
    containers: [],
    unassignedSeals: [],
    uncertainties: [],
    source: {
      kind: 'text',
      name: 'pasted text',
      extractor: 'none',
      extractedAt: new Date(0).toISOString(),
      textLength: 0,
      ...source,
    },
  };
}

/** The container number to show and file: the canonical form where there is one, otherwise exactly what was read. */
export function containerDisplay(container: DeckhandContainer): string {
  return container.containerNumber.normalized ?? container.containerNumber.raw;
}
