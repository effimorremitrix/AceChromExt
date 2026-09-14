/**
 * Print Instructions: how the B/L is issued. The package holds one thing that
 * belongs here, the freight terms; the rest (originals, copies, freighted or
 * not) is the operator's choice and is never filled.
 */

import type { InttraFieldMapping } from '../models/InttraField.js';
import { defineInttraField, placeholderLadder } from './types.js';

export const PRINT_INSTRUCTIONS_FIELDS: InttraFieldMapping[] = [
  defineInttraField({
    key: 'FreightTerms',
    label: 'Freight Terms',
    page: 'printInstructions',
    scope: 'shipment',
    source: 'header.freightTerms',
    type: 'select',
    transforms: ['text', 'upper'],
    candidates: placeholderLadder('freightTerms', ['Freight Terms', 'Freight Payment', 'Payment Terms', 'Incoterms'], 'select'),
    devtoolsHint: 'Print Instructions -> inspect the Freight Terms control; capture the <select> and two <option>s so the writer knows whether it wants PREPAID/COLLECT or an incoterm.',
  }),
];
