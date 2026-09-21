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
 * The rest of the block has no captured id, but its LABEL WORDING was read
 * off the same live screen on 2026-09-20 and is in the ladders below:
 *
 *   Container 1            Container Number, Container Type,
 *                          Container Supplier, Container Tare Weight,
 *                          Wood Declaration, Carrier Seal Number(s),
 *                          Shipper Seal Number(s)
 *   Cargo 1                Package Count/Type (Outermost), Print on B/L as,
 *                          HS Code, Schedule B Number, Cargo Description,
 *                          NCM Code(s), Marks & Numbers, CUS Code
 *   Cargo Gross Weight     Cargo Gross Weight (Cargo + Packaging),
 *     & Volume             Cargo Gross Volume (Cargo + Packaging)
 *
 * Two of those wordings are one label over TWO controls: "Package Count/Type
 * (Outermost)" heads a count box and a type dropdown. Neither field could
 * ever resolve from it until the detector learned to keep the match of the
 * kind the mapping declares (controlKind, fieldDetector.ts).
 *
 * A label is not a row, so a captured wording only ever fills ROW 1: beyond
 * it, `mappingsForRow` drops every candidate that cannot name a row. Filling
 * container 2's cargo needs the id, in the shape the seals have.
 */

import type { InttraFieldMapping } from '../models/InttraField.js';
import { capturedLabel, defineInttraField, placeholderLadder, verified } from './types.js';

/** Note carried by every selector copied off the live Particulars block. */
const CAPTURED = 'Captured from the live INTTRA DOM on 2026-09-20; the row number is substituted for {n} at fill time.';

/** Note carried by every wording read off the live Particulars block. */
const READ_LIVE = 'Label wording read off the live Particulars block on 2026-09-20; the DOM id is still uncaptured, so it only ever resolves row 1.';

// The live portal has NO separate Container & Cargo screen (2026-09-20): the
// container blocks are the Particulars section of Create Shipping Instruction,
// numbered from 1. Sending an operator to a screen that does not exist is a
// capture that never happens.
const HINT = (what: string): string =>
  `Create Shipping Instruction -> Particulars -> the block of container 1 -> right-click the ${what} box -> Inspect -> Copy outerHTML of the control and its <label>. Capture the same box in container 2 as well: what differs between the two is the row number, which is what {n} stands for.`;

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
      capturedLabel(['Container Number'], READ_LIVE),
      ...placeholderLadder('containerNumber', ['Container No', 'Equipment Number']),
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
    candidates: [
      capturedLabel(['Cargo Description'], READ_LIVE),
      ...placeholderLadder('cargoDescription', ['Description of Goods', 'Goods Description', 'Description'], 'textarea'),
    ],
    devtoolsHint: HINT('Cargo Description'),
  }),
  defineInttraField({
    key: 'HsCode',
    label: 'HS Code',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.hsCode',
    type: 'code',
    // The package derives "0802.12" from the Schedule B number. The live box
    // answered that on 2026-09-20 with "Field cannot contain decimal points",
    // so the separators come off here and the canonical value keeps its dot.
    transforms: ['text', 'hsCode'],
    maxLength: 12,
    candidates: [
      capturedLabel(['HS Code'], READ_LIVE),
      ...placeholderLadder('hsCode', ['Harmonized Code', 'HTS Code', 'Commodity Code']),
    ],
    devtoolsHint: `${HINT('HS Code')} The box rejects decimal points (live, 2026-09-20), so the six digits go in unseparated. Beside it sits a separate "Schedule B Number" box, which nothing in the package feeds yet.`,
  }),
  defineInttraField({
    key: 'PackageType',
    label: 'Package Type',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.packageType',
    type: 'select',
    transforms: ['text'],
    candidates: [
      // One label, two controls: the count box and this dropdown. The detector
      // keeps the dropdown because the mapping declares one.
      capturedLabel(['Package Count/Type (Outermost)'], READ_LIVE),
      ...placeholderLadder('packageType', ['Package Type', 'Packaging Type', 'Package Kind', 'Kind of Packages'], 'select'),
    ],
    devtoolsHint: `${HINT('Package Type')} It shares the label "Package Count/Type (Outermost)" with the count box. Capture two <option>s so the writer knows whether values are codes (CT) or words (Carton).`,
  }),
  defineInttraField({
    key: 'PackageCount',
    label: 'Number of Packages',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.packageCount',
    type: 'number',
    transforms: ['integer'],
    candidates: [
      // The same label as Package Type; this is the count box of the pair.
      capturedLabel(['Package Count/Type (Outermost)'], READ_LIVE),
      ...placeholderLadder('packageCount', ['Number of Packages', 'No. of Packages', 'Package Count', 'Packages']),
    ],
    devtoolsHint: `${HINT('Number of Packages')} The live label is "Package Count/Type (Outermost)", shared with the type dropdown beside it.`,
  }),
  defineInttraField({
    key: 'GrossWeight',
    label: 'Gross Weight (kg)',
    page: 'containerCargo',
    scope: 'container',
    source: 'container.grossWeightKg',
    type: 'number',
    transforms: ['weight'],
    candidates: [
      capturedLabel(['Cargo Gross Weight (Cargo + Packaging)'], READ_LIVE),
      ...placeholderLadder('grossWeight', ['Gross Weight', 'Gross Weight (KG)', 'Cargo Gross Weight', 'Weight']),
    ],
    devtoolsHint: `${HINT('Cargo Gross Weight')} Also capture the unit dropdown beside it, which read "Kgs" on 2026-09-20: the package holds kilograms, and the helper does not touch the unit.`,
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
    candidates: [
      capturedLabel(['Marks & Numbers'], READ_LIVE),
      ...placeholderLadder('marksAndNumbers', ['Marks and Numbers', 'Marks & Nos', 'Marks'], 'textarea'),
    ],
    devtoolsHint: HINT('Marks & Numbers'),
  }),
];
