/**
 * Calculator facade: expression -> rounded, ACE-safe result string.
 */

import { CalcError, parseExpression, type CalcErrorCode } from './parser.js';
import { roundHalfUp } from '../ace/transformers/numbers.js';

export interface RoundingOptions {
  /**
   * 'none'     - keep the full result, trimmed of float noise.
   * 'decimals' - round half-up to `decimals` places.
   * 'integer'  - round half-up to a whole number.
   */
  mode: 'none' | 'decimals' | 'integer';
  decimals: number;
}

export const DEFAULT_ROUNDING: RoundingOptions = { mode: 'decimals', decimals: 2 };

export type CalcResult =
  | { ok: true; value: number; display: string; insert: string }
  | { ok: false; code: CalcErrorCode; message: string; position: number | null };

/**
 * Strip binary-float noise (0.30000000000000004) without changing the value
 * in any way a customs filer would care about.
 */
export function cleanFloat(value: number): number {
  const cleaned = Number(value.toPrecision(12));
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

export function applyRounding(value: number, rounding: RoundingOptions): number {
  switch (rounding.mode) {
    case 'integer':
      return roundHalfUp(value, 0);
    case 'decimals':
      return roundHalfUp(value, rounding.decimals);
    case 'none':
    default:
      return cleanFloat(value);
  }
}

/** Plain decimal string with no thousands separators - ACE numeric inputs reject those. */
export function formatForAce(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

/** Grouped display string for the calculator readout only (never inserted into ACE). */
export function formatForDisplay(value: number): string {
  const [whole, fraction] = formatForAce(value).split('.');
  const sign = (whole as string).startsWith('-') ? '-' : '';
  const digits = (whole as string).replace('-', '');
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}

export function calculate(input: string, rounding: RoundingOptions = DEFAULT_ROUNDING): CalcResult {
  try {
    const raw = parseExpression(input);
    const value = applyRounding(raw, rounding);
    if (!Number.isFinite(value)) {
      return { ok: false, code: 'NOT_FINITE', message: 'The result is not a finite number.', position: null };
    }
    return {
      ok: true,
      value,
      display: formatForDisplay(value),
      insert: formatForAce(value),
    };
  } catch (error) {
    if (error instanceof CalcError) {
      return { ok: false, code: error.code, message: error.message, position: error.position };
    }
    return { ok: false, code: 'SYNTAX', message: 'That expression could not be evaluated.', position: null };
  }
}
