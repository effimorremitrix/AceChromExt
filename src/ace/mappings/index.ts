/** Mapping registry. The only place that knows which fields belong to which page. */

import type { AceFieldMapping, AceFieldScope, AcePageId } from '../../models/AceField.js';
import { applyOverrides, type SelectorOverrides } from '../selectors/overrides.js';
import { SHIPMENT_FIELDS } from './shipment.js';
import { PARTIES_FIELDS } from './parties.js';
import { COMMODITY_FIELDS } from './commodities.js';
import { TRANSPORTATION_FIELDS } from './transportation.js';

export const MAPPINGS_BY_PAGE: Record<Exclude<AcePageId, 'unknown'>, AceFieldMapping[]> = {
  shipment: SHIPMENT_FIELDS,
  parties: PARTIES_FIELDS,
  commodities: COMMODITY_FIELDS,
  transportation: TRANSPORTATION_FIELDS,
};

export const ALL_MAPPINGS: AceFieldMapping[] = [
  ...SHIPMENT_FIELDS,
  ...PARTIES_FIELDS,
  ...COMMODITY_FIELDS,
  ...TRANSPORTATION_FIELDS,
];

export function fieldsForPage(page: AcePageId, scope?: AceFieldScope): AceFieldMapping[] {
  if (page === 'unknown') return [];
  const fields = MAPPINGS_BY_PAGE[page] ?? [];
  return scope ? fields.filter((field) => field.scope === scope) : fields;
}

export function fieldByKey(key: string): AceFieldMapping | undefined {
  return ALL_MAPPINGS.find((field) => field.key === key);
}

/**
 * The fields to use for a page, with any operator-captured selectors applied.
 *
 * This is what the content script calls. `fieldsForPage` stays the pure
 * built-in view, used by tests and by the "what ships in the box" reporting.
 */
export function resolveFields(
  page: AcePageId,
  scope: AceFieldScope | undefined,
  overrides: SelectorOverrides | null,
): AceFieldMapping[] {
  return applyOverrides(fieldsForPage(page, scope), overrides);
}

/** Count of fields whose selectors have not been confirmed against live ACE. */
export function unverifiedFieldKeys(): string[] {
  return ALL_MAPPINGS.filter((field) => field.verificationStatus === 'placeholder').map((field) => field.key);
}

/**
 * Fields that still have no id, name or attribute copied from the live DOM.
 *
 * `verificationStatus` goes to 'verified' as soon as a field carries a
 * `capturedLabel(...)`, because label wording read off the real screen is
 * genuinely better than a guess. It is not the same thing as knowing the
 * control's id, though, and once every field carried a captured label the
 * unverified list went empty and stopped telling anyone anything.
 *
 * This is the sharper question: which fields would still break if CBP changed
 * a label? Those are the ones left to capture in DevTools.
 */
export function fieldsWithoutCapturedSelector(): string[] {
  return ALL_MAPPINGS.filter(
    (field) =>
      !field.candidates.some(
        (candidate) =>
          candidate.verified === true &&
          (candidate.strategy === 'id' || candidate.strategy === 'name' || candidate.strategy === 'attribute'),
      ),
  ).map((field) => field.key);
}
