/**
 * Generates templates/ACE_Import_Template.xlsx.
 *
 * Three sheets:
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

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const COLUMNS = [
  'Line',
  'ExportInformationCode',
  'ScheduleB',
  'CommodityDescription',
  'Quantity1',
  'UOM1',
  'Quantity2',
  'UOM2',
  'Origin',
  'ValueOfGoods',
  'ShippingWeight',
  'ShippingWeightUOM',
  'ECCN',
  'LicenseCode',
  'CustomerName',
  'InvoiceNumber',
  'InvoiceDate',
  'BillTo',
  'BillToAddress2',
  'BillToCity',
  'BillToState',
  'BillToPostalCode',
  'BillToCountry',
  'OriginState',
  'FreightTerms',
  'PaymentTerms',
  'PaymentDueDate',
  'PONumber',
  'Carrier',
  'Vessel',
  'BookingNumber',
  'ContainerNumber',
  'SealNumber',
  'Destination',
];

const EXAMPLE_ROWS = [
  {
    Line: 1,
    ExportInformationCode: 'OS',
    ScheduleB: '0802.12.0000',
    CommodityDescription: 'SHELLED ALMONDS',
    Quantity1: 79833,
    UOM1: 'KG',
    Quantity2: '',
    UOM2: '',
    Origin: 'D',
    ValueOfGoods: 633600,
    ShippingWeight: 176000,
    ShippingWeightUOM: 'lb',
    ECCN: 'EAR99',
    LicenseCode: 'C33',
    CustomerName: 'MEDITERRANEAN FOODS LTD',
    InvoiceNumber: 'INV-20451',
    InvoiceDate: '2026-03-12',
    BillTo: '14 HARBOUR ROAD',
    BillToAddress2: 'PORT INDUSTRIAL ZONE',
    BillToCity: 'HAIFA',
    BillToState: '',
    BillToPostalCode: '3303201',
    BillToCountry: 'IL',
    OriginState: 'CA',
    FreightTerms: 'CIF',
    PaymentTerms: 'NET 30',
    PaymentDueDate: '2026-04-11',
    PONumber: 'PO-88213',
    Carrier: 'ZIM INTEGRATED SHIPPING',
    Vessel: 'ZIM SHANGHAI',
    BookingNumber: 'BKG-5541220',
    ContainerNumber: 'ZIMU1234567',
    SealNumber: 'SL-99401',
    Destination: 'IL',
  },
  {
    Line: 2,
    ExportInformationCode: 'OS',
    ScheduleB: '0813.20.0000',
    CommodityDescription: 'DRIED PRUNES, PACKED',
    Quantity1: 12400,
    UOM1: 'KG',
    Quantity2: '',
    UOM2: '',
    Origin: 'D',
    ValueOfGoods: 48360,
    ShippingWeight: 12850,
    ShippingWeightUOM: 'kg',
    ECCN: 'EAR99',
    LicenseCode: 'C33',
    CustomerName: '',
    InvoiceNumber: '',
    InvoiceDate: '',
    BillTo: '',
    BillToAddress2: '',
    BillToCity: '',
    BillToState: '',
    BillToPostalCode: '',
    BillToCountry: '',
    OriginState: '',
    FreightTerms: '',
    PaymentTerms: '',
    PaymentDueDate: '',
    PONumber: '',
    Carrier: '',
    Vessel: '',
    BookingNumber: '',
    ContainerNumber: '',
    SealNumber: '',
    Destination: '',
  },
];

const INSTRUCTIONS = [
  ['ACE Helper - import template', ''],
  ['', ''],
  ['How to use', 'Fill in the "Shipment" sheet: one row per ACE commodity line. Shipment-level columns only need to be filled on the first row.'],
  ['Do not rename the header row', 'Column names are matched case- and punctuation-insensitively, and common aliases are accepted (Qty1, HTS, Consignee, ...).'],
  ['Extra columns', 'Unrecognised columns are ignored and listed in the import notes.'],
  ['Nothing is uploaded', 'The workbook is parsed inside your browser by the extension. No shipment data leaves the machine.'],
  ['', ''],
  ['Column', 'Notes'],
  ['Line', 'ACE commodity line number. Optional - rows are numbered in order when it is left out.'],
  ['ExportInformationCode', 'AES Export Information Code, e.g. OS.'],
  ['ScheduleB', 'Schedule B / HTS number. 0802.12.0000 or 0802120000 both work; 10 digits are required.'],
  ['CommodityDescription', 'Plain-language description. ACE truncates at 45 characters; the preview warns first.'],
  ['Quantity1', 'First quantity, matching the Schedule B unit. Commas and units in the cell are handled.'],
  ['UOM1', 'Unit of measure for Quantity1, e.g. KG, NO, DOZ. Aliases (kg, kilograms, each, pcs) are normalized.'],
  ['Quantity2 / UOM2', 'Second quantity and unit, only for Schedule B numbers that require one.'],
  ['Origin', 'D for domestic (grown/produced/manufactured in the US) or F for foreign. "Domestic"/"USA"/a country name are converted.'],
  ['ValueOfGoods', 'Value in USD. $, commas, and accounting parentheses are cleaned up.'],
  ['ShippingWeight', 'Gross weight. Put the unit in ShippingWeightUOM, or in the cell ("176,000 lb").'],
  ['ShippingWeightUOM', 'kg or lb. Pounds are converted with kg = lb x 0.45359237 and rounded to whole kilograms. Left empty, the value is taken as kilograms.'],
  ['ECCN', 'Export Control Classification Number, or EAR99.'],
  ['LicenseCode', 'AES licence code or exemption, e.g. C33.'],
  ['CustomerName', 'Ultimate consignee company name (ACE Parties step, Ultimate Consignee panel).'],
  ['InvoiceNumber', 'Becomes the ACE Shipment Reference Number (17 characters maximum).'],
  ['InvoiceDate', 'YYYY-MM-DD, MM/DD/YYYY, or a real Excel date. Filed as the ACE Departure Date, MM/DD/YYYY.'],
  ['BillTo', 'Consignee street address, line 1 (ACE "Address Line 1").'],
  ['BillToAddress2', 'Consignee address, line 2. Optional.'],
  ['BillToCity', 'Consignee city.'],
  ['BillToState', 'Consignee state or province code. Only needed for countries that have them (US, CA, MX).'],
  ['BillToPostalCode', 'Consignee postal code. Only needed for countries that require one.'],
  ['BillToCountry', 'Consignee country, ISO 3166-1 alpha-2 (TR, IL, DE). Common country names are converted.'],
  ['OriginState', 'ACE Step 1 Origin State: the US state the goods COME FROM, not the state of the export port. Almonds railed from northern California to Norfolk are CA, not VA. Two-letter code; state names are converted.'],
  ['FreightTerms', 'INCO terms / terms of sale, e.g. CIF, FOB. Carried for reference; the ACE Shipment step has no such field.'],
  ['PaymentTerms / PaymentDueDate', 'Carried for reference and for the QuickBooks phase; not filed in AES.'],
  ['PONumber', 'Customer purchase order. Carried for reference; the ACE Shipment step has no such field.'],
  ['Carrier / Vessel / BookingNumber', 'Transportation step values.'],
  ['ContainerNumber / SealNumber', 'Container and seal, ISO 6346 format for the container (4 letters + 7 digits).'],
  ['Destination', 'ACE Country of Destination, ISO 3166-1 alpha-2 (IL, CA, DE). Common country names are converted.'],
  ['', ''],
  ['Reminder', 'ACE Helper never saves a line, submits, or certifies a filing. Review every populated field in ACE and submit it yourself.'],
];

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
