/**
 * Helpers for writing field mappings.
 *
 * Every selector in this folder is a *candidate*. Candidates are tried in the
 * order they appear, and each carries `verified`:
 *
 *   verified: true   - the selector was copied out of the live ACE DOM and
 *                      checked in. Matching it gives high confidence.
 *   verified: false  - a placeholder. It is still tried (it costs nothing and
 *                      may well work), but a match is reported with reduced
 *                      confidence, and the diagnostics panel lists the field
 *                      as needing verification.
 *
 * Nothing is ever written to a field that no candidate matched.
 */

import type { AceFieldMapping, AceSelectorCandidate } from '../../models/AceField.js';

/** A verified id/name selector captured from live ACE. */
export function verified(strategy: 'id' | 'name' | 'attribute', selector: string, note?: string): AceSelectorCandidate {
  return { strategy, selector, verified: true, ...(note ? { note } : {}) };
}

/** A placeholder id/name/attribute selector that still needs confirming against live ACE. */
export function placeholder(
  strategy: 'id' | 'name' | 'attribute' | 'nearby' | 'placeholder',
  selector: string,
  note = 'Placeholder - confirm against the live ACE DOM.',
): AceSelectorCandidate {
  return { strategy, selector, verified: false, note };
}

/**
 * Match by the field's visible label text.
 *
 * This is the most durable strategy available before the real DOM is captured:
 * ACE can restructure its markup and keep the same label. The strings below
 * come from the AESDirect filing screens as they appear to the user and must
 * still be confirmed - hence verified: false.
 */
export function byLabel(labelText: string[], note = 'Label wording taken from the AESDirect UI; confirm exact text.'): AceSelectorCandidate {
  return { strategy: 'label', labelText, verified: false, note };
}

/** Match the first enabled control inside a named container. */
export function byNearby(containerSelector: string, within = 'input, select, textarea'): AceSelectorCandidate {
  return {
    strategy: 'nearby',
    selector: containerSelector,
    within,
    verified: false,
    note: 'Structural fallback - confirm the container against the live ACE DOM.',
  };
}

/** True when any candidate has been verified against live ACE. */
export function statusFor(candidates: AceSelectorCandidate[]): AceFieldMapping['verificationStatus'] {
  return candidates.some((candidate) => candidate.verified) ? 'verified' : 'placeholder';
}

/** Build a mapping, deriving verificationStatus from the candidates. */
export function defineField(
  field: Omit<AceFieldMapping, 'verificationStatus'> & { verificationStatus?: AceFieldMapping['verificationStatus'] },
): AceFieldMapping {
  return {
    ...field,
    verificationStatus: field.verificationStatus ?? statusFor(field.candidates),
  };
}
