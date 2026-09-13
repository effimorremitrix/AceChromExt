/**
 * Step 1: Shipment - ACE selectors.
 *
 * SELECTOR STATUS: every candidate here is a PLACEHOLDER. The mapping
 * architecture is complete; these 24 strings are what one hour with DevTools
 * on the live portal replaces. See docs/ACE-MAPPING.md for the capture
 * procedure, and `overrides.ts` for installing a captured selector without a
 * rebuild.
 */

import { byFrameworkName, byIdSuffix, byLabel, byNearby, placeholder, type SelectorTable } from './types.js';

export const SHIPMENT_SELECTORS: SelectorTable = {
  ShipmentReferenceNumber: {
    candidates: [
      placeholder('id', '#shipmentReferenceNumber'),
      placeholder('name', "input[name='shipmentReferenceNumber']"),
      byFrameworkName('shipmentReferenceNumber'),
      byIdSuffix('shipmentReferenceNumber'),
      byLabel([
        'Shipment Reference Number',
        'Shipment Ref Number',
        'Shipment Reference No',
        'Shipment Reference',
        'Filer Reference Number',
      ]),
      byNearby("[data-section='shipment']", "input[name*='reference' i]"),
    ],
    devtoolsHint:
      'Shipment tab -> right-click the Shipment Reference Number box -> Inspect -> copy the full <input> tag (id, name, formcontrolname, data-* attributes).',
  },

  InvoiceDate: {
    candidates: [
      placeholder('id', '#estimatedExportDate'),
      placeholder('name', "input[name='estimatedExportDate']"),
      byFrameworkName('estimatedExportDate'),
      byIdSuffix('estimatedExportDate'),
      byLabel([
        'Date of Export',
        'Estimated Date of Export',
        'Export Date',
        'Invoice Date',
        'Estimated Export Date',
      ]),
    ],
    devtoolsHint:
      'Shipment tab -> inspect the date box. Note whether ACE uses a plain text input or a date picker component, and whether it accepts MM/DD/YYYY typed directly.',
  },

  PONumber: {
    candidates: [
      placeholder('id', '#poNumber'),
      placeholder('name', "input[name='poNumber']"),
      byFrameworkName('poNumber'),
      byIdSuffix('poNumber'),
      byLabel(['PO Number', 'Purchase Order Number', 'Reference Number']),
    ],
    devtoolsHint: 'Shipment tab -> inspect the PO / reference number box.',
  },

  Destination: {
    candidates: [
      placeholder('id', '#countryOfUltimateDestination'),
      placeholder('name', "select[name='countryOfUltimateDestination']"),
      byFrameworkName('countryOfUltimateDestination'),
      byIdSuffix('countryOfUltimateDestination'),
      byLabel([
        'Country of Ultimate Destination',
        'Ultimate Destination',
        'Destination Country',
        'Country of Destination',
      ]),
    ],
    devtoolsHint:
      'Shipment tab -> inspect the destination dropdown. Capture the <select> tag AND two sample <option> tags so the writer knows whether options carry ISO codes or full country names.',
  },

  FreightTerms: {
    candidates: [
      placeholder('id', '#inCoTerms'),
      placeholder('name', "select[name='inCoTerms']"),
      byFrameworkName('inCoTerms'),
      byIdSuffix('inCoTerms'),
      byLabel(['INCO Terms', 'Inco Terms', 'Freight Terms', 'Terms of Sale', 'Incoterms']),
    ],
    devtoolsHint: 'Shipment tab -> inspect the Terms of Sale / INCO Terms control (usually a dropdown).',
  },
};
