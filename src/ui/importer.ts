/**
 * Import, kept out of the popup bundle.
 *
 * The popup has no Import tab (Chrome closes a popup when a file picker
 * opens), so it has no reason to carry the XLSX parser. The panel injects this
 * implementation into the shared app; the popup passes nothing, and the parser
 * is tree-shaken out of popup.js entirely.
 *
 * Since Phase 3 this is a thin shell over `src/sources`: the workbook is read
 * once and handed to whichever `InvoiceDataSource` claims it. The Phase 1
 * behaviour is unchanged - ExcelSource is the fallback and runs the same
 * mapper and validator this file used to call directly.
 */

import { MappingError } from '../excel/canonicalMapper.js';
import { ExcelReadError, readWorkbookFile, type RawWorkbook } from '../excel/excelReader.js';
import { loadWorkbook, sourceForWorkbook, SourceError } from '../sources/index.js';
import type { SourceDescriptor } from '../sources/index.js';
import type { StoredImport } from '../core/messages.js';
import type { AceHelperSettings } from '../core/settings.js';

export interface OpenedWorkbook {
  fileName: string;
  sheetNames: string[];
  /** Which source claimed the file, decided the moment it was opened. */
  source: SourceDescriptor;
}

export type ImporterResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ExcelImporter {
  openFile(file: File): Promise<ImporterResult<OpenedWorkbook>>;
  importSheet(sheetName: string, settings: AceHelperSettings): ImporterResult<StoredImport>;
  reset(): void;
}

function describe(error: unknown): string {
  if (error instanceof ExcelReadError || error instanceof MappingError || error instanceof SourceError) {
    return error.message;
  }
  return `Import failed: ${(error as Error).message}`;
}

export function createExcelImporter(): ExcelImporter {
  let workbook: RawWorkbook | null = null;

  return {
    async openFile(file: File): Promise<ImporterResult<OpenedWorkbook>> {
      try {
        workbook = await readWorkbookFile(file);
        return {
          ok: true,
          value: {
            fileName: workbook.fileName,
            sheetNames: [...workbook.sheetNames],
            source: sourceForWorkbook(workbook).describe(workbook),
          },
        };
      } catch (error) {
        workbook = null;
        return { ok: false, error: describe(error) };
      }
    },

    importSheet(sheetName: string, settings: AceHelperSettings): ImporterResult<StoredImport> {
      if (!workbook) return { ok: false, error: 'Choose a workbook first.' };
      try {
        const loaded = loadWorkbook(workbook, { settings, sheetName });
        return {
          ok: true,
          value: {
            shipment: loaded.shipment,
            validation: loaded.validation,
            notes: loaded.notes,
            selectedLine: loaded.selectedLine,
            source: loaded.source,
          },
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
