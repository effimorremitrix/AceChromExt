/**
 * Step 1: Shipment.
 *
 * SELECTOR STATUS: every candidate here is a PLACEHOLDER. See
 * docs/ACE-MAPPING.md for the exact DevTools capture procedure, and replace
 * the placeholder() calls with verified() as each field is confirmed.
 */

import type { AceFieldMapping } from '../../models/AceField.js';
import { byLabel, byNearby, defineField, placeholder } from './types.js';

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
    candidates: [
      placeholder('id', '#shipmentReferenceNumber'),
      placeholder('name', "input[name='shipmentReferenceNumber']"),
      byLabel(['Shipment Reference Number', 'Shipment Ref Number', 'Shipment Reference No']),
      byNearby("[data-field='shipmentReferenceNumber']"),
    ],
    devtoolsHint:
      'Shipment tab -> right-click the Shipment Reference Number box -> Inspect -> copy the full <input> tag (id, name, formcontrolname, data-* attributes).',
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
    candidates: [
      placeholder('id', '#estimatedExportDate'),
      placeholder('name', "input[name='estimatedExportDate']"),
      byLabel(['Date of Export', 'Estimated Date of Export', 'Export Date', 'Invoice Date']),
    ],
    devtoolsHint:
      'Shipment tab -> inspect the date box. Note whether ACE uses a plain text input or a date picker component, and whether it accepts MM/DD/YYYY typed directly.',
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
    candidates: [
      placeholder('id', '#poNumber'),
      placeholder('name', "input[name='poNumber']"),
      byLabel(['PO Number', 'Purchase Order Number', 'Reference Number']),
    ],
    devtoolsHint: 'Shipment tab -> inspect the PO / reference number box.',
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
    candidates: [
      placeholder('id', '#countryOfUltimateDestination'),
      placeholder('name', "select[name='countryOfUltimateDestination']"),
      byLabel(['Country of Ultimate Destination', 'Ultimate Destination', 'Destination Country']),
    ],
    devtoolsHint:
      'Shipment tab -> inspect the destination dropdown. Capture the <select> tag AND two sample <option> tags so the writer knows whether options carry ISO codes or full country names.',
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
    candidates: [
      placeholder('id', '#inCoTerms'),
      placeholder('name', "select[name='inCoTerms']"),
      byLabel(['INCO Terms', 'Inco Terms', 'Freight Terms', 'Terms of Sale']),
    ],
    devtoolsHint: 'Shipment tab -> inspect the Terms of Sale / INCO Terms control (usually a dropdown).',
  }),
];
