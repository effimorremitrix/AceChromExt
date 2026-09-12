/**
 * Raw sheet grid -> canonical shipment model.
 *
 * This stage does *semantic* normalization: units, codes, dates. The output is
 * already ACE-correct in meaning, so nothing downstream has to guess. Every
 * field that was changed on the way in gets a provenance record holding the
 * original cell text and a human-readable description of the transformation,
 * which is what the preview shows as "Original / ACE".
 */

import {
  COMMODITY_FIELDS,
  emptyCommodity,
  emptyInvoice,
  emptyProvenance,
  INVOICE_FIELDS,
  type CanonicalCommodity,
  type CanonicalInvoice,
  type CanonicalShipment,
  type CommodityField,
  type FieldProvenance,
  type InvoiceField,
} from '../models/CanonicalInvoice.js';
import { formatWithSeparators, parseNumeric } from '../ace/transformers/numbers.js';
import { normalizeDate } from '../ace/transformers/dates.js';
import { cleanText } from '../ace/transformers/text.js';
import {
  normalizeCountryCode,
  normalizeEccn,
  normalizeOriginIndicator,
  normalizeScheduleB,
  normalizeShortCode,
  normalizeUom,
} from '../ace/transformers/codes.js';
import { normalizeWeightToKg } from '../ace/transformers/weight.js';
import type { AceHelperSettings } from '../core/settings.js';
import { DEFAULT_SETTINGS } from '../core/settings.js';
import { impliedWeightUnit, specForHeader, type ColumnSpec } from './columnAliases.js';
import type { RawCell, RawSheet } from './excelReader.js';

export interface MapperNote {
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** Spreadsheet row number as the user sees it (1-based, including the header row). */
  sheetRow?: number;
  column?: string;
}

export interface MapResult {
  shipment: CanonicalShipment;
  notes: MapperNote[];
}

export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MappingError';
  }
}

interface HeaderMap {
  /** Column index -> spec. */
  byIndex: Map<number, ColumnSpec>;
  headers: string[];
  unknownHeaders: string[];
  headerRowIndex: number;
}

function cellToText(cell: RawCell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    const iso = normalizeDate(cell);
    return iso.ok ? iso.ace : cell.toISOString();
  }
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  return cleanText(cell);
}

function isBlankRow(row: RawCell[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === '');
}

/**
 * Find the header row: the first row within the first 20 that resolves at
 * least two known columns. Real-world exports often carry a title row or a
 * blank row above the headers.
 */
export function detectHeaderRow(rows: RawCell[][]): HeaderMap {
  const limit = Math.min(rows.length, 20);
  let best: HeaderMap | null = null;

  for (let index = 0; index < limit; index += 1) {
    const row = rows[index];
    if (!row || isBlankRow(row)) continue;

    const byIndex = new Map<number, ColumnSpec>();
    const headers: string[] = [];
    const unknownHeaders: string[] = [];

    row.forEach((cell, columnIndex) => {
      const text = cellToText(cell);
      if (text === '') return;
      headers.push(text);
      const spec = specForHeader(text);
      if (spec) {
        // First occurrence wins; a duplicate header is reported later.
        if (![...byIndex.values()].includes(spec)) byIndex.set(columnIndex, spec);
      } else {
        unknownHeaders.push(text);
      }
    });

    const candidate: HeaderMap = { byIndex, headers, unknownHeaders, headerRowIndex: index };
    if (byIndex.size >= 2) return candidate;
    if (!best || byIndex.size > best.byIndex.size) best = candidate;
  }

  if (!best || best.byIndex.size === 0) {
    throw new MappingError(
      'No recognisable column headers were found. Start from templates/ACE_Import_Template.xlsx, or rename the header row to match it.',
    );
  }
  return best;
}

function provenance(column: string, original: string, transform: string | null, normalized: string): FieldProvenance {
  return { column, original, transform, normalized };
}

interface CellOutcome {
  /** Value for the canonical model. */
  value: string | number | null;
  transform: string | null;
  notes: string[];
  /** Display form of the normalized value, for the preview. */
  normalized: string;
  error?: string;
}

