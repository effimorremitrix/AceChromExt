/**
 * Fill-time transformer registry.
 *
 * Division of labour:
 *  - IMPORT time (src/excel/canonicalMapper.ts) does *semantic* normalization:
 *    unit conversion, code formatting, date parsing. The canonical model is
 *    therefore already ACE-correct in meaning.
 *  - FILL time (this registry) does *presentation*: turning a canonical value
 *    into the exact string an ACE input accepts, applying per-field rounding
 *    and casing.
 *
 * Both stages call the same pure functions in this folder, so a rule is only
 * ever written once. Mappings reference transformers by name, which keeps the
 * mapping layer declarative and data-only.
 */

import type { AceHelperSettings } from '../../core/settings.js';
import { formatNumber, parseNumeric, roundHalfUp } from './numbers.js';
import { normalizeDate } from './dates.js';
import { cleanText, upperCase } from './text.js';
import {
  normalizeCountryCode,
  normalizeEccn,
  normalizeOriginIndicator,
  normalizeScheduleB,
  normalizeShortCode,
  normalizeUom,
  scheduleBDigits,
} from './codes.js';

export interface TransformContext {
  settings: AceHelperSettings;
  /** Canonical value before any fill-time transform. */
  canonical: unknown;
}

export interface TransformOutput {
  text: string;
  transform: string | null;
  notes: string[];
  /** Set when the value cannot be presented at all; the field is then skipped. */
  error?: string;
}

export type Transformer = (input: string, ctx: TransformContext) => TransformOutput;

function out(text: string, transform: string | null = null, notes: string[] = []): TransformOutput {
  return { text, transform, notes };
}

function numeric(input: string, decimals: number | null, label: string): TransformOutput {
  if (input.trim() === '') return out('');
  const parsed = parseNumeric(input);
  if (!parsed.ok || parsed.value === null) {
    return { text: '', transform: null, notes: [], error: `"${input}" is not a ${label}.` };
  }
  const value = decimals === null ? parsed.value : roundHalfUp(parsed.value, decimals);
  const text = formatNumber(value, decimals ?? undefined);
  const changed = text !== input;
  return out(text, changed ? `${label} normalized to plain decimal` : null);
}

export const TRANSFORMERS: Record<string, Transformer> = {
  /** Whitespace/control-character hygiene. Applied to every text field. */
  text: (input) => out(cleanText(input)),

  upper: (input) => {
    const value = upperCase(input);
    return out(value, value === input ? null : 'Uppercased');
  },

  /** Plain decimal, no thousands separators (ACE numeric inputs reject commas). */
  number: (input, ctx) => numeric(input, ctx.settings.quantityDecimals, 'number'),

  integer: (input) => numeric(input, 0, 'whole number'),

  /** Monetary value: currency symbols and separators stripped. */
  money: (input, ctx) => {
    if (input.trim() === '') return out('');
    const parsed = parseNumeric(input);
    if (!parsed.ok || parsed.value === null) {
      return { text: '', transform: null, notes: [], error: `"${input}" is not a monetary value.` };
    }
    const value = roundHalfUp(parsed.value, ctx.settings.valueDecimals);
    const text = formatNumber(value, ctx.settings.valueDecimals);
    const notes = parsed.value < 0 ? ['Value is negative. Confirm before filing.'] : [];
    return out(text, parsed.currency || text !== input ? 'Currency cleanup' : null, notes);
  },

  /**
   * ACE's Value of Goods box is labelled "whole US Dollars": currency cleanup
   * as `money`, then rounded half-up to a whole number regardless of the
   * value-decimals setting (which still governs the preview).
   */
  wholeDollars: (input) => {
    if (input.trim() === '') return out('');
    const parsed = parseNumeric(input);
    if (!parsed.ok || parsed.value === null) {
      return { text: '', transform: null, notes: [], error: `"${input}" is not a monetary value.` };
    }
    const text = formatNumber(roundHalfUp(parsed.value, 0), 0);
    const notes = parsed.value < 0 ? ['Value is negative. Confirm before filing.'] : [];
    return out(text, parsed.currency || text !== input ? 'Whole US dollars' : null, notes);
  },

  /** Quantity: kept as imported unless a decimal setting says otherwise. */
  quantity: (input, ctx) => numeric(input, ctx.settings.quantityDecimals, 'quantity'),

  /** Shipping weight: whole kilograms by default. Conversion happened at import. */
  weight: (input, ctx) => numeric(input, ctx.settings.weightDecimals, 'weight'),

  /** ISO or loose date -> MM/DD/YYYY. */
  date: (input) => {
    if (input.trim() === '') return out('');
    const normalized = normalizeDate(input);
    if (!normalized.ok) {
      return { text: '', transform: null, notes: [], error: normalized.note ?? 'Invalid date.' };
    }
    return out(
      normalized.ace,
      normalized.ace === input ? null : normalized.transform ?? 'Formatted as MM/DD/YYYY',
      normalized.note ? [normalized.note] : [],
    );
  },

  scheduleB: (input) => {
    const result = normalizeScheduleB(input);
    return out(result.value, result.transform, result.note ? [result.note] : []);
  },

  /** For ACE inputs that only accept the 10 digits with no separators. */
  scheduleBDigits: (input) => {
    const digits = scheduleBDigits(input);
    return out(digits, digits === input ? null : 'Separators removed');
  },

  origin: (input) => {
    const result = normalizeOriginIndicator(input);
    return out(result.value, result.transform, result.note ? [result.note] : []);
  },

  country: (input) => {
    const result = normalizeCountryCode(input);
    return out(result.value, result.transform, result.note ? [result.note] : []);
  },

  uom: (input) => {
    const result = normalizeUom(input);
    return out(result.value, result.transform, result.note ? [result.note] : []);
  },

  eccn: (input) => {
    const result = normalizeEccn(input);
    return out(result.value, result.transform, result.note ? [result.note] : []);
  },

  code: (input) => {
    const result = normalizeShortCode(input);
    return out(result.value, result.transform, result.note ? [result.note] : []);
  },
};

/** Run a named transformer pipeline. Unknown names are reported, never ignored. */
export function runTransforms(
  value: unknown,
  names: string[] | undefined,
  ctx: Omit<TransformContext, 'canonical'>,
): TransformOutput {
  const context: TransformContext = { ...ctx, canonical: value };
  let text = value === null || value === undefined ? '' : String(value);
  const transforms: string[] = [];
  const notes: string[] = [];

  for (const name of names ?? ['text']) {
    const transformer = TRANSFORMERS[name];
    if (!transformer) {
      return { text: '', transform: null, notes, error: `Unknown transformer "${name}" in the field mapping.` };
    }
    const result = transformer(text, context);
    if (result.error) {
      return { text: '', transform: transforms.join('; ') || null, notes, error: result.error };
    }
    text = result.text;
    if (result.transform) transforms.push(result.transform);
    notes.push(...result.notes);
  }

  return { text, transform: transforms.length ? transforms.join('; ') : null, notes };
}
