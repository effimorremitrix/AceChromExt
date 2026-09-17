/**
 * Generates templates/ACE_Import_Template.xlsx.
 *
 * Three sheets (the data lives in scripts/templateData.mjs, shared with the
 * Quickfill playground):
 *   Shipment   - the import sheet: one row per ACE commodity line
 *   Example    - the same layout filled in with the worked example
 *   Instructions - column-by-column notes, including which values ACE expects
 *
 * Run: npm run template
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

import { COLUMNS, EXAMPLE_ROWS, INSTRUCTIONS } from './templateData.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function autoWidths(rows, columns) {
  return columns.map((column) => {
    const longest = rows.reduce((max, row) => {
      const value = row[column];
      const length = value === undefined || value === null ? 0 : String(value).length;
      return Math.max(max, length);
    }, column.length);
    return { wch: Math.min(Math.max(longest + 2, 10), 34) };
  });
}

const workbook = XLSX.utils.book_new();

// Sheet 1: empty import sheet (header row only).
const shipmentSheet = XLSX.utils.aoa_to_sheet([COLUMNS]);
shipmentSheet['!cols'] = COLUMNS.map((column) => ({ wch: Math.min(Math.max(column.length + 2, 12), 30) }));
shipmentSheet['!freeze'] = { xSplit: 0, ySplit: 1 };
XLSX.utils.book_append_sheet(workbook, shipmentSheet, 'Shipment');

// Sheet 2: the worked example.
const exampleSheet = XLSX.utils.json_to_sheet(EXAMPLE_ROWS, { header: COLUMNS });
exampleSheet['!cols'] = autoWidths(EXAMPLE_ROWS, COLUMNS);
XLSX.utils.book_append_sheet(workbook, exampleSheet, 'Example');

// Sheet 3: instructions.
const instructionsSheet = XLSX.utils.aoa_to_sheet(INSTRUCTIONS);
instructionsSheet['!cols'] = [{ wch: 34 }, { wch: 110 }];
XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');

const outPath = join(root, 'templates', 'ACE_Import_Template.xlsx');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
console.log(`wrote ${outPath}`);
