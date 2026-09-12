/** Mapping registry. The only place that knows which fields belong to which page. */

import type { AceFieldMapping, AceFieldScope, AcePageId } from '../../models/AceField.js';
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

/** Count of fields whose selectors have not been confirmed against live ACE. */
export function unverifiedFieldKeys(): string[] {
  return ALL_MAPPINGS.filter((field) => field.verificationStatus === 'placeholder').map((field) => field.key);
}
