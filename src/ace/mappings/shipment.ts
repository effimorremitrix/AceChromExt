/**
 * Step 1: Shipment.
 *
 * Canonical field, transformation, ACE length limit and expectation only.
 * The selectors are in src/ace/selectors/shipment.ts; the validation rules are
 * in src/excel/validator.ts, shared with the QuickBooks companion.
 */

import type { AceFieldMapping } from '../../models/AceField.js';
import { SHIPMENT_SELECTORS } from '../selectors/shipment.js';
import { defineField } from './types.js';

export const SHIPMENT_FIELDS: AceFieldMapping[] = [
  defineField({
    key: 'ShipmentReferenceNumber',
    label: 'Shipment Reference Number',
    page: 'shipment',
    scope: 'shipment',
    source: 'invoice.invoiceNumber',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 17,
    expected: true,
    selectors: SHIPMENT_SELECTORS,
  }),

  defineField({
    key: 'InvoiceDate',
    label: 'Invoice / Export Date',
    page: 'shipment',
    scope: 'shipment',
    source: 'invoice.invoiceDate',
    type: 'date',
    transforms: ['date'],
    expected: true,
    selectors: SHIPMENT_SELECTORS,
  }),

  defineField({
    key: 'PONumber',
    label: 'PO Number',
    page: 'shipment',
    scope: 'shipment',
    source: 'invoice.poNumber',
    type: 'text',
    transforms: ['text'],
    maxLength: 35,
    selectors: SHIPMENT_SELECTORS,
  }),

  defineField({
    key: 'Destination',
    label: 'Country of Ultimate Destination',
    page: 'shipment',
    scope: 'shipment',
    source: 'invoice.destination',
    type: 'select',
    transforms: ['country'],
    expected: true,
    selectors: SHIPMENT_SELECTORS,
  }),

  defineField({
    key: 'FreightTerms',
    label: 'Freight / INCO Terms',
    page: 'shipment',
    scope: 'shipment',
    source: 'invoice.freightTerms',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 10,
    selectors: SHIPMENT_SELECTORS,
  }),
];
