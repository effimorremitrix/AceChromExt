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
 *
 * Phase 4 adds one more file type: a `filing-package.json`. It is recognised
 * by its extension and contents, never by guessing at bytes, and it lands in
 * the same StoredImport shape with the package carried alongside.
 */

import { MappingError } from '../excel/canonicalMapper.js';
import { ExcelReadError, readWorkbookFile, type RawWorkbook } from '../excel/excelReader.js';
import { loadWorkbook, sourceForWorkbook, SourceError, loadFilingPackageText } from '../sources/index.js';
import type { SourceDescriptor } from '../sources/index.js';
import type { StoredImport } from '../core/messages.js';
import type { AceHelperSettings } from '../core/settings.js';
import { looksLikeFilingPackage } from '../../shared/src/serialize.js';

export interface OpenedWorkbook {
  fileName: string;
  /** Empty for a filing package, which has no sheets. */
  sheetNames: string[];
  /** Which source claimed the file, decided the moment it was opened. */
  source: SourceDescriptor;
  kind: 'workbook' | 'package';
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

/** A .json file, and one that looks like a package rather than any other JSON. */
async function readPackageText(file: File): Promise<string | null> {
  if (!/\.json$/i.test(file.name)) return null;
  const text = await file.text();
  if (!looksLikeFilingPackage(text)) {
    throw new SourceError(`"${file.name}" is a JSON file but not a filing package. Import an ACE workbook (.xlsx) or a filing-package.json.`);
  }
  return text;
}

export function createExcelImporter(): ExcelImporter {
  let workbook: RawWorkbook | null = null;
  let packageText: string | null = null;
  let packageFileName = '';

  return {
    async openFile(file: File): Promise<ImporterResult<OpenedWorkbook>> {
      try {
        workbook = null;
        packageText = await readPackageText(file);
        if (packageText !== null) {
          packageFileName = file.name;
          return {
            ok: true,
            value: {
              fileName: file.name,
              sheetNames: [],
              source: { id: 'filing-package', label: 'Filing package', detail: `${file.name} - read in this browser` },
              kind: 'package',
            },
          };
        }
        workbook = await readWorkbookFile(file);
        return {
          ok: true,
          value: {
            fileName: workbook.fileName,
            sheetNames: [...workbook.sheetNames],
            source: sourceForWorkbook(workbook).describe(workbook),
            kind: 'workbook',
          },
        };
      } catch (error) {
        workbook = null;
        packageText = null;
        return { ok: false, error: describe(error) };
      }
    },

    importSheet(sheetName: string, settings: AceHelperSettings): ImporterResult<StoredImport> {
      if (packageText !== null) {
        try {
          const loaded = loadFilingPackageText(packageText, { settings });
          loaded.shipment.source.fileName = packageFileName || loaded.shipment.source.fileName;
          return {
            ok: true,
            value: {
              shipment: loaded.shipment,
              validation: loaded.validation,
              notes: loaded.notes,
              selectedLine: loaded.selectedLine,
              source: loaded.source,
              package: loaded.package,
              deckhand: loaded.package.shipment
                ? { shipment: loaded.package.shipment, approvedAt: loaded.package.review.approvedAt }
                : null,
            },
          };
        } catch (error) {
          return { ok: false, error: describe(error) };
        }
      }
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
      packageText = null;
      packageFileName = '';
    },
  };
}
