/**
 * Step 4: Transportation.
 *
 * SELECTOR STATUS: placeholders only. See docs/ACE-MAPPING.md.
 */

import type { AceFieldMapping } from '../../models/AceField.js';
import { byLabel, defineField, placeholder } from './types.js';

export const TRANSPORTATION_FIELDS: AceFieldMapping[] = [
  defineField({
    key: 'Carrier',
    label: 'Carrier Name',
    page: 'transportation',
    scope: 'shipment',
    source: 'invoice.carrier',
    type: 'text',
    transforms: ['text'],
    maxLength: 60,
    candidates: [
      placeholder('id', '#carrierName'),
      placeholder('name', "input[name='carrierName']"),
      byLabel(['Carrier Name', 'Carrier']),
    ],
    devtoolsHint: 'Transportation tab -> inspect the Carrier box (may be an autocomplete bound to SCAC codes).',
  }),

  defineField({
    key: 'Vessel',
    label: 'Conveyance Name / Vessel',
    page: 'transportation',
    scope: 'shipment',
    source: 'invoice.vessel',
    type: 'text',
    transforms: ['text'],
    maxLength: 40,
    candidates: [
      placeholder('id', '#conveyanceName'),
      placeholder('name', "input[name='conveyanceName']"),
      byLabel(['Conveyance Name', 'Vessel Name', 'Vessel', 'Carrier/Vessel Name']),
    ],
    devtoolsHint: 'Transportation tab -> inspect the Conveyance Name / Vessel box.',
  }),

  defineField({
    key: 'BookingNumber',
    label: 'Booking Number',
    page: 'transportation',
    scope: 'shipment',
    source: 'invoice.bookingNumber',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 35,
    candidates: [
      placeholder('id', '#bookingNumber'),
      placeholder('name', "input[name='bookingNumber']"),
      byLabel(['Booking Number', 'Booking No']),
    ],
    devtoolsHint: 'Transportation tab -> inspect the Booking Number box.',
  }),

  defineField({
    key: 'ContainerNumber',
    label: 'Container Number',
    page: 'transportation',
    scope: 'shipment',
    source: 'invoice.containerNumber',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 17,
    candidates: [
      placeholder('id', '#containerNumber'),
      placeholder('name', "input[name='containerNumber']"),
      byLabel(['Container Number', 'Container No', 'Equipment Number']),
    ],
    devtoolsHint:
      'Transportation tab -> Containers panel -> inspect the Container Number box. Containers are usually a repeating row; capture the row container element as well.',
  }),

  defineField({
    key: 'SealNumber',
    label: 'Seal Number',
    page: 'transportation',
    scope: 'shipment',
    source: 'invoice.sealNumber',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 15,
    candidates: [
      placeholder('id', '#sealNumber'),
      placeholder('name', "input[name='sealNumber']"),
      byLabel(['Seal Number', 'Seal No']),
    ],
    devtoolsHint: 'Transportation tab -> Containers panel -> inspect the Seal Number box.',
  }),
];
