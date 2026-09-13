/**
 * Step 4: Transportation.
 *
 * Selectors: src/ace/selectors/transportation.ts.
 */

import type { AceFieldMapping } from '../../models/AceField.js';
import { TRANSPORTATION_SELECTORS } from '../selectors/transportation.js';
import { defineField } from './types.js';

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
    selectors: TRANSPORTATION_SELECTORS,
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
    selectors: TRANSPORTATION_SELECTORS,
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
    selectors: TRANSPORTATION_SELECTORS,
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
    selectors: TRANSPORTATION_SELECTORS,
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
    selectors: TRANSPORTATION_SELECTORS,
  }),
];
