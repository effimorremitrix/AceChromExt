/**
 * General Details: the booking and the sailing.
 *
 * Most selectors are placeholders. Two label wordings were READ OFF the live
 * Create Shipping Instruction screen on 2026-09-20 and are tried first;
 * everything else is a guess and the diagnostics tab says what to capture.
 *
 * What the live run answered, field by field (ship.inttra.e2open.com,
 * siworkspace#/create, 2026-09-20):
 *
 *   Vessel, Voyage                FOUND and written
 *   Port of Loading, Discharge    FOUND, written, and thrown away on blur
 *   Booking Number                2 controls matched the label ladder
 *   Carrier                       2 controls matched [id$='carrier']
 *   Shipper's Reference           nothing matched
 *
 * The first two answers are what shaped this file. The ports are type-aheads
 * over INTTRA's own location list: `type: 'lookup'` stops the helper blurring
 * the box, because the blur is what discards the text. The Booking Number
 * ambiguity is what the split label ladder is for (mappings/types.ts): the
 * live label reads "Carrier Booking Number", and asking for four wordings at
 * once had matched two controls.
 */

import type { InttraFieldMapping } from '../models/InttraField.js';
import { capturedLabel, defineInttraField, placeholderLadder } from './types.js';

const HINT = (what: string): string =>
  `General Details -> right-click the ${what} box -> Inspect -> Copy outerHTML of the <input> (or the <select> and two of its <option>s), plus its <label>.`;

/** Note carried by every wording read off the live Create Shipping Instruction screen. */
const READ_LIVE = 'Label wording read off the live Create Shipping Instruction screen on 2026-09-20; the DOM id is still uncaptured.';

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
    candidates: [
      // The live Carrier panel labels this box "Carrier Booking Number" and
      // notes "(multiples allowed ex. 371, 425)" underneath. Asked on its
      // own it is one control; asked together with "Booking Number" it was
      // two, which is how this field came back ambiguous on 2026-09-20.
      capturedLabel(['Carrier Booking Number'], READ_LIVE),
      ...placeholderLadder('bookingNumber', ['Booking Number', 'Booking No', 'Booking Reference']),
    ],
    devtoolsHint: HINT('Carrier Booking Number'),
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
    // Nothing on the live screen answered to any of those wordings on
    // 2026-09-20. What the Carrier panel does carry, under Carrier Booking
    // Number, is a "References (multiples allowed ex. 371, 425)" block - a
    // repeating type-and-value pair rather than a single box. Capture it
    // before mapping this field: writing a reference into the wrong slot of a
    // repeating block is worse than leaving it for the operator.
    devtoolsHint: `${HINT("Shipper's Reference")} If it lives in the Carrier panel's "References" block, capture the whole block: the type dropdown, its options, and the value box beside it.`,
  }),
  defineInttraField({
    key: 'Carrier',
    label: 'Carrier',
    page: 'generalDetails',
    scope: 'shipment',
    source: 'header.carrier',
    type: 'select',
    transforms: ['text'],
    candidates: [
      // Read off the live Carrier panel on 2026-09-20: a required "Carrier"
      // dropdown reading "Select One", directly above Carrier Booking Number.
      capturedLabel(['Carrier'], READ_LIVE),
      ...placeholderLadder('carrier', ['Carrier Name', 'Ocean Carrier'], 'select'),
    ],
    devtoolsHint: `${HINT('Carrier')} Two controls answered to [id$='carrier'] on 2026-09-20, so capture the real id and paste it into the selector overrides.`,
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
    // A type-ahead, not a text box: on 2026-09-20 the write succeeded and
    // INTTRA emptied the control again. See InttraFieldType.
    type: 'lookup',
    source: 'header.portOfLoading',
    transforms: ['text'],
    maxLength: 60,
    candidates: placeholderLadder('portOfLoading', ['Port of Loading', 'Port of Load', 'POL', 'Load Port']),
    devtoolsHint: `${HINT('Port of Loading')} It is a type-ahead over INTTRA's location list: capture the box, the suggestion list element, and one picked value, so the helper can learn what INTTRA stores when a suggestion is chosen.`,
  }),
  defineInttraField({
    key: 'PortOfDischarge',
    label: 'Port of Discharge',
    page: 'generalDetails',
    scope: 'shipment',
    type: 'lookup',
    source: 'header.portOfDischarge',
    transforms: ['text'],
    maxLength: 60,
    candidates: placeholderLadder('portOfDischarge', ['Port of Discharge', 'POD', 'Discharge Port']),
    devtoolsHint: `${HINT('Port of Discharge')} Same type-ahead caveat as Port of Loading.`,
  }),
];
