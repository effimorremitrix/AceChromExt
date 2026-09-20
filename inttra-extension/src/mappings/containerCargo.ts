/**
 * The container blocks: one Particulars block per container.
 *
 * Scope 'container': values come from the selected container in the package.
 * The grid on Copy Container Details is mapped separately in containerGrid.ts.
 *
 * Captured from the live DOM on 2026-09-20 (ship.inttra.e2open.com, Create
 * Shipping Instruction -> Particulars): the controls of container N all carry
 * the same `-N` suffix, numbered from 1 upward, and `id` and `name` hold the
 * same string:
 *
 *   <input class="form-control input-sm cont-num-1"  id="cont-num-1"  maxlength="11">
 *   <input class="form-control input-sm carr-seal-1" id="carr-seal-1" maxlength="79">
 *   <input class="form-control input-sm ship-seal-1" id="ship-seal-1" maxlength="79">
 *
 * So each selector is written once with `{n}`, and the filler points it at the
 * selected container's row (mappingsForRow in content/filler.ts). The class is
 * NOT used as the selector: it is the same on every row, so it would match
 * them all and the detector would refuse the write as ambiguous.
 *
 * The seal fields take 79 characters and their labels read "Seal Number(s)":
 * INTTRA accepts several seal numbers in one box, which is why nothing here
 * truncates a seal at 15.
 *
 * The rest of the block (Container Type, Package Count/Type, Cargo Gross
 * Weight and its unit, Cargo Gross Volume) has not been captured yet.
 */

import type { InttraFieldMapping } from '../models/InttraField.js';
import { capturedLabel, defineInttraField, placeholderLadder, verified } from './types.js';

/** Note carried by every selector copied off the live Particulars block. */
const CAPTURED = 'Captured from the live INTTRA DOM on 2026-09-20; the row number is substituted for {n} at fill time.';

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
    candidates: [
      verified('id', '#cont-num-{n}', CAPTURED),
      ...placeholderLadder('containerNumber', ['Container Number', 'Container No', 'Equipment Number']),
    ],
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
    maxLength: 79,
    expected: true,
    candidates: [
      verified('id', '#carr-seal-{n}', CAPTURED),
      capturedLabel(['Carrier Seal Number(s)'], 'Label wording read off the live Particulars block on 2026-09-20.'),
      ...placeholderLadder('carrierSeal', ['Carrier Seal #', 'Carrier Seal', 'Carrier Seal Number', 'Seal Number', 'Seal #']),
    ],
    devtoolsHint: HINT('Carrier Seal Number(s)'),
  }),
  defineInttraField({
    key: 'ShipperSeal',
    label: 'Shipper Seal #',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.shipperSeal',
    type: 'text',
    transforms: ['text', 'upper'],
    maxLength: 79,
    candidates: [
      verified('id', '#ship-seal-{n}', CAPTURED),
      capturedLabel(['Shipper Seal Number(s)'], 'Label wording read off the live Particulars block on 2026-09-20.'),
      ...placeholderLadder('shipperSeal', ['Shipper Seal #', 'Shipper Seal', 'Shipper Seal Number']),
    ],
    devtoolsHint: HINT('Shipper Seal Number(s)'),
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
