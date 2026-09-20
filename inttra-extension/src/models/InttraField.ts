/**
 * Declarative description of an INTTRA form field.
 *
 * Same shape as the ACE mapping, on purpose: the selector candidates, the
 * detector that tries them, the override mechanism and the diagnostics all
 * work on the same candidate type, so the ACE Helper's proven field
 * detection is reused rather than rewritten. What differs is what a mapping
 * reads from (a FilingPackage rather than a CanonicalShipment) and what it
 * writes into (setInttraFieldValue rather than setAceFieldValue).
 *
 * EVERY selector in inttra-extension/src/mappings is a PLACEHOLDER. None was
 * captured from the live portal. The detector still tries them, and a field
 * that resolves through one is reported at reduced confidence; a field that
 * does not resolve is never written. Live selectors are pasted in through the
 * Diagnostics tab, exactly as for ACE, and only then marked verified.
 */

import type { AceSelectorCandidate, FieldDetection } from '../../../src/models/AceField.js';

export type InttraPageId =
  | 'generalDetails'
  | 'containerCargo'
  | 'copyContainerDetails'
  | 'printInstructions'
  | 'blDocuments'
  | 'notificationEmails'
  | 'unknown';

/** 'shipment' reads `header.<field>`; 'container' reads `container.<field>` of the selected container. */
export type InttraFieldScope = 'shipment' | 'container';

/**
 * What kind of control a field is.
 *
 * 'lookup' is the one that is not just a label: INTTRA's Port of Loading and
 * Port of Discharge boxes are type-aheads over its own location list, and a
 * value typed into one is DISCARDED the moment the box loses focus unless the
 * operator picked it from the suggestions. Both ports came back from the live
 * portal on 2026-09-20 as `INTTRA did not keep the value (the control now
 * reads "")`. A lookup field is therefore written without the blur that
 * throws the text away, and reported as "typed, now pick it" rather than as a
 * failure. The helper still presses nothing: choosing the suggestion is the
 * operator's click.
 */
export type InttraFieldType = 'text' | 'number' | 'date' | 'select' | 'code' | 'lookup';

export type InttraSelectorCandidate = AceSelectorCandidate;

export interface InttraFieldMapping {
  key: string;
  label: string;
  page: InttraPageId;
  scope: InttraFieldScope;
  /** Dotted path into the filing package: `header.bookingReference`, `container.carrierSeal`. */
  source: string;
  type: InttraFieldType;
  /**
   * The control kind the detector may narrow to when one query matches several
   * controls. Derived from `type` by `defineInttraField`, never declared.
   */
  controlKind?: 'select' | 'input' | 'textarea';
  /** Named transformers from src/ace/transformers (text, upper, date, ...). Presentation only. */
  transforms?: string[];
  maxLength?: number;
  expected?: boolean;
  candidates: InttraSelectorCandidate[];
  verificationStatus: 'verified' | 'placeholder';
  devtoolsHint?: string;
}

export type InttraFillStatus = 'filled' | 'transformed' | 'skipped' | 'warning' | 'error';

export interface InttraFillOutcome {
  key: string;
  label: string;
  status: InttraFillStatus;
  source?: string;
  /** Where the value came from, as the package says. */
  provenance?: string;
  selector?: string;
  written?: string;
  readBack?: string;
  /** What the transformers did on the way in, e.g. "Separators removed". */
  transform?: string | null;
  message?: string;
  matchedWith?: string | null;
  confidence?: FieldDetection['confidence'];
  /**
   * When several controls matched: what each of them is. Shown under the
   * outcome so the operator can copy the right id into Diagnostics -> selector
   * overrides instead of being told only that there were two.
   */
  matches?: string[];
}

export interface InttraFillReport {
  page: InttraPageId;
  scope: InttraFieldScope;
  containerIndex?: number;
  filled: number;
  skipped: number;
  warnings: number;
  errors: number;
  outcomes: InttraFillOutcome[];
  startedAt: string;
}

export function emptyInttraFillReport(page: InttraPageId, scope: InttraFieldScope, containerIndex?: number): InttraFillReport {
  return {
    page,
    scope,
    ...(containerIndex === undefined ? {} : { containerIndex }),
    filled: 0,
    skipped: 0,
    warnings: 0,
    errors: 0,
    outcomes: [],
    startedAt: new Date().toISOString(),
  };
}

export function tallyInttraReport(report: InttraFillReport): InttraFillReport {
  report.filled = report.outcomes.filter((o) => o.status === 'filled' || o.status === 'transformed').length;
  report.skipped = report.outcomes.filter((o) => o.status === 'skipped').length;
  report.warnings = report.outcomes.filter((o) => o.status === 'warning').length;
  report.errors = report.outcomes.filter((o) => o.status === 'error').length;
  return report;
}
