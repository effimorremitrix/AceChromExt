/**
 * Step 1: Shipment.
 *
 * Canonical field, transformation, ACE length limit and expectation only.
 * The selectors are in src/ace/selectors/shipment.ts; the validation rules are
 * in src/excel/validator.ts, shared with the QuickBooks companion.
 *
 * The live Shipment step (captured 2026-09-14) has no PO Number and no INCO
 * Terms control, so `PONumber` and `FreightTerms` are not ACE fields: the
 * columns stay in the template as reference data only.
 *
 * Origin State is the US state the goods come from, which is not the state of
 * the export port and not the consignee's state: almonds railed from northern
 * California to Norfolk file CA, not VA.
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
    // The filer's own running sequence, not the invoice number: see
    // src/core/referenceCounter.ts. The caller falls back to the invoice
    // number when no counter has been set up, so nothing changes for a
    // profile that never configures one.
    source: 'operator.shipmentReference',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 17,
    expected: true,
    selectors: SHIPMENT_SELECTORS,
  }),

  defineField({
    key: 'InvoiceDate',
    label: 'Departure Date',
    page: 'shipment',
    scope: 'shipment',
    source: 'invoice.invoiceDate',
    type: 'date',
    transforms: ['date'],
    expected: true,
    selectors: SHIPMENT_SELECTORS,
  }),


  defineField({
    key: 'OriginState',
    label: 'Origin State',
    page: 'shipment',
    scope: 'shipment',
    source: 'invoice.originState',
    type: 'select',
    transforms: ['usState'],
    expected: true,
    selectors: SHIPMENT_SELECTORS,
  }),

  defineField({
    key: 'Destination',
    label: 'Country of Destination',
    page: 'shipment',
    scope: 'shipment',
    source: 'invoice.destination',
    type: 'select',
    transforms: ['country'],
    expected: true,
    selectors: SHIPMENT_SELECTORS,
  }),

];
