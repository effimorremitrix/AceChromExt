/**
 * The invoice data-source seam, inside the extension.
 *
 * Phase 1 had exactly one way into the canonical model: a spreadsheet the user
 * picked. Phase 2 added a second producer (the QuickBooks companion), and it
 * produced *the same spreadsheet*, which was the right call but left the
 * extension unable to say where a file came from.
 *
 * This interface is the seam. Every source, whatever it reads, produces a
 * `CanonicalShipment` and nothing else. That is the whole contract:
 *
 *   ExcelSource             a workbook the user filled in by hand   (Phase 1)
 *   QuickBooksExportSource  a workbook the companion wrote          (Phase 2)
 *   WebSource               a future hosted hand-off                (not built)
 *
 * Backward-compatibility rule, and it is not negotiable: ExcelSource must keep
 * behaving exactly as the Phase 1 importer did. The registry may *identify* a
 * workbook as QuickBooks-produced and label it so, but identification never
 * changes how the rows are parsed - both sources run the same reader, the same
 * canonical mapper and the same validator. A QuickBooks workbook opened by
 * ExcelSource yields a byte-identical canonical model.
 *
 * Nothing in this folder may import from `companion/`, open a socket, or
 * require a server: the extension stands alone, as it did in Phase 1.
 */

import type { AceHelperSettings } from '../core/settings.js';
import type { MapperNote } from '../excel/canonicalMapper.js';
import type { RawWorkbook } from '../excel/excelReader.js';
import type { ValidationResult } from '../excel/validator.js';
import type { CanonicalShipment } from '../models/CanonicalInvoice.js';

export type SourceId = 'excel' | 'quickbooks-export' | 'web';

/** What produced the data now in the panel. Shown in the UI and the session log. */
export interface SourceDescriptor {
  id: SourceId;
  /** Short name, e.g. "Excel workbook". */
  label: string;
  /** One line of provenance, e.g. the companion build that wrote the file. */
  detail: string;
}

export interface SourceLoadOptions {
  settings: AceHelperSettings;
  /** Sheet to read. Defaults to the first sheet, as Phase 1 always did. */
  sheetName?: string;
}

export interface SourceLoadResult {
  shipment: CanonicalShipment;
  validation: ValidationResult;
  notes: MapperNote[];
  source: SourceDescriptor;
  /** 1-based ACE commodity line pre-selected for "Fill Current Commodity Line". */
  selectedLine: number;
}

/** Any producer of the canonical model. */
export interface InvoiceDataSource<TInput = unknown> {
  readonly id: SourceId;
  readonly label: string;
  /**
   * False for a source that is declared but not built. A declared-unavailable
   * source is listed in the UI as unavailable rather than quietly missing -
   * the same convention the rest of this project uses for mock connectors.
   */
  readonly available: boolean;
  load(input: TInput, options: SourceLoadOptions): SourceLoadResult;
}

/**
 * A source that reads an already-parsed workbook.
 *
 * Parsing happens once, in `src/excel/excelReader.ts`, before any source sees
 * the bytes: a source must never get a second chance to interpret raw input,
 * because two parsers is how two behaviours start.
 */
export interface WorkbookDataSource extends InvoiceDataSource<RawWorkbook> {
  /**
   * How strongly this source claims the workbook. 0 means "not mine".
   * The highest score wins; ExcelSource always returns 1, so it is the
   * fallback that can never fail to claim a readable workbook.
   */
  accepts(workbook: RawWorkbook): number;
  describe(workbook: RawWorkbook): SourceDescriptor;
}

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}
