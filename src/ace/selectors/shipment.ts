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
 *
 * Every dropdown on this step is a Select2 3.x combobox over a hidden
 * <select> (confirmed 2026-09-16). See `resolveSelect2` in
 * src/content/fieldDetector.ts for what that costs us.
 *
 * Still unmapped on this step, all of them carried by the filer's saved
 * template: Email Response Address, Filing Option, Mode of Transport, Inbond
 * Type, Original ITN and the three Yes/No radios. Port of Export and Port of
 * Unlading are NOT template-stable, because they change with the routing, and
 * are not mapped yet; see docs/ACE-MAPPING.md.
 */

import {
  byFrameworkName,
  byIdSuffix,
  byLabel,
  byNearby,
  capturedLabel,
  placeholder,
  verified,
  type SelectorTable,
} from './types.js';

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
      // Captured 2026-09-16:
      // <input name="estExportDate" id="estExportDate" maxlength="10" type="text"
      //        class="form-control" placeholder="MM/DD/YYYY">
      // Note the id is estExportDate while the on-screen label reads
      // "Departure Date". They are the same control; the guess #departureDate
      // that used to lead this list never existed.
      verified('id', '#estExportDate', 'Copied from the live AESDirect DOM on 2026-09-16.'),
      verified('name', "input[name='estExportDate']", 'Copied from the live AESDirect DOM on 2026-09-16.'),
      capturedLabel(['Departure Date']),
      byLabel(['Date of Export', 'Estimated Date of Export', 'Export Date', 'Estimated Export Date']),
    ],
    devtoolsHint:
      'Shipment tab -> inspect the Departure Date box (id estExportDate, maxlength 10, placeholder MM/DD/YYYY). Confirm a typed MM/DD/YYYY is kept after the box loses focus.',
  },

  OriginState: {
    candidates: [
      // No DOM id yet. The 2026-09-16 capture caught Select2's own furniture:
      //   <label for="s2id_autogen4_search" class="select2-offscreen">Origin State * </label>
      // `s2id_autogen4` is Select2's fallback for a source element with no id
      // of its own, and the number comes from a global counter, so neither it
      // nor `select2-chosen-N` can be used as a selector. The label wording is
      // solid (it is on the screen and on Select2's copied label), and the
      // detector maps a Select2 match back to the backing <select>.
      placeholder('id', '#originState'),
      placeholder('name', "select[name='originState']"),
      byFrameworkName('originState'),
      byIdSuffix('originState'),
      capturedLabel(['Origin State']),
      byLabel(['State of Origin', 'Origin State of Goods', 'US State of Origin']),
    ],
    devtoolsHint:
      'Shipment tab -> close every dropdown first, then inspect the Origin State box and walk UP to the <select class="select2-offscreen"> beside the widget; copy that tag plus two <option> tags. Inspecting while the list is open only catches select2-drop-mask.',
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
      'Shipment tab -> inspect the Country of Destination control. It renders "TR - TURKIYE" and is a Select2 3.x combobox (confirmed 2026-09-16); capture the backing <select class="select2-offscreen"> AND two <option> tags so the writer knows whether option values are ISO codes.',
  },
};
