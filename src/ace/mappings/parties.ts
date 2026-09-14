/**
 * Step 2: Parties (USPPI, Ultimate Consignee, Intermediate Consignee).
 *
 * Only the consignee *name* and bill-to address are populated from the
 * canonical model. Party EIN/ID numbers are deliberately NOT auto-filled -
 * they are identity data that the filer must enter and verify.
 *
 * Selectors: src/ace/selectors/parties.ts.
 */

import type { AceFieldMapping } from '../../models/AceField.js';
import { PARTIES_SELECTORS } from '../selectors/parties.js';
import { defineField } from './types.js';

export const PARTIES_FIELDS: AceFieldMapping[] = [
  defineField({
    key: 'UltimateConsigneeName',
    label: 'Ultimate Consignee Name',
    page: 'parties',
    scope: 'shipment',
    source: 'invoice.customerName',
    type: 'text',
    transforms: ['text'],
    maxLength: 60,
    expected: true,
    selectors: PARTIES_SELECTORS,
  }),

  defineField({
    key: 'UltimateConsigneeAddress',
    label: 'Ultimate Consignee Address',
    page: 'parties',
    scope: 'shipment',
    source: 'invoice.billTo',
    type: 'text',
    transforms: ['text'],
    maxLength: 120,
    selectors: PARTIES_SELECTORS,
  }),
];
