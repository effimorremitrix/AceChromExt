/**
 * The pre-fill data quality gate.
 *
 * The preview already shows every field with a traffic light, which is the
 * right thing to read carefully and the wrong thing to read in a hurry. This
 * is the hurried version: ten named checks, each pass / check / fail, shown
 * directly above the Fill buttons so nobody types a filing off a spreadsheet
 * with a blank Schedule B and finds out from ACE.
 *
 * It reports; it does not block. Fill stays available because a field with an
 * error is skipped by the filler anyway - the operator may legitimately want
 * the eight good fields typed while they go and find the ninth. What is not
 * acceptable is filling without having been told, and that is what this fixes.
 *
 * Every check is derived from `validateShipment`, which the QuickBooks
 * companion also calls, so there is exactly one place where an AES rule lives.
 */

import type { MapperNote } from '../excel/canonicalMapper.js';
import { COLUMN_SPECS } from '../excel/columnAliases.js';
import type { ValidationIssue, ValidationResult } from '../excel/validator.js';
import type { CanonicalShipment } from '../models/CanonicalInvoice.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface PreflightCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface PreflightResult {
  checks: PreflightCheck[];
  /** Issues that stop a field being written. */
  blocking: ValidationIssue[];
  warnings: ValidationIssue[];
  /** True when nothing is failing. Warnings do not clear this flag. */
  ready: boolean;
  /** Lines that have at least one blocking issue. */
  linesWithErrors: number[];
}

/** Which canonical fields feed which named check, in the order they are shown. */
const CHECK_DEFINITIONS: Array<{ id: string; label: string; fields: string[] }> = [
  { id: 'required', label: 'Required values present', fields: ['invoiceNumber', 'customerName', 'commodities', 'description'] },
  { id: 'numbers', label: 'Numbers are valid', fields: ['quantity1', 'quantity2'] },
  { id: 'amounts', label: 'Amounts are positive', fields: ['valueOfGoods'] },
  { id: 'weights', label: 'Weights are present and non-zero', fields: ['shippingWeight'] },
  { id: 'scheduleB', label: 'Schedule B on every line', fields: ['scheduleB'] },
  { id: 'origin', label: 'Origin on every line', fields: ['origin'] },
  { id: 'licence', label: 'License code on every line', fields: ['licenseCode', 'eccn'] },
  { id: 'dates', label: 'Dates are valid', fields: ['invoiceDate', 'paymentDueDate'] },
  { id: 'uom', label: 'Units of measure recognised', fields: ['uom1', 'uom2'] },
  { id: 'columns', label: 'All columns mapped', fields: ['unmappedColumns'] },
  { id: 'lines', label: 'Commodity lines are distinct', fields: ['line', 'containerNumber', 'destination'] },
];

/**
 * Spreadsheet column -> the canonical field it feeds.
 *
 * Import notes name the column ("InvoiceDate"), validation issues name the
 * canonical field ("invoiceDate"). Both describe the same box, so the gate
 * translates one into the other rather than showing two vocabularies.
 */
const FIELD_FOR_COLUMN: Map<string, string> = new Map(
  COLUMN_SPECS.filter((spec) => spec.field !== undefined).map((spec) => [spec.column.toLowerCase(), spec.field as string]),
);

/**
 * Import notes, as issues.
 *
 * A cell the mapper could not read - "the third of never" in InvoiceDate -
 * never reaches the canonical model, so `validateShipment` sees an empty field
 * and reports a mild "no date". That is the wrong severity for a value the
 * operator typed and believes is there. Folding the mapper's own errors in is
 * what makes "invalid dates" fail rather than shrug.
 */
function issuesFromNotes(notes: MapperNote[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const note of notes) {
    if (note.severity === 'info') continue;
    const column = (note.column ?? '').trim();
    const field = FIELD_FOR_COLUMN.get(column.toLowerCase());
    if (!field) continue;
    issues.push({
      severity: note.severity === 'error' ? 'error' : 'warning',
      scope: 'shipment',
      field,
      label: column,
      message: `${column}: ${note.message}`,
    });
  }
  return issues;
}

function describe(issues: ValidationIssue[]): string {
  const first = issues[0];
  if (!first) return '';
  const where = first.line === undefined ? '' : `line ${first.line}: `;
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
  return `${where}${first.message}${more}`;
}

export function buildPreflight(
  shipment: CanonicalShipment,
  validation: ValidationResult,
  notes: MapperNote[] = [],
): PreflightResult {
  const checks: PreflightCheck[] = [];
  const all = [...validation.issues, ...issuesFromNotes(notes)];

  for (const definition of CHECK_DEFINITIONS) {
    const relevant = all.filter((issue) => definition.fields.includes(issue.field));
    const errors = relevant.filter((issue) => issue.severity === 'error');
    const warnings = relevant.filter((issue) => issue.severity === 'warning');

    if (errors.length) {
      checks.push({ id: definition.id, label: definition.label, status: 'fail', detail: describe(errors) });
    } else if (warnings.length) {
      checks.push({ id: definition.id, label: definition.label, status: 'warn', detail: describe(warnings) });
    } else {
      checks.push({
        id: definition.id,
        label: definition.label,
        status: 'pass',
        detail: `${shipment.commodities.length} line(s) checked`,
      });
    }
  }

  const blocking = all.filter((issue) => issue.severity === 'error');
  const warnings = all.filter((issue) => issue.severity === 'warning');

  return {
    checks,
    blocking,
    warnings,
    ready: blocking.length === 0,
    linesWithErrors: validation.linesWithErrors,
  };
}

/** One line for the status bar and the session log. */
export function summarizePreflight(result: PreflightResult): string {
  if (result.ready && !result.warnings.length) return 'All data quality checks passed.';
  const parts: string[] = [];
  if (result.blocking.length) parts.push(`${result.blocking.length} blocking issue(s)`);
  if (result.warnings.length) parts.push(`${result.warnings.length} to review`);
  return `Data quality: ${parts.join(', ')}. Fields with a blocking issue are skipped, never guessed.`;
}
