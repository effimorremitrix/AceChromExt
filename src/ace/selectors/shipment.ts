/**
 * Step 1: Shipment - ACE selectors.
 *
 * SELECTOR STATUS: label wording captured from the live AESDirect screen on
 * 2026-09-14 (`capturedLabel`). The id/name candidates above each label are
 * still guesses: one DevTools capture per field turns them into
 * `verified(...)` and lifts the match from medium to high confidence. See
 * docs/ACE-MAPPING.md for the procedure, and `overrides.ts` for installing a
 * captured selector without a rebuild.
 *
 * The live Shipment step has no PO Number and no INCO Terms control, so those
 * two template columns are not filed from this step (they stay in the
 * spreadsheet as reference data).
 */

import { byFrameworkName, byIdSuffix, byLabel, byNearby, capturedLabel, placeholder, type SelectorTable } from './types.js';

export const SHIPMENT_SELECTORS: SelectorTable = {
  ShipmentReferenceNumber: {
    candidates: [
      placeholder('id', '#shipmentReferenceNumber'),
      placeholder('name', "input[name='shipmentReferenceNumber']"),
      byFrameworkName('shipmentReferenceNumber'),
      byIdSuffix('shipmentReferenceNumber'),
      capturedLabel(['Shipment Reference Number']),
      byLabel(['Shipment Ref Number', 'Shipment Reference No', 'Shipment Reference', 'Filer Reference Number']),
      byNearby("[data-section='shipment']", "input[name*='reference' i]"),
    ],
    devtoolsHint:
      'Shipment tab -> right-click the Shipment Reference Number box -> Inspect -> copy the full <input> tag (id, name, formcontrolname, data-* attributes).',
  },

  InvoiceDate: {
    candidates: [
      placeholder('id', '#departureDate'),
      placeholder('name', "input[name='departureDate']"),
      byFrameworkName('departureDate'),
      byIdSuffix('departureDate'),
      capturedLabel(['Departure Date']),
      byLabel(['Date of Export', 'Estimated Date of Export', 'Export Date', 'Estimated Export Date']),
    ],
    devtoolsHint:
      'Shipment tab -> inspect the Departure Date box. It shows an MM/DD/YYYY placeholder and a calendar button; confirm that a typed MM/DD/YYYY is kept after the box loses focus.',
  },

  Destination: {
    candidates: [
      placeholder('id', '#countryOfDestination'),
      placeholder('name', "select[name='countryOfDestination']"),
      byFrameworkName('countryOfDestination'),
      byIdSuffix('countryOfDestination'),
      capturedLabel(['Country of Destination']),
      byLabel(['Country of Ultimate Destination', 'Ultimate Destination', 'Destination Country']),
    ],
    devtoolsHint:
      'Shipment tab -> inspect the Country of Destination control. It renders "TR - TURKIYE"; capture the underlying <select> (it may be hidden behind a combobox widget) AND two <option> tags so the writer knows whether option values are ISO codes.',
  },
};
