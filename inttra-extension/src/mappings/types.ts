/**
 * Helpers for INTTRA field mappings.
 *
 * Same division as ACE: what to fill (canonical source, transform, length) is
 * declared beside where to find it (selector candidates), and every candidate
 * shipped here is a placeholder until it is captured from the live portal.
 * The candidate constructors are the ACE ones, reused: they build the same
 * candidate type the shared detector reads.
 */

import type { InttraFieldMapping, InttraSelectorCandidate } from '../models/InttraField.js';
import { byFrameworkName, byIdSuffix, byLabel, byNearby, capturedLabel, placeholder, statusFor, verified } from '../../../src/ace/selectors/types.js';

export { byFrameworkName, byIdSuffix, byLabel, byNearby, capturedLabel, placeholder, verified };

export type InttraFieldDefinition = Omit<InttraFieldMapping, 'verificationStatus'>;

/** Build a mapping. Its verification status is computed from the candidates, never declared. */
export function defineInttraField(definition: InttraFieldDefinition): InttraFieldMapping {
  if (!definition.candidates.length) throw new Error(`INTTRA field "${definition.key}" has no selector candidates.`);
  return { ...definition, verificationStatus: statusFor(definition.candidates) };
}

/** The standard placeholder ladder for a logical name: id, name, framework attribute, id suffix, then the labels. */
export function placeholderLadder(name: string, labels: string[], tag: 'input' | 'select' | 'textarea' = 'input'): InttraSelectorCandidate[] {
  return [
    placeholder('id', `#${name}`, 'Placeholder - confirm against the live INTTRA DOM.'),
    placeholder('name', `${tag}[name='${name}']`, 'Placeholder - confirm against the live INTTRA DOM.'),
    byFrameworkName(name),
    byIdSuffix(name),
    byLabel(labels, 'Label wording guessed from the observed INTTRA workflow; confirm the exact text.'),
  ];
}
