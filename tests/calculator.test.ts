import { describe, expect, it } from 'vitest';
import { calculate, formatForAce, formatForDisplay, applyRounding } from '../src/calculator/calculator.js';
import { CalcError, parseExpression, tokenize } from '../src/calculator/parser.js';

const NO_ROUNDING = { mode: 'none', decimals: 0 } as const;

describe('parseExpression - the required cases', () => {
  it('20 * 4 = 80', () => {
    expect(parseExpression('20 * 4')).toBe(80);
  });

  it('10 / 4 = 2.5', () => {
    expect(parseExpression('10 / 4')).toBe(2.5);
  });

  it('(12000 + 3500) / 2 = 7750', () => {
    expect(parseExpression('(12000 + 3500) / 2')).toBe(7750);
  });

  it('79833 * 7.94', () => {
    expect(parseExpression('79833 * 7.94')).toBeCloseTo(633874.02, 6);
  });

  it('633600 / 79833', () => {
    expect(parseExpression('633600 / 79833')).toBeCloseTo(7.9365676, 6);
  });
});

describe('parseExpression - arithmetic', () => {
  it('honours operator precedence', () => {
    expect(parseExpression('2 + 3 * 4')).toBe(14);
    expect(parseExpression('(2 + 3) * 4')).toBe(20);
  });

  it('handles nested parentheses', () => {
    expect(parseExpression('((1 + 2) * (3 + 4)) / 3')).toBe(7);
  });

  it('handles unary minus and plus', () => {
    expect(parseExpression('-5 + 10')).toBe(5);
    expect(parseExpression('10 * -2')).toBe(-20);
    expect(parseExpression('+7')).toBe(7);
    expect(parseExpression('--5')).toBe(5);
  });

  it('handles decimals with and without a leading zero', () => {
    expect(parseExpression('0.5 * 4')).toBe(2);
    expect(parseExpression('.5 * 4')).toBe(2);
    expect(parseExpression('1.25 + 2.75')).toBe(4);
  });

  it('accepts thousands separators between digits', () => {
    expect(parseExpression('79,833 * 2')).toBe(159666);
    expect(parseExpression('1,234,567 + 1')).toBe(1234568);
  });

  it('ignores whitespace', () => {
    expect(parseExpression('  20   *    4  ')).toBe(80);
  });
});

describe('parseExpression - rejections', () => {
  const invalid: Array<[string, string]> = [
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['20 *', 'SYNTAX'],
    ['* 20', 'SYNTAX'],
    ['20 4', 'SYNTAX'],
    ['(20 * 4', 'UNBALANCED_PARENS'],
    ['20 * 4)', 'UNBALANCED_PARENS'],
    ['()', 'UNBALANCED_PARENS'],
    ['1.2.3', 'SYNTAX'],
    ['20 % 4', 'UNSUPPORTED_CHARACTER'],
    ['alert(1)', 'UNSUPPORTED_CHARACTER'],
    ['2 ** 8', 'SYNTAX'],
    ['1e5', 'UNSUPPORTED_CHARACTER'],
    ['Math.max(1,2)', 'UNSUPPORTED_CHARACTER'],
    ['20 / 0', 'DIVIDE_BY_ZERO'],
    ['5 / (3 - 3)', 'DIVIDE_BY_ZERO'],
    ['0 / 0', 'DIVIDE_BY_ZERO'],
  ];

  for (const [expression, code] of invalid) {
    it(`rejects "${expression}" with ${code}`, () => {
      let thrown: unknown;
      try {
        parseExpression(expression);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CalcError);
      expect((thrown as CalcError).code).toBe(code);
    });
  }

  it('never returns NaN or Infinity', () => {
    // 1e308 * 10 would overflow; the tokenizer rejects the exponent form, and
    // an overflow reached by multiplication is caught as NOT_FINITE.
    const huge = '9'.repeat(309);
    expect(() => parseExpression(`${huge} * ${huge}`)).toThrow(CalcError);
  });

  it('does not evaluate code', () => {
    expect(() => parseExpression('constructor')).toThrow(CalcError);
    expect(() => parseExpression('this')).toThrow(CalcError);
    expect(() => parseExpression('1;2')).toThrow(CalcError);
  });
});

describe('tokenize', () => {
  it('rejects a comma that is not a thousands separator', () => {
    expect(() => tokenize('1,')).toThrow(CalcError);
    expect(() => tokenize(',1')).toThrow(CalcError);
  });
});

describe('calculate - rounding and formatting', () => {
  it('returns a result object rather than throwing', () => {
    const result = calculate('20 * 4', NO_ROUNDING);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(80);
      expect(result.insert).toBe('80');
      expect(result.display).toBe('80');
    }
  });

  it('reports errors with a code and a message', () => {
    const result = calculate('20 / 0');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DIVIDE_BY_ZERO');
      expect(result.message).toMatch(/divide by zero/i);
    }
  });

  it('rounds to the configured number of decimals', () => {
    const result = calculate('10 / 3', { mode: 'decimals', decimals: 2 });
    expect(result.ok && result.insert).toBe('3.33');
  });

  it('rounds to whole numbers when configured', () => {
    expect(calculate('176000 * 0.45359237', { mode: 'integer', decimals: 0 }).ok).toBe(true);
    expect(calculate('176000 * 0.45359237', { mode: 'integer', decimals: 0 })).toMatchObject({ insert: '79832' });
  });

  it('keeps full precision when rounding is off', () => {
    expect(calculate('10 / 3', NO_ROUNDING)).toMatchObject({ insert: '3.33333333333' });
  });

  it('strips binary-float noise', () => {
    expect(calculate('0.1 + 0.2', NO_ROUNDING)).toMatchObject({ insert: '0.3' });
  });

  it('rounds half away from zero', () => {
    expect(applyRounding(2.5, { mode: 'integer', decimals: 0 })).toBe(3);
    expect(applyRounding(-2.5, { mode: 'integer', decimals: 0 })).toBe(-3);
    expect(applyRounding(1.005, { mode: 'decimals', decimals: 2 })).toBe(1.01);
  });

  it('inserts plain decimals with no thousands separators', () => {
    const result = calculate('79833 * 7.94', { mode: 'decimals', decimals: 2 });
    expect(result.ok && result.insert).toBe('633874.02');
    expect(result.ok && result.display).toBe('633,874.02');
  });

  it('formats for ACE without separators and for display with them', () => {
    expect(formatForAce(1234567.5)).toBe('1234567.5');
    expect(formatForDisplay(1234567.5)).toBe('1,234,567.5');
    expect(formatForDisplay(-1234)).toBe('-1,234');
  });
});
