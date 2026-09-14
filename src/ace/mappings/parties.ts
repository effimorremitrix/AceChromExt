/**
 * Step 2: Parties -> Ultimate Consignee panel.
 *
 * The consignee name and the split address (line 1, line 2, city, state,
 * postal code, country) are populated from the canonical model. Party EIN/ID
 * numbers, consignee type and "Sold En Route" are deliberately NOT auto-filled:
 * they are identity data and filing decisions the filer must enter and verify.
 *
 * Selectors: src/ace/selectors/parties.ts.
 */

import type { AceFieldMapping } from '../../models/AceField.js';
import { PARTIES_SELECTORS } from '../selectors/parties.js';
import { defineField } from './types.js';

export const PARTIES_FIELDS: AceFieldMapping[] = [
  defineField({
    key: 'UltimateConsigneeName',
    label: 'Company Name (Ultimate Consignee)',
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
    label: 'Address Line 1 (Ultimate Consignee)',
    page: 'parties',
    scope: 'shipment',
    source: 'invoice.billTo',
    type: 'text',
    transforms: ['text'],
    maxLength: 120,
    expected: true,
    selectors: PARTIES_SELECTORS,
  }),

  defineField({
    key: 'UltimateConsigneeAddress2',
    label: 'Address Line 2 (Ultimate Consignee)',
    page: 'parties',
    scope: 'shipment',
    source: 'invoice.billToAddress2',
    type: 'text',
    transforms: ['text'],
    maxLength: 120,
    selectors: PARTIES_SELECTORS,
  }),

  defineField({
    key: 'UltimateConsigneeCity',
    label: 'City (Ultimate Consignee)',
    page: 'parties',
    scope: 'shipment',
    source: 'invoice.billToCity',
    type: 'text',
    transforms: ['text'],
    maxLength: 60,
    expected: true,
    selectors: PARTIES_SELECTORS,
  }),

  defineField({
    key: 'UltimateConsigneeState',
    label: 'State (Ultimate Consignee)',
    page: 'parties',
    scope: 'shipment',
    source: 'invoice.billToState',
    type: 'select',
    transforms: ['text', 'upper'],
    maxLength: 60,
    selectors: PARTIES_SELECTORS,
  }),

  defineField({
    key: 'UltimateConsigneePostalCode',
    label: 'Postal Code (Ultimate Consignee)',
    page: 'parties',
    scope: 'shipment',
    source: 'invoice.billToPostalCode',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 15,
    selectors: PARTIES_SELECTORS,
  }),

  defineField({
    key: 'UltimateConsigneeCountry',
    label: 'Country (Ultimate Consignee)',
    page: 'parties',
    scope: 'shipment',
    source: 'invoice.billToCountry',
    type: 'select',
    transforms: ['country'],
    expected: true,
    selectors: PARTIES_SELECTORS,
  }),
];
