/** Numeric parsing and formatting. Pure functions, no DOM. */

/**
 * Round half-away-from-zero at `decimals` places, avoiding the binary-float
 * surprises of Math.round(x * 100) / 100.
 */
export function roundHalfUp(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  const scaled = value * factor;
  // toFixed on the scaled value removes representation error such as
  // 1.005 * 100 === 100.49999999999999 before rounding.
  const corrected = Number(scaled.toFixed(6));
  const rounded = corrected < 0 ? -Math.round(-corrected) : Math.round(corrected);
  const result = rounded / factor;
  return Object.is(result, -0) ? 0 : result;
}

export interface ParsedNumber {
  ok: boolean;
  value: number | null;
  /** Trailing unit text found after the number, e.g. "lb" in "176,000 lb". */
  unit: string;
  /** True when the source carried a currency symbol or accounting parentheses. */
  currency: boolean;
  /** True when accounting notation, e.g. "(1,200.00)", made the value negative. */
  negatedByParens: boolean;
}

const CURRENCY_SYMBOLS = /[$£¥€₪]/g;

/**
 * Parse a spreadsheet-ish number: "79,833", "$633,600.00", "(1,200.00)",
 * "176,000 lb", "1 234,56" is NOT supported (ambiguous) and is rejected.
 */
export function parseNumeric(input: unknown): ParsedNumber {
  const fail: ParsedNumber = { ok: false, value: null, unit: '', currency: false, negatedByParens: false };

  if (input === null || input === undefined || input === '') return fail;
  if (typeof input === 'number') {
    return Number.isFinite(input)
      ? { ok: true, value: input, unit: '', currency: false, negatedByParens: false }
      : fail;
  }
  if (typeof input === 'boolean') return fail;

  let text = String(input).trim();
  if (text === '') return fail;

  const currency = CURRENCY_SYMBOLS.test(text);
  CURRENCY_SYMBOLS.lastIndex = 0;
  text = text.replace(CURRENCY_SYMBOLS, '').trim();

  let negatedByParens = false;
  if (/^\(.*\)$/.test(text)) {
    negatedByParens = true;
    text = text.slice(1, -1).trim();
  }

  // Split a leading numeric part from a trailing unit ("176,000 lb", "80268KG").
  const match = /^([+-]?[\d,]*\.?\d+)\s*([A-Za-z/%.]*)$/.exec(text);
  if (!match) return { ...fail, currency, negatedByParens };

  const numericPart = (match[1] as string).replace(/,/g, '');
  const unit = (match[2] as string).trim();

  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(numericPart)) return { ...fail, currency, negatedByParens };

  let value = Number(numericPart);
  if (!Number.isFinite(value)) return { ...fail, currency, negatedByParens };
  if (negatedByParens) value = -value;

  return { ok: true, value, unit, currency, negatedByParens };
}

/** Plain decimal string, no separators - what ACE numeric inputs accept. */
export function formatNumber(value: number, decimals?: number): string {
  if (!Number.isFinite(value)) return '';
  if (decimals === undefined) {
    return String(Object.is(value, -0) ? 0 : value);
  }
  return roundHalfUp(value, decimals).toFixed(decimals);
}

/** Thousands-grouped string for previews and summaries only. */
export function formatWithSeparators(value: number, decimals?: number): string {
  if (!Number.isFinite(value)) return '';
  const base = decimals === undefined ? String(value) : roundHalfUp(value, decimals).toFixed(decimals);
  const [whole, fraction] = base.split('.');
  const sign = (whole as string).startsWith('-') ? '-' : '';
  const digits = (whole as string).replace('-', '');
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}
