/**
 * Step 4: Transportation.
 *
 * The live step (captured 2026-09-16) holds exactly three controls. Container
 * Number and Seal Number are not among them and never were: they are carrier
 * booking data that the INTTRA Helper fills, so they stay in the canonical
 * model and the spreadsheet but are not ACE fields.
 *
 * Selectors: src/ace/selectors/transportation.ts.
 */

import type { AceFieldMapping } from '../../models/AceField.js';
import { TRANSPORTATION_SELECTORS } from '../selectors/transportation.js';
import { defineField } from './types.js';

export const TRANSPORTATION_FIELDS: AceFieldMapping[] = [
  defineField({
    key: 'Carrier',
    label: 'Carrier SCAC/IATA',
    page: 'transportation',
    scope: 'shipment',
    source: 'invoice.carrier',
    type: 'text',
    transforms: ['text', 'upper'],
    // The live value is the 4-letter SCAC "MSCU", not a carrier name. The
    // element's own maxlength has not been captured, so no length is claimed
    // here; the validator warns when the spreadsheet supplies a name instead
    // of a code.
    selectors: TRANSPORTATION_SELECTORS,
  }),

  defineField({
    key: 'Vessel',
    label: 'Conveyance Name/Carrier Name',
    page: 'transportation',
    scope: 'shipment',
    source: 'invoice.vessel',
    type: 'text',
    transforms: ['text'],
    // maxlength="23" on the live element, and the live value carries vessel
    // AND voyage ("MSC JULIE V. MC732R") inside that budget.
    maxLength: 23,
    selectors: TRANSPORTATION_SELECTORS,
  }),

  defineField({
    key: 'TransportationReferenceNumber',
    label: 'Transportation Reference Number',
    page: 'transportation',
    scope: 'shipment',
    source: 'invoice.bookingNumber',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 30,
    selectors: TRANSPORTATION_SELECTORS,
  }),
];
