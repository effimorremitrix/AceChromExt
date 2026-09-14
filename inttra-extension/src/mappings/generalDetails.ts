/**
 * General Details: the booking and the sailing.
 *
 * All selectors are placeholders. The labels are guesses at INTTRA's wording
 * and are tried last; the diagnostics tab says exactly what to capture.
 */

import type { InttraFieldMapping } from '../models/InttraField.js';
import { defineInttraField, placeholderLadder } from './types.js';

const HINT = (what: string): string =>
  `General Details -> right-click the ${what} box -> Inspect -> Copy outerHTML of the <input> (or the <select> and two of its <option>s), plus its <label>.`;

export const GENERAL_DETAILS_FIELDS: InttraFieldMapping[] = [
  defineInttraField({
    key: 'BookingNumber',
    label: 'Booking Number',
    page: 'generalDetails',
    scope: 'shipment',
    source: 'header.bookingReference',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 35,
    expected: true,
    candidates: placeholderLadder('bookingNumber', ['Booking Number', 'Booking No', 'Carrier Booking Number', 'Booking Reference']),
    devtoolsHint: HINT('Booking Number'),
  }),
  defineInttraField({
    key: 'ShipperReference',
    label: "Shipper's Reference",
    page: 'generalDetails',
    scope: 'shipment',
    source: 'header.shipmentReference',
    type: 'text',
    transforms: ['text'],
    maxLength: 35,
    candidates: placeholderLadder('shipperReference', ["Shipper's Reference", 'Shipper Reference', 'Shipper Ref', 'Shipment Reference', 'Reference Number']),
    devtoolsHint: HINT("Shipper's Reference"),
  }),
  defineInttraField({
    key: 'Carrier',
    label: 'Carrier',
    page: 'generalDetails',
    scope: 'shipment',
    source: 'header.carrier',
    type: 'select',
    transforms: ['text'],
    candidates: placeholderLadder('carrier', ['Carrier', 'Carrier Name', 'Ocean Carrier'], 'select'),
    devtoolsHint: HINT('Carrier'),
  }),
  defineInttraField({
    key: 'Vessel',
    label: 'Vessel',
    page: 'generalDetails',
    scope: 'shipment',
    source: 'header.vessel',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 35,
    candidates: placeholderLadder('vessel', ['Vessel', 'Vessel Name', 'Ocean Vessel']),
    devtoolsHint: HINT('Vessel'),
  }),
  defineInttraField({
    key: 'Voyage',
    label: 'Voyage',
    page: 'generalDetails',
    scope: 'shipment',
    source: 'header.voyage',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 17,
    candidates: placeholderLadder('voyage', ['Voyage', 'Voyage Number', 'Voyage No']),
    devtoolsHint: HINT('Voyage'),
  }),
  defineInttraField({
    key: 'PortOfLoading',
    label: 'Port of Loading',
    page: 'generalDetails',
    scope: 'shipment',
    source: 'header.portOfLoading',
    type: 'text',
    transforms: ['text'],
    maxLength: 60,
    candidates: placeholderLadder('portOfLoading', ['Port of Loading', 'Port of Load', 'POL', 'Load Port']),
    devtoolsHint: `${HINT('Port of Loading')} INTTRA may render this as a type-ahead over a UN/LOCODE list; capture the box and one selected value.`,
  }),
  defineInttraField({
    key: 'PortOfDischarge',
    label: 'Port of Discharge',
    page: 'generalDetails',
    scope: 'shipment',
    source: 'header.portOfDischarge',
    type: 'text',
    transforms: ['text'],
    maxLength: 60,
    candidates: placeholderLadder('portOfDischarge', ['Port of Discharge', 'POD', 'Discharge Port']),
    devtoolsHint: `${HINT('Port of Discharge')} Same type-ahead caveat as Port of Loading.`,
  }),
];
