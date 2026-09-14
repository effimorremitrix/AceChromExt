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
 * Nothing here is captured from the live DOM. The grid root candidates and
 * the header aliases are guesses; docs/INTTRA-INTEGRATION.md lists the eleven
 * things to copy from DevTools to make them exact.
 */

import type { PackageContainerField } from '../../../shared/src/filingPackage.js';
import type { InttraSelectorCandidate } from '../models/InttraField.js';
import { byLabel, byNearby, placeholder } from './types.js';

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
  { key: 'CarrierSeal', label: 'Carrier Seal #', headerAliases: ['carrierseal', 'carriersealno', 'carriersealnumber', 'sealno', 'sealnumber', 'seal'], source: 'carrierSeal', transforms: ['text', 'upper'], maxLength: 15, expected: true },
  { key: 'ShipperSeal', label: 'Shipper Seal #', headerAliases: ['shipperseal', 'shippersealno', 'shippersealnumber'], source: 'shipperSeal', transforms: ['text', 'upper'], maxLength: 15 },
  { key: 'CargoDescription', label: 'Cargo Description', headerAliases: ['cargodescription', 'descriptionofgoods', 'goodsdescription', 'description'], source: 'cargoDescription', transforms: ['text'], maxLength: 512 },
  { key: 'MarksAndNumbers', label: 'Marks & Numbers', headerAliases: ['marksnumbers', 'marksandnumbers', 'marksnos', 'marks'], source: 'marksAndNumbers', transforms: ['text'], maxLength: 512 },
  { key: 'HsCode', label: 'HS Code', headerAliases: ['hscode', 'hs', 'harmonizedcode', 'htscode', 'commoditycode'], source: 'hsCode', transforms: ['text'], maxLength: 12 },
  { key: 'PackageType', label: 'Package Type', headerAliases: ['packagetype', 'packagingtype', 'packagekind', 'kindofpackages', 'pkgtype'], source: 'packageType', transforms: ['text'] },
  { key: 'PackageCount', label: 'Number of Packages', headerAliases: ['numberofpackages', 'noofpackages', 'packagecount', 'packages', 'qty', 'quantity'], source: 'packageCount', transforms: ['integer'] },
  { key: 'GrossWeight', label: 'Gross Weight', headerAliases: ['grossweight', 'grossweightkg', 'weight', 'weightkg', 'cargogrossweight'], source: 'grossWeightKg', transforms: ['weight'] },
];

/** Where the grid lives. Tried in order; the first that resolves to exactly one element wins. */
export const GRID_ROOT_CANDIDATES: InttraSelectorCandidate[] = [
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
