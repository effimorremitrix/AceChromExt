/**
 * The Phase 1 source, unchanged.
 *
 * A workbook the user filled in from templates/ACE_Import_Template.xlsx, or
 * any spreadsheet whose headers the column dictionary recognises. This is the
 * path that has to keep working with no QuickBooks, no server and no network,
 * so it does the same three things Phase 1's importer did, in the same order,
 * and nothing else.
 *
 * It is also the fallback: `accepts` never returns 0, so a readable workbook
 * always has a source that will take it.
 */

import { mapSheetToCanonical } from '../excel/canonicalMapper.js';
import { sheetByName, type RawWorkbook } from '../excel/excelReader.js';
import { validateShipment } from '../excel/validator.js';
import type {
  SourceDescriptor,
  SourceLoadOptions,
  SourceLoadResult,
  WorkbookDataSource,
} from './InvoiceDataSource.js';

export const EXCEL_SOURCE_ID = 'excel';

export class ExcelSource implements WorkbookDataSource {
  readonly id = 'excel' as const;
  readonly label = 'Excel workbook';
  readonly available = true;

  /** Always 1: the fallback claim, beaten by any source that recognises more. */
  accepts(_workbook: RawWorkbook): number {
    void _workbook;
    return 1;
  }

  describe(workbook: RawWorkbook): SourceDescriptor {
    return {
      id: this.id,
      label: this.label,
      detail: `${workbook.fileName} - read in this browser`,
    };
  }

  load(workbook: RawWorkbook, options: SourceLoadOptions): SourceLoadResult {
    const sheet = sheetByName(workbook, options.sheetName);
    const { shipment, notes } = mapSheetToCanonical(sheet, {
      fileName: workbook.fileName,
      settings: options.settings,
    });
    const validation = validateShipment(shipment);
    return {
      shipment,
      validation,
      notes,
      source: this.describe(workbook),
      selectedLine: shipment.commodities[0]?.line ?? 1,
    };
  }
}
