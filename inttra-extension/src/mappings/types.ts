/**
 * Helpers for INTTRA field mappings.
 *
 * Same division as ACE: what to fill (canonical source, transform, length) is
 * declared beside where to find it (selector candidates), and every candidate
 * shipped here is a placeholder until it is captured from the live portal.
 * The candidate constructors are the ACE ones, reused: they build the same
 * candidate type the shared detector reads.
 */

import type { InttraFieldMapping, InttraFieldType, InttraSelectorCandidate } from '../models/InttraField.js';
import { byFrameworkName, byIdSuffix, byLabel, byNearby, capturedLabel, placeholder, statusFor, verified } from '../../../src/ace/selectors/types.js';

export { byFrameworkName, byIdSuffix, byLabel, byNearby, capturedLabel, placeholder, verified };

export type InttraFieldDefinition = Omit<InttraFieldMapping, 'verificationStatus' | 'controlKind'>;

/**
 * The control kind a field type implies, or nothing when the type does not
 * imply one.
 *
 * Only used to break a tie between several controls that matched the same
 * query (fieldDetector.ts). 'text' and 'code' imply nothing, because INTTRA
 * renders those as an <input> in one place and a <textarea> in another -
 * Cargo Description is a text area, HS Code is a box.
 */
export function controlKindFor(type: InttraFieldType): InttraFieldMapping['controlKind'] {
  if (type === 'select') return 'select';
  if (type === 'number' || type === 'date' || type === 'lookup') return 'input';
  return undefined;
}

/** Build a mapping. Its verification status is computed from the candidates, never declared. */
export function defineInttraField(definition: InttraFieldDefinition): InttraFieldMapping {
  if (!definition.candidates.length) throw new Error(`INTTRA field "${definition.key}" has no selector candidates.`);
  const controlKind = controlKindFor(definition.type);
  return { ...definition, ...(controlKind ? { controlKind } : {}), verificationStatus: statusFor(definition.candidates) };
}

/**
 * One label candidate per wording, most specific first.
 *
 * A single `byLabel(['Booking Number', 'Carrier Booking Number', ...])` asks
 * one question with four answers allowed, so a screen that carries TWO of the
 * wordings answers with two controls and the field is refused as ambiguous
 * with nothing to show for it. That is exactly what the live Create Shipping
 * Instruction page did to Booking Number on 2026-09-20.
 *
 * Splitting them asks four questions in order instead. "Carrier Booking
 * Number" - the wording actually on the screen - is asked first and resolves
 * to the one control that carries it; the looser wordings are only reached
 * when the specific one finds nothing. No match is chosen between: each rung
 * still refuses when ITS own wording matches several controls.
 */
export function labelLadder(labels: string[], note?: string, options: { captured?: boolean; section?: string[] } = {}): InttraSelectorCandidate[] {
  const build = options.captured ? capturedLabel : byLabel;
  return labels.map((label) => build([label], note, options.section ? { section: options.section } : {}));
}

/** The standard placeholder ladder for a logical name: id, name, framework attribute, id suffix, then the labels one at a time. */
export function placeholderLadder(name: string, labels: string[], tag: 'input' | 'select' | 'textarea' = 'input'): InttraSelectorCandidate[] {
  return [
    placeholder('id', `#${name}`, 'Placeholder - confirm against the live INTTRA DOM.'),
    placeholder('name', `${tag}[name='${name}']`, 'Placeholder - confirm against the live INTTRA DOM.'),
    byFrameworkName(name),
    byIdSuffix(name),
    ...labelLadder(labels, 'Label wording guessed from the observed INTTRA workflow; confirm the exact text.'),
  ];
}
