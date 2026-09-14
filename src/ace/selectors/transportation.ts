/**
 * Step 4: Transportation - ACE selectors.
 *
 * SELECTOR STATUS: placeholders only. The Transportation step has not been
 * captured from the live portal yet (Steps 1-3 were, on 2026-09-14). See
 * docs/ACE-MAPPING.md.
 */

import { byFrameworkName, byIdSuffix, byLabel, byNearby, placeholder, type SelectorTable } from './types.js';

export const TRANSPORTATION_SELECTORS: SelectorTable = {
  Carrier: {
    candidates: [
      placeholder('id', '#carrierName'),
      placeholder('name', "input[name='carrierName']"),
      byFrameworkName('carrierName'),
      byIdSuffix('carrierName'),
      byLabel(['Carrier Name', 'Carrier', 'Carrier SCAC']),
    ],
    devtoolsHint: 'Transportation tab -> inspect the Carrier box (may be an autocomplete bound to SCAC codes).',
  },

  Vessel: {
    candidates: [
      placeholder('id', '#conveyanceName'),
      placeholder('name', "input[name='conveyanceName']"),
      byFrameworkName('conveyanceName'),
      byIdSuffix('conveyanceName'),
      byLabel(['Conveyance Name', 'Vessel Name', 'Vessel', 'Carrier/Vessel Name']),
    ],
    devtoolsHint: 'Transportation tab -> inspect the Conveyance Name / Vessel box.',
  },

  BookingNumber: {
    candidates: [
      placeholder('id', '#bookingNumber'),
      placeholder('name', "input[name='bookingNumber']"),
      byFrameworkName('bookingNumber'),
      byIdSuffix('bookingNumber'),
      byLabel(['Booking Number', 'Booking No', 'Booking Reference']),
    ],
    devtoolsHint: 'Transportation tab -> inspect the Booking Number box.',
  },

  ContainerNumber: {
    candidates: [
      placeholder('id', '#containerNumber'),
      placeholder('name', "input[name='containerNumber']"),
      byFrameworkName('containerNumber'),
      byIdSuffix('containerNumber'),
      byLabel(['Container Number', 'Container No', 'Equipment Number', 'Equipment No']),
      byNearby("[data-section='container']", "input[name*='container' i]"),
    ],
    devtoolsHint:
      'Transportation tab -> Containers panel -> inspect the Container Number box. Containers are usually a repeating row; capture the row container element as well.',
  },

  SealNumber: {
    candidates: [
      placeholder('id', '#sealNumber'),
      placeholder('name', "input[name='sealNumber']"),
      byFrameworkName('sealNumber'),
      byIdSuffix('sealNumber'),
      byLabel(['Seal Number', 'Seal No', 'Seal']),
      byNearby("[data-section='container']", "input[name*='seal' i]"),
    ],
    devtoolsHint: 'Transportation tab -> Containers panel -> inspect the Seal Number box.',
  },
};
