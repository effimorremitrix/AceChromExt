/**
 * Selector tables.
 *
 * Phase 3 splits a field mapping into four things that change at four
 * different rates, and puts each somewhere it can be edited on its own:
 *
 *   canonical field  src/models/CanonicalInvoice.ts   changes ~never
 *   transformation   src/ace/transformers/*           changes with ACE rules
 *   validation rule  src/excel/validator.ts           changes with ACE rules
 *   ACE selector     THIS FOLDER                      changes whenever CBP
 *                                                     redeploys the portal
 *
 * Selectors are the volatile one, which is why they now live apart from the
 * mappings that use them: fixing a broken field means editing one table of
 * strings, not touching mapping logic. And it can be done without editing code
 * at all - see `overrides.ts`, which lets a verified selector captured from
 * the live portal be pasted into the panel and take effect immediately.
 */

import type { AceFieldMapping, AceSelectorCandidate } from '../../models/AceField.js';

export interface SelectorEntry {
  candidates: AceSelectorCandidate[];
  /** Exactly what to capture from ACE DevTools to verify this field. */
  devtoolsHint: string;
}

/** Keyed by AceFieldMapping.key. */
export type SelectorTable = Record<string, SelectorEntry>;

/** A verified id/name/attribute selector captured from live ACE. */
export function verified(strategy: 'id' | 'name' | 'attribute', selector: string, note?: string): AceSelectorCandidate {
  return { strategy, selector, verified: true, ...(note ? { note } : {}) };
}

/** A placeholder selector that still needs confirming against live ACE. */
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
 * The most durable strategy available before the real DOM is captured: ACE can
 * restructure its markup and keep the same label. Wording comes from the
 * AESDirect filing screens as they appear to the user.
 */
export function byLabel(
  labelText: string[],
  note = 'Label wording taken from the AESDirect UI; confirm exact text.',
): AceSelectorCandidate {
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

/**
 * Framework-generated attribute names.
 *
 * Portals built on Angular, JSF or ASP.NET WebForms rarely leave a bare
 * `id="scheduleBNumber"` in the DOM; they emit `formcontrolname`,
 * `ng-reflect-name`, or a namespaced id such as
 * `filingForm:lineDetails:scheduleBNumber`. This candidate covers all of them
 * in one query without positional guessing, and the detector still refuses to
 * write when more than one control matches.
 */
export function byFrameworkName(name: string): AceSelectorCandidate {
  const selectors = [
    `[formcontrolname='${name}' i]`,
    `[ng-reflect-name='${name}' i]`,
    `[data-testid='${name}' i]`,
    `[data-field='${name}' i]`,
    `[data-cy='${name}' i]`,
  ];
  return {
    strategy: 'attribute',
    selector: selectors.join(', '),
    verified: false,
    note: 'Framework attribute fallback (Angular/JSF/test hooks).',
  };
}

/**
 * Match an id or name that *ends* with the logical name.
 *
 * This is what survives a portal that namespaces its controls. It is listed
 * after the exact selectors and before the label strategies: more specific
 * than a label, less certain than an exact id.
 */
export function byIdSuffix(name: string): AceSelectorCandidate {
  return {
    strategy: 'attribute',
    selector: `[id$='${name}' i], [name$='${name}' i]`,
    verified: false,
    note: 'Suffix fallback, for portals that namespace control ids.',
  };
}

/** True when any candidate has been verified against live ACE. */
export function statusFor(candidates: AceSelectorCandidate[]): AceFieldMapping['verificationStatus'] {
  return candidates.some((candidate) => candidate.verified) ? 'verified' : 'placeholder';
}
