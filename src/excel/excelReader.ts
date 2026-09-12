/**
 * Local XLSX reading.
 *
 * Everything here runs in the extension page. The workbook bytes never leave
 * the browser: there is no fetch, no upload, no telemetry.
 *
 * Security notes on SheetJS:
 *  - Sheets are read with `header: 1`, i.e. as arrays of arrays. No object is
 *    ever built from sheet-controlled keys, which is what the sheet_to_json
 *    prototype-pollution advisory (GHSA-4r6h-8v6p-xvw6) depends on.
 *  - Only the xlsx/xlsm/xls* spreadsheet types this tool needs are accepted,
 *    and workbooks are size- and row-capped before parsing.
 */

import * as XLSX from 'xlsx';

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 200;

export type RawCell = string | number | boolean | Date | null;

export interface RawSheet {
  name: string;
  /** Row-major grid, exactly as the sheet is laid out. */
  rows: RawCell[][];
}

export interface RawWorkbook {
  fileName: string;
  sheetNames: string[];
  sheets: RawSheet[];
}

export class ExcelReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExcelReadError';
  }
}

/**
 * .xlsx is a ZIP container, so it always starts with "PK\x03\x04".
 *
 * Requiring the magic bytes stops SheetJS from content-sniffing its way into
 * the legacy .xls / dBASE / plain-text parsers, which is both where the ReDoS
 * advisory (GHSA-5pgg-2g8v-p4x9) lives and how arbitrary bytes could otherwise
 * come back as a "sheet" of nonsense.
 */
function isZipContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function assertAcceptableName(fileName: string): void {
  if (!/\.(xlsx|xlsm|xltx)$/i.test(fileName)) {
    throw new ExcelReadError('Choose a .xlsx workbook. Legacy .xls and .csv files are not accepted.');
  }
}

/** Parse workbook bytes into plain arrays. */
export function readWorkbookBytes(bytes: Uint8Array, fileName: string): RawWorkbook {
  if (bytes.byteLength === 0) {
    throw new ExcelReadError('That file is empty.');
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ExcelReadError(`That file is larger than ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`);
  }
  if (!isZipContainer(bytes)) {
    throw new ExcelReadError('That file is not a .xlsx workbook. Save it from Excel as "Excel Workbook (.xlsx)" and try again.');
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: 'array',
      cellDates: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      dense: false,
    });
  } catch (error) {
    throw new ExcelReadError(`That workbook could not be read (${(error as Error).message}).`);
  }

  if (!workbook.SheetNames.length) {
    throw new ExcelReadError('That workbook has no sheets.');
  }

  const sheets: RawSheet[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    // header: 1 -> arrays of arrays. No sheet-controlled object keys.
    const grid = XLSX.utils.sheet_to_json<RawCell[]>(sheet, {
      header: 1,
      raw: true,
      blankrows: false,
      defval: null,
    }) as RawCell[][];

    if (grid.length > MAX_ROWS) {
      throw new ExcelReadError(`Sheet "${name}" has more than ${MAX_ROWS} rows.`);
    }

    const rows = grid.map((row) => (Array.isArray(row) ? row.slice(0, MAX_COLUMNS) : []));
    sheets.push({ name, rows });
  }

  if (!sheets.length) {
    throw new ExcelReadError('That workbook has no readable sheets.');
  }

  return { fileName, sheetNames: sheets.map((sheet) => sheet.name), sheets };
}

/** Read a File chosen through an <input type="file">. */
export async function readWorkbookFile(file: File): Promise<RawWorkbook> {
  assertAcceptableName(file.name);
  if (file.size > MAX_FILE_BYTES) {
    throw new ExcelReadError(`That file is larger than ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`);
  }
  const buffer = await file.arrayBuffer();
  return readWorkbookBytes(new Uint8Array(buffer), file.name);
}

export function sheetByName(workbook: RawWorkbook, name: string | undefined): RawSheet {
  if (name) {
    const found = workbook.sheets.find((sheet) => sheet.name === name);
    if (!found) throw new ExcelReadError(`Sheet "${name}" is not in that workbook.`);
    return found;
  }
  return workbook.sheets[0] as RawSheet;
}
