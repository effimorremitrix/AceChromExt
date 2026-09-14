/**
 * B/L Documents: the parties. The consignee comes from the invoice's bill-to
 * address. The shipper and notify parties are INTTRA address-book entries and
 * are the operator's to pick; they are never filled.
 */

import type { InttraFieldMapping } from '../models/InttraField.js';
import { defineInttraField, placeholderLadder } from './types.js';

const SECTION = ['Consignee'];
const HINT = 'B/L Documents -> Consignee panel -> inspect the box; capture the control, its <label>, and the panel heading so writes can be scoped to the consignee rather than the shipper or notify party.';

function consignee(key: string, label: string, name: string, source: string, labels: string[], maxLength: number, type: 'text' | 'select' = 'text'): InttraFieldMapping {
  const candidates = placeholderLadder(name, labels, type === 'select' ? 'select' : 'input').map((candidate) =>
    candidate.strategy === 'label' ? { ...candidate, section: SECTION } : candidate,
  );
  return defineInttraField({ key, label, page: 'blDocuments', scope: 'shipment', source, type, transforms: ['text'], maxLength, candidates, devtoolsHint: HINT });
}

export const BL_DOCUMENTS_FIELDS: InttraFieldMapping[] = [
  consignee('ConsigneeName', 'Consignee Name', 'consigneeName', 'header.customerName', ['Name', 'Company Name', 'Consignee Name'], 70),
  consignee('ConsigneeAddress1', 'Consignee Address Line 1', 'consigneeAddress1', 'header.consigneeAddress1', ['Address', 'Address Line 1', 'Street'], 70),
  consignee('ConsigneeAddress2', 'Consignee Address Line 2', 'consigneeAddress2', 'header.consigneeAddress2', ['Address Line 2'], 70),
  consignee('ConsigneeCity', 'Consignee City', 'consigneeCity', 'header.consigneeCity', ['City'], 35),
  consignee('ConsigneeState', 'Consignee State', 'consigneeState', 'header.consigneeState', ['State', 'State / Province', 'Province'], 35),
  consignee('ConsigneePostalCode', 'Consignee Postal Code', 'consigneePostalCode', 'header.consigneePostalCode', ['Postal Code', 'Zip Code', 'Zip'], 17),
  consignee('ConsigneeCountry', 'Consignee Country', 'consigneeCountry', 'header.consigneeCountry', ['Country'], 2, 'select'),
];
