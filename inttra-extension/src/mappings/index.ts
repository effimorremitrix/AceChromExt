/** Mapping registry. The only place that knows which fields belong to which INTTRA screen. */

import type { InttraFieldMapping, InttraFieldScope, InttraPageId } from '../models/InttraField.js';
import { applyOverrides, type SelectorOverrides } from '../../../src/ace/selectors/overrides.js';
import { GENERAL_DETAILS_FIELDS } from './generalDetails.js';
import { CONTAINER_CARGO_FIELDS } from './containerCargo.js';
import { PRINT_INSTRUCTIONS_FIELDS } from './printInstructions.js';
import { BL_DOCUMENTS_FIELDS } from './blDocuments.js';
import { NOTIFICATION_EMAILS_FIELDS } from './notificationEmails.js';

export const INTTRA_MAPPINGS_BY_PAGE: Record<Exclude<InttraPageId, 'unknown'>, InttraFieldMapping[]> = {
  generalDetails: GENERAL_DETAILS_FIELDS,
  containerCargo: CONTAINER_CARGO_FIELDS,
  /** The grid is written by gridWriter.ts from GRID_COLUMNS, not field by field. */
  copyContainerDetails: [],
  printInstructions: PRINT_INSTRUCTIONS_FIELDS,
  blDocuments: BL_DOCUMENTS_FIELDS,
  notificationEmails: NOTIFICATION_EMAILS_FIELDS,
};

export const ALL_INTTRA_MAPPINGS: InttraFieldMapping[] = [
  ...GENERAL_DETAILS_FIELDS,
  ...CONTAINER_CARGO_FIELDS,
  ...PRINT_INSTRUCTIONS_FIELDS,
  ...BL_DOCUMENTS_FIELDS,
  ...NOTIFICATION_EMAILS_FIELDS,
];

export function inttraFieldsForPage(page: InttraPageId, scope?: InttraFieldScope): InttraFieldMapping[] {
  if (page === 'unknown') return [];
  const fields = INTTRA_MAPPINGS_BY_PAGE[page] ?? [];
  return scope ? fields.filter((field) => field.scope === scope) : fields;
}

export function inttraFieldByKey(key: string): InttraFieldMapping | undefined {
  return ALL_INTTRA_MAPPINGS.find((field) => field.key === key);
}

/** The fields for a page with operator-captured selectors applied ahead of the placeholders. */
export function resolveInttraFields(page: InttraPageId, scope: InttraFieldScope | undefined, overrides: SelectorOverrides | null): InttraFieldMapping[] {
  return applyOverrides(inttraFieldsForPage(page, scope), overrides);
}

export function unverifiedInttraFieldKeys(): string[] {
  return ALL_INTTRA_MAPPINGS.filter((field) => field.verificationStatus === 'placeholder').map((field) => field.key);
}

export { GRID_COLUMNS, GRID_ROOT_CANDIDATES, GRID_DEVTOOLS_CHECKLIST } from './containerGrid.js';
export { NOTIFICATION_EMAILS_NOTE } from './notificationEmails.js';
