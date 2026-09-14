/**
 * Step 2: Parties - ACE selectors.
 *
 * SELECTOR STATUS: label wording captured from the live AESDirect Ultimate
 * Consignee panel on 2026-09-14; DOM ids not yet captured. See
 * docs/ACE-MAPPING.md.
 *
 * The Parties step repeats the same labels ("Company Name", "Address Line 1",
 * "City", ...) for the USPPI and for each consignee, so every label here is
 * scoped to the panel headed "Ultimate Consignee" - the fallback wordings
 * included. An unscoped fallback would be unsafe: when the consignee's State
 * box is greyed out (TR has no states) it would settle on the USPPI's. Without
 * the heading on the page nothing matches and the field is reported NOT_FOUND
 * rather than guessed.
 *
 * Party EIN/ID numbers, consignee type and "Sold En Route" have no selector
 * here on purpose: they are identity and filing decisions the filer must
 * enter, so there is nothing for the extension to resolve.
 */

import { byFrameworkName, byIdSuffix, byLabel, byNearby, capturedLabel, placeholder, type SelectorTable } from './types.js';

const PANEL = ['Ultimate Consignee'];
const CONTAINER = "[data-section='ultimateConsignee']";

export const PARTIES_SELECTORS: SelectorTable = {
  UltimateConsigneeName: {
    candidates: [
      placeholder('id', '#ultimateConsigneeName'),
      placeholder('name', "input[name='ultimateConsigneeName']"),
      byFrameworkName('ultimateConsigneeName'),
      byIdSuffix('ultimateConsigneeName'),
      capturedLabel(['Company Name'], undefined, { section: PANEL }),
      byLabel(['Ultimate Consignee Name', 'Consignee Name', 'Company Name'], undefined, { section: PANEL }),
      byNearby(CONTAINER),
    ],
    devtoolsHint:
      'Parties tab -> Ultimate Consignee panel -> inspect the Company Name box. Capture the panel container element too, so the nearby fallback can be scoped correctly.',
  },

  UltimateConsigneeAddress: {
    candidates: [
      placeholder('id', '#ultimateConsigneeAddress1'),
      placeholder('name', "input[name='ultimateConsigneeAddress1']"),
      byFrameworkName('ultimateConsigneeAddress1'),
      byIdSuffix('ultimateConsigneeAddress1'),
      capturedLabel(['Address Line 1'], undefined, { section: PANEL }),
      byLabel(['Address Line 1', 'Address 1', 'Street Address'], undefined, { section: PANEL }),
      byNearby(CONTAINER, "input[name*='address1' i]"),
    ],
    devtoolsHint: 'Parties tab -> Ultimate Consignee panel -> inspect Address Line 1.',
  },

  UltimateConsigneeAddress2: {
    candidates: [
      placeholder('id', '#ultimateConsigneeAddress2'),
      placeholder('name', "input[name='ultimateConsigneeAddress2']"),
      byFrameworkName('ultimateConsigneeAddress2'),
      byIdSuffix('ultimateConsigneeAddress2'),
      capturedLabel(['Address Line 2'], undefined, { section: PANEL }),
      byLabel(['Address Line 2', 'Address 2'], undefined, { section: PANEL }),
    ],
    devtoolsHint: 'Parties tab -> Ultimate Consignee panel -> inspect Address Line 2.',
  },

  UltimateConsigneeCity: {
    candidates: [
      placeholder('id', '#ultimateConsigneeCity'),
      placeholder('name', "input[name='ultimateConsigneeCity']"),
      byFrameworkName('ultimateConsigneeCity'),
      byIdSuffix('ultimateConsigneeCity'),
      capturedLabel(['City'], undefined, { section: PANEL }),
      byLabel(['City'], undefined, { section: PANEL }),
    ],
    devtoolsHint: 'Parties tab -> Ultimate Consignee panel -> inspect the City box.',
  },

  UltimateConsigneeState: {
    candidates: [
      placeholder('id', '#ultimateConsigneeState'),
      placeholder('name', "select[name='ultimateConsigneeState']"),
      byFrameworkName('ultimateConsigneeState'),
      byIdSuffix('ultimateConsigneeState'),
      capturedLabel(['State'], undefined, { section: PANEL }),
      byLabel(['State', 'State / Province', 'Province'], undefined, { section: PANEL }),
    ],
    devtoolsHint:
      'Parties tab -> Ultimate Consignee panel -> inspect the State control. It is greyed out for countries without states (TR); capture it with a US or Canadian consignee selected, plus two <option> tags.',
  },

  UltimateConsigneePostalCode: {
    candidates: [
      placeholder('id', '#ultimateConsigneePostalCode'),
      placeholder('name', "input[name='ultimateConsigneePostalCode']"),
      byFrameworkName('ultimateConsigneePostalCode'),
      byIdSuffix('ultimateConsigneePostalCode'),
      capturedLabel(['Postal Code'], undefined, { section: PANEL }),
      byLabel(['Postal Code', 'Zip Code', 'ZIP'], undefined, { section: PANEL }),
    ],
    devtoolsHint:
      'Parties tab -> Ultimate Consignee panel -> inspect the Postal Code control. It is greyed out for TR; capture it with a consignee country that requires it.',
  },

  UltimateConsigneeCountry: {
    candidates: [
      placeholder('id', '#ultimateConsigneeCountry'),
      placeholder('name', "select[name='ultimateConsigneeCountry']"),
      byFrameworkName('ultimateConsigneeCountry'),
      byIdSuffix('ultimateConsigneeCountry'),
      capturedLabel(['Country'], undefined, { section: PANEL }),
      byLabel(['Country'], undefined, { section: PANEL }),
    ],
    devtoolsHint:
      'Parties tab -> Ultimate Consignee panel -> inspect the Country control ("TR - TURKIYE"). Capture the underlying <select> and two <option> tags: the writer needs to know whether values are ISO codes.',
  },
};