function mapCell(spec: ColumnSpec, cell: RawCell, weightUnitHint: string, settings: AceHelperSettings): CellOutcome {
  const original = cellToText(cell);

  if (original === '') {
    return { value: spec.kind === 'number' || spec.kind === 'money' || spec.kind === 'weight' ? null : '', transform: null, notes: [], normalized: '' };
  }

  switch (spec.kind) {
    case 'text':
      return { value: cleanText(original), transform: null, notes: [], normalized: cleanText(original) };

    case 'code': {
      const result = normalizeShortCode(original);
      return { value: result.value, transform: result.transform, notes: result.note ? [result.note] : [], normalized: result.value };
    }

    case 'scheduleB': {
      const result = normalizeScheduleB(original);
      return { value: result.value, transform: result.transform, notes: result.note ? [result.note] : [], normalized: result.value };
    }

    case 'uom': {
      const result = normalizeUom(original);
      return { value: result.value, transform: result.transform, notes: result.note ? [result.note] : [], normalized: result.value };
    }

    case 'origin': {
      const result = normalizeOriginIndicator(original);
      return { value: result.value, transform: result.transform, notes: result.note ? [result.note] : [], normalized: result.value };
    }

    case 'country': {
      const result = normalizeCountryCode(original);
      return { value: result.value, transform: result.transform, notes: result.note ? [result.note] : [], normalized: result.value };
    }

    case 'eccn': {
      const result = normalizeEccn(original);
      return { value: result.value, transform: result.transform, notes: result.note ? [result.note] : [], normalized: result.value };
    }

    case 'date': {
      const result = normalizeDate(cell);
      if (!result.ok) {
        return { value: '', transform: null, notes: [], normalized: '', error: result.note ?? `"${original}" is not a date.` };
      }
      return {
        value: result.iso,
        transform: result.transform,
        notes: result.note ? [result.note] : [],
        normalized: result.ace,
      };
    }

    case 'number': {
      const parsed = parseNumeric(cell);
      if (!parsed.ok || parsed.value === null) {
        return { value: null, transform: null, notes: [], normalized: '', error: `"${original}" is not a number.` };
      }
      return {
        value: parsed.value,
        transform: parsed.unit ? `Unit "${parsed.unit}" dropped from the number` : null,
        notes: parsed.unit ? [`"${original}" contained the unit "${parsed.unit}"; only the number was imported.`] : [],
        normalized: formatWithSeparators(parsed.value),
      };
    }

    case 'money': {
      const parsed = parseNumeric(cell);
      if (!parsed.ok || parsed.value === null) {
        return { value: null, transform: null, notes: [], normalized: '', error: `"${original}" is not a monetary value.` };
      }
      const transforms: string[] = [];
      if (parsed.currency) transforms.push('Currency symbol removed');
      if (parsed.negatedByParens) transforms.push('Accounting parentheses read as negative');
      if (/,/.test(original)) transforms.push('Thousands separators removed');
      return {
        value: parsed.value,
        transform: transforms.length ? transforms.join('; ') : null,
        notes: parsed.value < 0 ? ['Value is negative. Confirm before filing.'] : [],
        normalized: formatWithSeparators(parsed.value, settings.valueDecimals),
      };
    }

    case 'weight': {
      const parsed = parseNumeric(cell);
      if (!parsed.ok || parsed.value === null) {
        return { value: null, transform: null, notes: [], normalized: '', error: `"${original}" is not a weight.` };
      }
      // Unit precedence: the cell's own suffix, then the row's weight-unit
      // column, then the unit implied by the header name.
      const unit = parsed.unit || weightUnitHint;
      const converted = normalizeWeightToKg(parsed.value, unit, settings.weightDecimals);
      const notes = [...converted.notes];
      if (!unit && settings.assumeWeightIsKg === false) {
        notes.push('Unit-less weight; the "assume kilograms" setting is off, so confirm the unit.');
      }
      return {
        value: converted.kg,
        transform: converted.transform,
        notes,
        normalized: `${formatWithSeparators(converted.kg ?? 0, settings.weightDecimals)} kg`,
      };
    }

    default:
      return { value: cleanText(original), transform: null, notes: [], normalized: cleanText(original) };
  }
}

