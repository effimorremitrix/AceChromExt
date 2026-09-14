/** Source registry. The only place that decides which source reads a workbook. */

import { readWorkbookBytes, readWorkbookFile, type RawWorkbook } from '../excel/excelReader.js';
import type { SourceLoadOptions, SourceLoadResult, WorkbookDataSource } from './InvoiceDataSource.js';
import { ExcelSource } from './ExcelSource.js';
import { QuickBooksExportSource } from './QuickBooksExportSource.js';
import { WebSource } from './WebSource.js';
import { FilingPackageSource } from './FilingPackageSource.js';

export type { InvoiceDataSource, SourceDescriptor, SourceId, SourceLoadOptions, SourceLoadResult, WorkbookDataSource } from './InvoiceDataSource.js';
export { SourceError } from './InvoiceDataSource.js';
export { ExcelSource } from './ExcelSource.js';
export { QuickBooksExportSource } from './QuickBooksExportSource.js';
export { WebSource } from './WebSource.js';
export { FilingPackageSource, loadFilingPackageText, type FilingPackageLoadResult } from './FilingPackageSource.js';

/**
 * Order matters only for ties. QuickBooksExportSource scores 2 when it sees
 * the companion's Audit sheet; ExcelSource always scores 1 and therefore
 * always wins when nothing more specific claims the file.
 */
export const WORKBOOK_SOURCES: WorkbookDataSource[] = [new QuickBooksExportSource(), new ExcelSource()];

export const ALL_SOURCES = [...WORKBOOK_SOURCES, new FilingPackageSource(), new WebSource()];

export function sourceForWorkbook(workbook: RawWorkbook): WorkbookDataSource {
  let best: WorkbookDataSource = WORKBOOK_SOURCES[WORKBOOK_SOURCES.length - 1] as WorkbookDataSource;
  let bestScore = 0;
  for (const source of WORKBOOK_SOURCES) {
    const score = source.accepts(workbook);
    if (score > bestScore) {
      best = source;
      bestScore = score;
    }
  }
  return best;
}

export function loadWorkbook(workbook: RawWorkbook, options: SourceLoadOptions): SourceLoadResult {
  return sourceForWorkbook(workbook).load(workbook, options);
}

/** Read a chosen file and load it through whichever source claims it. */
export async function loadFromFile(file: File, options: SourceLoadOptions): Promise<SourceLoadResult> {
  return loadWorkbook(await readWorkbookFile(file), options);
}

/** Same, from bytes. Used by the end-to-end test, which has no File object. */
export function loadFromBytes(bytes: Uint8Array, fileName: string, options: SourceLoadOptions): SourceLoadResult {
  return loadWorkbook(readWorkbookBytes(bytes, fileName), options);
}
