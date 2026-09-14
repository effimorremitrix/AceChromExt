/**
 * Where a filing value came from.
 *
 * A filing is a legal declaration, so "the accounting system said so", "the
 * carrier's email said so", "it was computed" and "somebody typed it" must
 * never look alike in a preview or an audit trail. Every value in a filing
 * package carries one of these.
 */

import type { Confidence } from '../../deckhand/src/model.js';

export type ValueSource =
  /** A QuickBooks export (the companion's workbook). */
  | 'quickbooks'
  /** A hand-filled spreadsheet. */
  | 'excel'
  /** Deckhand extraction from an email or document. */
  | 'deckhand'
  /** Typed by the operator, in the package screen or on the command line. */
  | 'manual'
  /** Computed from other values: a unit conversion, a total, a code prefix. */
  | 'derived'
  /** Nothing supplied it. The value is empty and the screen says so. */
  | 'missing';

export interface Provenanced {
  /** '' when missing. */
  value: string;
  source: ValueSource;
  /** Where exactly: a column, a label and line number, a custom-field name. */
  detail?: string;
  /** What it looked like before transformation, when different. */
  original?: string;
  /** Human-readable transformation, e.g. "lb x 0.45359237". */
  transform?: string | null;
  /** Deckhand's own confidence, when the source is Deckhand. */
  confidence?: Confidence;
  /** A second source carried the same value. */
  confirmedBy?: ValueSource;
}

export function missing(detail?: string): Provenanced {
  return { value: '', source: 'missing', ...(detail ? { detail } : {}) };
}

export function manual(value: string, detail = 'typed by the operator'): Provenanced {
  return { value, source: 'manual', detail };
}

export function derived(value: string, detail: string, original?: string): Provenanced {
  return { value, source: 'derived', detail, ...(original !== undefined ? { original } : {}) };
}

export const SOURCE_LABELS: Record<ValueSource, string> = {
  quickbooks: 'QuickBooks',
  excel: 'Excel',
  deckhand: 'Deckhand',
  manual: 'Manual',
  derived: 'Derived',
  missing: 'Missing',
};

/** "QuickBooks (lb x 0.45359237)" / "Deckhand, confirmed by QuickBooks" - one line for a screen or a report. */
export function describeProvenance(item: Provenanced): string {
  const parts: string[] = [SOURCE_LABELS[item.source]];
  if (item.confirmedBy) parts.push(`confirmed by ${SOURCE_LABELS[item.confirmedBy]}`);
  if (item.transform) parts.push(item.transform);
  if (item.confidence && item.confidence !== 'high') parts.push(`confidence ${item.confidence}`);
  return parts.join(', ');
}
