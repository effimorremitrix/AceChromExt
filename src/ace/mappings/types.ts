/**
 * Helpers for writing field mappings.
 *
 * Since Phase 3 a mapping declares only the four things that are about the
 * *filing*: which canonical field feeds it, how the value is transformed for
 * ACE, how long ACE lets it be, and whether it is expected to be present.
 *
 * The ACE selectors live in `src/ace/selectors/`, because they change on
 * CBP's schedule rather than ours, and are looked up here by field key. A
 * mapping with no selector entry is a build error rather than a field that
 * silently never fills.
 */

import type { AceFieldMapping } from '../../models/AceField.js';
import { statusFor, type SelectorTable } from '../selectors/types.js';

export { byLabel, byNearby, placeholder, statusFor, verified } from '../selectors/types.js';
export type { SelectorEntry, SelectorTable } from '../selectors/types.js';

export type FieldDefinition = Omit<AceFieldMapping, 'candidates' | 'verificationStatus' | 'devtoolsHint'> & {
  /** The page's selector table. Candidates are looked up by `key`. */
  selectors: SelectorTable;
};

/** Build a mapping, pulling its selectors from the page's selector table. */
export function defineField(definition: FieldDefinition): AceFieldMapping {
  const { selectors, ...field } = definition;
  const entry = selectors[field.key];
  if (!entry) {
    throw new Error(
      `No selector entry for "${field.key}". Add one to src/ace/selectors/${field.page}.ts before mapping the field.`,
    );
  }
  return {
    ...field,
    candidates: entry.candidates,
    devtoolsHint: entry.devtoolsHint,
    verificationStatus: statusFor(entry.candidates),
  };
}