/** Map one sheet into the canonical model. */
export function mapSheetToCanonical(
  sheet: RawSheet,
  options: { fileName: string; settings?: AceHelperSettings } ,
): MapResult {
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const notes: MapperNote[] = [];
  const header = detectHeaderRow(sheet.rows);

  const invoice: CanonicalInvoice = emptyInvoice();
  const provenanceIndex = emptyProvenance();
  const commodities: CanonicalCommodity[] = [];

  const invoiceSeen = new Map<InvoiceField, { value: string; sheetRow: number }>();
  const weightUnitIndex = [...header.byIndex.entries()].find(([, spec]) => spec.control === 'weightUnit')?.[0];
  const lineIndex = [...header.byIndex.entries()].find(([, spec]) => spec.control === 'line')?.[0];
  const weightHeaderIndex = [...header.byIndex.entries()].find(([, spec]) => spec.field === 'shippingWeight')?.[0];
  const weightHeaderUnit =
    weightHeaderIndex === undefined ? '' : impliedWeightUnit(header.headers.length ? sheet.rows[header.headerRowIndex]?.[weightHeaderIndex] : '');

  if (header.unknownHeaders.length) {
    notes.push({
      severity: 'info',
      message: `Ignored ${header.unknownHeaders.length} unrecognised column(s): ${header.unknownHeaders.join(', ')}.`,
      sheetRow: header.headerRowIndex + 1,
    });
  }

  let nextLine = 1;

  for (let rowIndex = header.headerRowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex];
    if (!row || isBlankRow(row)) continue;

    const sheetRow = rowIndex + 1;

    // Row-level weight unit, if the sheet carries a ShippingWeightUOM column.
    const rowWeightUnit = weightUnitIndex === undefined ? '' : cellToText(row[weightUnitIndex] ?? null);
    const weightHint = rowWeightUnit || weightHeaderUnit;

    // Line number: explicit column wins, otherwise sequential.
    let line = nextLine;
    if (lineIndex !== undefined) {
      const parsed = parseNumeric(row[lineIndex] ?? null);
      if (parsed.ok && parsed.value !== null && Number.isInteger(parsed.value) && parsed.value > 0) {
        line = parsed.value;
      } else if (cellToText(row[lineIndex] ?? null) !== '') {
        notes.push({
          severity: 'warning',
          message: `Line number "${cellToText(row[lineIndex] ?? null)}" is not a positive whole number; used ${line} instead.`,
          sheetRow,
          column: 'Line',
        });
      }
    }

    const commodity = emptyCommodity(line);
    const commodityProvenance: Record<string, FieldProvenance> = {};
    let commodityHasData = false;

    for (const [columnIndex, spec] of header.byIndex.entries()) {
      if (spec.target === 'control') continue;

      const cell = row[columnIndex] ?? null;
      const original = cellToText(cell);
      const outcome = mapCell(spec, cell, weightHint, settings);

      if (outcome.error) {
        notes.push({ severity: 'error', message: outcome.error, sheetRow, column: spec.column });
        continue;
      }
      for (const note of outcome.notes) {
        notes.push({ severity: 'warning', message: note, sheetRow, column: spec.column });
      }

      if (spec.target === 'commodity' && spec.field) {
        const field = spec.field as CommodityField;
        if (!COMMODITY_FIELDS.includes(field)) continue;
        if (original !== '') commodityHasData = true;
        assignCommodity(commodity, field, outcome.value);
        if (original !== '') {
          commodityProvenance[field] = provenance(spec.column, original, outcome.transform, outcome.normalized);
        }
        continue;
      }

      if (spec.target === 'invoice' && spec.field) {
        const field = spec.field as InvoiceField;
        if (!INVOICE_FIELDS.includes(field)) continue;
        const text = outcome.value === null ? '' : String(outcome.value);
        if (text === '') continue;

        const previous = invoiceSeen.get(field);
        if (previous && previous.value !== text) {
          notes.push({
            severity: 'warning',
            message: `${spec.column} differs between rows ("${previous.value}" on row ${previous.sheetRow}, "${text}" on row ${sheetRow}). The first value was kept - one import is one shipment.`,
            sheetRow,
            column: spec.column,
          });
          continue;
        }
        if (!previous) {
          invoiceSeen.set(field, { value: text, sheetRow });
          invoice[field] = text;
          provenanceIndex.invoice[field] = provenance(spec.column, original, outcome.transform, outcome.normalized);
        }
      }
    }

    if (!commodityHasData) {
      notes.push({ severity: 'info', message: 'Row has no commodity data; skipped as a header-only row.', sheetRow });
      continue;
    }

    commodities.push(commodity);
    provenanceIndex.commodities[line] = commodityProvenance;
    nextLine = Math.max(nextLine, line) + 1;
  }

  if (!commodities.length) {
    throw new MappingError('No commodity rows were found below the header row.');
  }

  const duplicates = commodities
    .map((commodity) => commodity.line)
    .filter((line, index, all) => all.indexOf(line) !== index);
  if (duplicates.length) {
    notes.push({
      severity: 'error',
      message: `Duplicate line number(s): ${[...new Set(duplicates)].join(', ')}. Each ACE commodity line must be unique.`,
    });
  }

  return {
    shipment: {
      invoice,
      commodities,
      provenance: provenanceIndex,
      source: {
        fileName: options.fileName,
        sheetName: sheet.name,
        importedAt: new Date().toISOString(),
        rowCount: commodities.length,
        headers: header.headers,
        unknownHeaders: header.unknownHeaders,
      },
    },
    notes,
  };
}

function assignCommodity(commodity: CanonicalCommodity, field: CommodityField, value: string | number | null): void {
  switch (field) {
    case 'quantity1':
    case 'quantity2':
    case 'valueOfGoods':
    case 'shippingWeight':
      commodity[field] = typeof value === 'number' ? value : null;
      return;
    default:
      commodity[field] = value === null ? '' : String(value);
  }
}
