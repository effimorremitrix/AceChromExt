/**
 * Copy Container Details: the container grid.
 *
 * The observed screen shows a spreadsheet-like grid with these columns, and
 * more reachable by scrolling sideways:
 *
 *   Container Number | Carrier Seal # | Shipper Seal # | Cargo Description |
 *   Marks & Numbers | HS Code | Package Type | ...
 *
 * The writer finds the grid root by the candidates below, reads the HEADER
 * ROW to learn which column is which (never by position), then writes one
 * package container per existing data row. Whether a cell is a native input,
 * a contenteditable element or something else is decided per cell at write
 * time by setInttraFieldValue.
 *
 * Seen on the live modal on 2026-09-20 (Copy Container Details, opened by
 * "Copy container details from spreadsheet" in Particulars): the header row
 * reads Container Number | Carrier Seal # | Shipper Seal # | Cargo
 * Description | Marks & Numbers | HS Code, with more columns to the right of
 * a horizontal scrollbar, which is the order below. Two controls sit ABOVE
 * the grid and apply to every row: Container Type, and Unit of Measure
 * (Weight, Volume). So a weight cell is a bare number in the unit chosen
 * there, never a number with a unit in it, and the operator sets the unit.
 * The grid also renders after a spinner, so it is worth pressing refresh in
 * the helper once it is on screen.
 *
 * The column selectors themselves are still not captured: columns are found
 * by the wording of the header row (gridWriter.ts), which is what the live
 * runs proved out. docs/INTTRA-INTEGRATION.md lists what to copy from
 * DevTools to make the rest exact.
 */

import type { PackageContainerField } from '../../../shared/src/filingPackage.js';
import type { InttraSelectorCandidate } from '../models/InttraField.js';
import { byLabel, byNearby, placeholder, verified } from './types.js';

export interface GridColumnSpec {
  key: string;
  /** Heading as observed on the screen. */
  label: string;
  /** Normalized heading texts (letters and digits only, lower-case) that identify the column. */
  headerAliases: string[];
  source: PackageContainerField;
  transforms?: string[];
  maxLength?: number;
  /** A column the package always feeds; an empty value is a warning rather than a skip. */
  expected?: boolean;
}

export const GRID_COLUMNS: GridColumnSpec[] = [
  { key: 'ContainerNumber', label: 'Container Number', headerAliases: ['containernumber', 'containerno', 'container', 'equipmentnumber', 'containerid'], source: 'containerNumber', transforms: ['text', 'upper'], maxLength: 11, expected: true },
  // 79 characters, and the form's label reads "Seal Number(s)": INTTRA takes
  // several seal numbers in one cell (captured 2026-09-20).
  { key: 'CarrierSeal', label: 'Carrier Seal #', headerAliases: ['carrierseal', 'carriersealno', 'carriersealnumber', 'carriersealnumbers', 'lineseal', 'customsseal'], source: 'carrierSeal', transforms: ['text', 'upper'], maxLength: 79 },
  { key: 'ShipperSeal', label: 'Shipper Seal #', headerAliases: ['shipperseal', 'shippersealno', 'shippersealnumber', 'shippersealnumbers', 'sealno', 'sealnumber', 'seal'], source: 'shipperSeal', transforms: ['text', 'upper'], maxLength: 79, expected: true },
  { key: 'CargoDescription', label: 'Cargo Description', headerAliases: ['cargodescription', 'descriptionofgoods', 'goodsdescription', 'description'], source: 'cargoDescription', transforms: ['text'], maxLength: 512 },
  { key: 'MarksAndNumbers', label: 'Marks & Numbers', headerAliases: ['marksnumbers', 'marksandnumbers', 'marksnos', 'marks'], source: 'marksAndNumbers', transforms: ['text'], maxLength: 512 },
  { key: 'HsCode', label: 'HS Code', headerAliases: ['hscode', 'hs', 'harmonizedcode', 'htscode', 'commoditycode'], source: 'hsCode', transforms: ['text'], maxLength: 12 },
  { key: 'PackageType', label: 'Package Type', headerAliases: ['packagetype', 'packagingtype', 'packagekind', 'kindofpackages', 'pkgtype'], source: 'packageType', transforms: ['text'] },
  { key: 'PackageCount', label: 'Number of Packages', headerAliases: ['numberofpackages', 'noofpackages', 'packagecount', 'packages', 'qty', 'quantity'], source: 'packageCount', transforms: ['integer'] },
  { key: 'GrossWeight', label: 'Gross Weight', headerAliases: ['grossweight', 'grossweightkg', 'weight', 'weightkg', 'cargogrossweight'], source: 'grossWeightKg', transforms: ['weight'] },
];

/** Where the grid lives. Tried in order; the first that resolves to exactly one element wins. */
export const GRID_ROOT_CANDIDATES: InttraSelectorCandidate[] = [
  // Copied from the live DOM on 2026-09-17, off the Copy Container Details
  // modal on ship.inttra.e2open.com: the modal root is
  // #siCopyContainerWrapperDiv and the grid sits in
  // <div id="editableGridWrapper" class="col-sm-12 pushdown10">. The wrapper
  // is not itself the table, so the grid-shaped element inside it is taken;
  // "editableGrid" is also why no cell can be typed into until it is clicked.
  verified('attribute', '#editableGridWrapper table, #editableGridWrapper [role="grid"], #editableGridWrapper [role="treegrid"]', 'Captured from the live INTTRA DOM on 2026-09-17.'),
  verified('attribute', '#siCopyContainerWrapperDiv table, #siCopyContainerWrapperDiv [role="grid"]', 'Captured from the live INTTRA DOM on 2026-09-17: the Copy Container Details modal root.'),
  placeholder('id', '#containerDetailsGrid', 'Placeholder - capture the grid root from the live INTTRA DOM.'),
  placeholder('attribute', "[data-grid='containerDetails'], [aria-label='Container Details' i], [aria-label='Copy Container Details' i]", 'Placeholder - capture the grid root from the live INTTRA DOM.'),
  placeholder('attribute', "table[role='grid'], [role='grid'], [role='treegrid']", 'Structural fallback: any ARIA grid on the page.'),
  placeholder('attribute', 'table.container-grid, table.dataTable, table[class*="grid" i]', 'Structural fallback: a table that calls itself a grid.'),
  placeholder('attribute', 'table', 'Last resort: the only table on the page, if there is exactly one.'),
];

export const GRID_DEVTOOLS_CHECKLIST: string[] = [
  'the grid root element (the outermost <table>, or the element with role="grid")',
  'the header row, with every column heading',
  'one empty data row',
  'one populated data row',
  'a cell while it is being edited (click into it first, then Inspect)',
  'the Container Number cell',
  'the Carrier Seal # cell',
  'the Shipper Seal # cell',
  'the Cargo Description cell',
  'the HS Code cell',
  'the Package Type cell (and, if it is a dropdown, two of its options)',
];

/** The exported-column helpers the UI uses to describe the grid. */
export { byLabel, byNearby };
