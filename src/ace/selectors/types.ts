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

/**
 * A label whose wording was read off the live AESDirect screen.
 *
 * This is the honest middle state between a guess and a DevTools capture: the
 * text is known to be what ACE shows, so the detector trusts it at label
 * confidence (medium) instead of degrading it, and the field counts as
 * verified. Ids, names and option values still need a DevTools capture to
 * reach high confidence.
 *
 * `section` scopes the match to the panel headed by that text, for steps that
 * repeat the same label for several parties.
 */
export function capturedLabel(
  labelText: string[],
  note = 'Label wording captured from the live AESDirect screen on 2026-09-14; DOM id not yet captured.',
  options: { section?: string[] } = {},
): AceSelectorCandidate {
  return {
    strategy: 'label',
    labelText,
    ...(options.section ? { section: options.section } : {}),
    verified: true,
    note,
  };
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
  options: { section?: string[] } = {},
): AceSelectorCandidate {
  return {
    strategy: 'label',
    labelText,
    ...(options.section ? { section: options.section } : {}),
    verified: false,
    note,
  };
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
 *
 * Note that live AESDirect does NOT end its ids with the logical name - it
 * ends them with `.stringField` (see `bindingPath`). This helper is kept for
 * the parties and transportation controls whose real ids are still uncaptured,
 * and for any future portal that namespaces the plain way.
 */
export function byIdSuffix(name: string): AceSelectorCandidate {
  return {
    strategy: 'attribute',
    selector: `[id$='${name}' i], [name$='${name}' i]`,
    verified: false,
    note: 'Suffix fallback, for portals that namespace control ids.',
  };
}

/**
 * The binding path AESDirect actually uses.
 *
 * Captured from the live DOM on 2026-09-16: every control we have seen is
 * named for its Spring command path, with a `.stringField` wrapper on the
 * scalar ones and a `[n]` index on the repeating ones:
 *
 *   commodityLines[0].quantity1.stringField
 *   commodityLines[0].goodsValue.stringField
 *   shipmentInfo.conveyanceName.stringField
 *
 * Two consequences the old `byIdSuffix` guesses got wrong:
 *
 *   1. The id ends in `.stringField`, so a suffix match on the logical name
 *      ("quantity1") matches nothing at all.
 *   2. `#commodityLines[0].quantity1.stringField` is not a valid CSS id
 *      selector - the brackets and dots would parse as attribute and class
 *      selectors. It has to be written as an attribute match.
 *
 * `bindingPath('commodityLines[0].quantity1')` produces the exact match for
 * the captured line; `bindingSuffix('quantity1')` produces the index-free form
 * that also resolves lines 2..n. A commodity-scoped field resolves inside the
 * open "Line N Details" panel, so the index-free form stays unambiguous.
 */
export function bindingPath(path: string, note = 'Captured from the live AESDirect DOM on 2026-09-16.'): AceSelectorCandidate {
  const full = `${path}.stringField`;
  return {
    strategy: 'attribute',
    selector: `[id='${full}'], [name='${full}']`,
    verified: true,
    note,
  };
}

/** The same binding path with the `commodityLines[n]` prefix left open. */
export function bindingSuffix(
  name: string,
  note = 'Line-index-free form of the id captured on 2026-09-16; resolves inside the open Line N Details panel.',
): AceSelectorCandidate {
  const tail = `.${name}.stringField`;
  return {
    strategy: 'attribute',
    selector: `[id$='${tail}'], [name$='${tail}']`,
    verified: true,
    note,
  };
}

/**
 * The selector a human would look for first when this field misbehaves.
 *
 * Used by the fill report and the mapping status screen, which must not
 * describe the same candidate two different ways.
 */
export function describeCandidate(candidates: AceSelectorCandidate[]): string {
  const first = candidates[0];
  if (!first) return '(no selector configured)';
  if (first.strategy === 'label') return describeLabelCandidate(first);
  if (first.strategy === 'placeholder') return `placeholder: ${first.placeholder ?? ''}`;
  return first.selector ?? '(no selector configured)';
}

/** `label: A | B @ section: Ultimate Consignee` - the same text everywhere a label candidate is shown. */
export function describeLabelCandidate(candidate: AceSelectorCandidate): string {
  const labels = `label: ${(candidate.labelText ?? []).join(' | ')}`;
  return candidate.section?.length ? `${labels} @ section: ${candidate.section.join(' | ')}` : labels;
}

/** True when any candidate has been verified against live ACE. */
export function statusFor(candidates: AceSelectorCandidate[]): AceFieldMapping['verificationStatus'] {
  return candidates.some((candidate) => candidate.verified) ? 'verified' : 'placeholder';
}
