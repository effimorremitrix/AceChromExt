/**
 * Excel import, kept out of the popup bundle.
 *
 * The popup has no Import tab (Chrome closes a popup when a file picker
 * opens), so it has no reason to carry the XLSX parser. The panel injects this
 * implementation into the shared app; the popup passes nothing, and the parser
 * is tree-shaken out of popup.js entirely.
 */

import { mapSheetToCanonical, MappingError } from '../excel/canonicalMapper.js';
import { ExcelReadError, readWorkbookFile, sheetByName, type RawWorkbook } from '../excel/excelReader.js';
import { validateShipment } from '../excel/validator.js';
import type { StoredImport } from '../core/messages.js';
import type { AceHelperSettings } from '../core/settings.js';

export interface OpenedWorkbook {
  fileName: string;
  sheetNames: string[];
}

export type ImporterResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ExcelImporter {
  openFile(file: File): Promise<ImporterResult<OpenedWorkbook>>;
  importSheet(sheetName: string, settings: AceHelperSettings): ImporterResult<StoredImport>;
  reset(): void;
}

function describe(error: unknown): string {
  if (error instanceof ExcelReadError || error instanceof MappingError) return error.message;
  return `Import failed: ${(error as Error).message}`;
}

export function createExcelImporter(): ExcelImporter {
  let workbook: RawWorkbook | null = null;

  return {
    async openFile(file: File): Promise<ImporterResult<OpenedWorkbook>> {
      try {
        workbook = await readWorkbookFile(file);
        return { ok: true, value: { fileName: workbook.fileName, sheetNames: [...workbook.sheetNames] } };
      } catch (error) {
        workbook = null;
        return { ok: false, error: describe(error) };
      }
    },

    importSheet(sheetName: string, settings: AceHelperSettings): ImporterResult<StoredImport> {
      if (!workbook) return { ok: false, error: 'Choose a workbook first.' };
      try {
        const sheet = sheetByName(workbook, sheetName);
        const { shipment, notes } = mapSheetToCanonical(sheet, { fileName: workbook.fileName, settings });
        const validation = validateShipment(shipment);
        return {
          ok: true,
          value: { shipment, validation, notes, selectedLine: shipment.commodities[0]?.line ?? 1 },
        };
      } catch (error) {
        return { ok: false, error: describe(error) };
      }
    },

    reset(): void {
      workbook = null;
    },
  };
}
