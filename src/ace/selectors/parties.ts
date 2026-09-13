/**
 * Step 2: Parties - ACE selectors.
 *
 * SELECTOR STATUS: placeholders only. See docs/ACE-MAPPING.md.
 *
 * Party EIN/ID numbers have no selector here on purpose: they are identity
 * data the filer must enter and verify, so there is nothing for the extension
 * to resolve.
 */

import { byFrameworkName, byIdSuffix, byLabel, byNearby, placeholder, type SelectorTable } from './types.js';

export const PARTIES_SELECTORS: SelectorTable = {
  UltimateConsigneeName: {
    candidates: [
      placeholder('id', '#ultimateConsigneeName'),
      placeholder('name', "input[name='ultimateConsigneeName']"),
      byFrameworkName('ultimateConsigneeName'),
      byIdSuffix('ultimateConsigneeName'),
      byLabel(['Ultimate Consignee Name', 'Consignee Name', 'Company Name']),
      byNearby("[data-section='ultimateConsignee']"),
    ],
    devtoolsHint:
      'Parties tab -> Ultimate Consignee panel -> inspect the Name box. Capture the panel container element too, so the nearby fallback can be scoped correctly.',
  },

  UltimateConsigneeAddress: {
    candidates: [
      placeholder('id', '#ultimateConsigneeAddress1'),
      placeholder('name', "input[name='ultimateConsigneeAddress1']"),
      byFrameworkName('ultimateConsigneeAddress1'),
      byIdSuffix('ultimateConsigneeAddress1'),
      byLabel(['Address Line 1', 'Address 1', 'Street Address']),
      byNearby("[data-section='ultimateConsignee']", "input[name*='address' i]"),
    ],
    devtoolsHint:
      'Parties tab -> inspect Address Line 1. ACE splits the address into several boxes; note how many lines exist and whether city/state/postal are separate controls.',
  },
};
