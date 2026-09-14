/**
 * Container & Cargo: the single-container form (one container open at a time).
 *
 * Scope 'container': values come from the selected container in the package.
 * The grid on Copy Container Details is mapped separately in containerGrid.ts.
 */

import type { InttraFieldMapping } from '../models/InttraField.js';
import { defineInttraField, placeholderLadder } from './types.js';

const HINT = (what: string): string =>
  `Container & Cargo -> open one container -> right-click the ${what} box -> Inspect -> Copy outerHTML of the control and its <label>. Also capture the container panel's heading so writes can be scoped to the open container.`;

export const CONTAINER_CARGO_FIELDS: InttraFieldMapping[] = [
  defineInttraField({
    key: 'ContainerNumber',
    label: 'Container Number',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.containerNumber',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 11,
    expected: true,
    candidates: placeholderLadder('containerNumber', ['Container Number', 'Container No', 'Equipment Number']),
    devtoolsHint: HINT('Container Number'),
  }),
  defineInttraField({
    key: 'CarrierSeal',
    label: 'Carrier Seal #',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.carrierSeal',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 15,
    expected: true,
    candidates: placeholderLadder('carrierSeal', ['Carrier Seal #', 'Carrier Seal', 'Carrier Seal Number', 'Seal Number', 'Seal #']),
    devtoolsHint: HINT('Carrier Seal #'),
  }),
  defineInttraField({
    key: 'ShipperSeal',
    label: 'Shipper Seal #',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.shipperSeal',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 15,
    candidates: placeholderLadder('shipperSeal', ['Shipper Seal #', 'Shipper Seal', 'Shipper Seal Number']),
    devtoolsHint: HINT('Shipper Seal #'),
  }),
  defineInttraField({
    key: 'CargoDescription',
    label: 'Cargo Description',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.cargoDescription',
    type: 'text',
    transforms: ['text'],
    maxLength: 512,
    expected: true,
    candidates: placeholderLadder('cargoDescription', ['Cargo Description', 'Description of Goods', 'Goods Description', 'Description'], 'textarea'),
    devtoolsHint: HINT('Cargo Description'),
  }),
  defineInttraField({
    key: 'HsCode',
    label: 'HS Code',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.hsCode',
    type: 'code',
    transforms: ['text'],
    maxLength: 12,
    candidates: placeholderLadder('hsCode', ['HS Code', 'Harmonized Code', 'HTS Code', 'Commodity Code']),
    devtoolsHint: `${HINT('HS Code')} Note whether INTTRA wants the six-digit code with or without the dot.`,
  }),
  defineInttraField({
    key: 'PackageType',
    label: 'Package Type',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.packageType',
    type: 'select',
    transforms: ['text'],
    candidates: placeholderLadder('packageType', ['Package Type', 'Packaging Type', 'Package Kind', 'Kind of Packages'], 'select'),
    devtoolsHint: `${HINT('Package Type')} Capture two <option>s so the writer knows whether values are codes (CT) or words (Carton).`,
  }),
  defineInttraField({
    key: 'PackageCount',
    label: 'Number of Packages',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.packageCount',
    type: 'number',
    transforms: ['integer'],
    candidates: placeholderLadder('packageCount', ['Number of Packages', 'No. of Packages', 'Package Count', 'Packages']),
    devtoolsHint: HINT('Number of Packages'),
  }),
  defineInttraField({
    key: 'GrossWeight',
    label: 'Gross Weight (kg)',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.grossWeightKg',
    type: 'number',
    transforms: ['weight'],
    candidates: placeholderLadder('grossWeight', ['Gross Weight', 'Gross Weight (KG)', 'Cargo Gross Weight', 'Weight']),
    devtoolsHint: `${HINT('Gross Weight')} Also capture the unit control beside it: the package holds kilograms.`,
  }),
  defineInttraField({
    key: 'MarksAndNumbers',
    label: 'Marks & Numbers',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.marksAndNumbers',
    type: 'text',
    transforms: ['text'],
    maxLength: 512,
    candidates: placeholderLadder('marksAndNumbers', ['Marks & Numbers', 'Marks and Numbers', 'Marks & Nos', 'Marks'], 'textarea'),
    devtoolsHint: HINT('Marks & Numbers'),
  }),
];
