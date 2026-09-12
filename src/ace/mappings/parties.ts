/**
 * Step 2: Parties (USPPI, Ultimate Consignee, Intermediate Consignee).
 *
 * SELECTOR STATUS: placeholders only. See docs/ACE-MAPPING.md.
 *
 * Note: only the consignee *name* and bill-to address are populated from the
 * canonical model. Party EIN/ID numbers are deliberately NOT auto-filled -
 * they are identity data that the filer must enter and verify.
 */

import type { AceFieldMapping } from '../../models/AceField.js';
import { byLabel, byNearby, defineField, placeholder } from './types.js';

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
    candidates: [
      placeholder('id', '#ultimateConsigneeName'),
      placeholder('name', "input[name='ultimateConsigneeName']"),
      byLabel(['Ultimate Consignee Name', 'Consignee Name', 'Company Name']),
      byNearby("[data-section='ultimateConsignee']"),
    ],
    devtoolsHint:
      'Parties tab -> Ultimate Consignee panel -> inspect the Name box. Capture the panel container element too, so the nearby fallback can be scoped correctly.',
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
    candidates: [
      placeholder('id', '#ultimateConsigneeAddress1'),
      placeholder('name', "input[name='ultimateConsigneeAddress1']"),
      byLabel(['Address Line 1', 'Address 1', 'Street Address']),
      byNearby("[data-section='ultimateConsignee']", "input[name*='address' i]"),
    ],
    devtoolsHint:
      'Parties tab -> inspect Address Line 1. ACE splits the address into several boxes; note how many lines exist and whether city/state/postal are separate controls.',
  }),
];
