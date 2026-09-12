import { describe, expect, it } from 'vitest';
import { formatNumber, formatWithSeparators, parseNumeric, roundHalfUp } from '../src/ace/transformers/numbers.js';
import {
  detectWeightUnit,
  kilogramsToPounds,
  LB_TO_KG,
  normalizeWeightToKg,
  poundsToKilograms,
} from '../src/ace/transformers/weight.js';
import { excelSerialToDate, normalizeDate } from '../src/ace/transformers/dates.js';
import { cleanText, truncate, upperCase } from '../src/ace/transformers/text.js';
import {
  normalizeCountryCode,
  normalizeEccn,
  normalizeOriginIndicator,
  normalizeScheduleB,
  normalizeShortCode,
  normalizeUom,
  scheduleBDigits,
} from '../src/ace/transformers/codes.js';
import { runTransforms } from '../src/ace/transformers/index.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

describe('numbers', () => {
  it('parses numbers with commas', () => {
    expect(parseNumeric('79,833')).toMatchObject({ ok: true, value: 79833 });
    expect(parseNumeric('1,234,567.89')).toMatchObject({ ok: true, value: 1234567.89 });
  });

  it('cleans formatted currency', () => {
    expect(parseNumeric('$633,600.00')).toMatchObject({ ok: true, value: 633600, currency: true });
    expect(parseNumeric('(1,200.00)')).toMatchObject({ ok: true, value: -1200, negatedByParens: true });
  });

  it('rejects European decimal notation rather than guessing', () => {
    expect(parseNumeric('1.500,00')).toMatchObject({ ok: false });
  });

  it('splits a trailing unit from the number', () => {
    expect(parseNumeric('176,000 lb')).toMatchObject({ ok: true, value: 176000, unit: 'lb' });
    expect(parseNumeric('80268KG')).toMatchObject({ ok: true, value: 80268, unit: 'KG' });
  });

  it('rejects values that are not numbers', () => {
    for (const input of ['', null, undefined, 'N/A', 'abc', true, '12 34', '--5']) {
      expect(parseNumeric(input as unknown)).toMatchObject({ ok: false, value: null });
    }
  });

  it('accepts a real number unchanged', () => {
    expect(parseNumeric(42.5)).toMatchObject({ ok: true, value: 42.5 });
    expect(parseNumeric(Number.NaN)).toMatchObject({ ok: false });
    expect(parseNumeric(Number.POSITIVE_INFINITY)).toMatchObject({ ok: false });
  });

  it('rounds half away from zero without float surprises', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(79832.256, 0)).toBe(79832);
    expect(roundHalfUp(0.0001, 2)).toBe(0);
  });

  it('formats for ACE and for display', () => {
    expect(formatNumber(633600, 2)).toBe('633600.00');
    expect(formatNumber(79833)).toBe('79833');
    expect(formatWithSeparators(633600, 2)).toBe('633,600.00');
    expect(formatWithSeparators(-1234567)).toBe('-1,234,567');
  });
});

describe('weight', () => {
  it('uses the exact international pound', () => {
    expect(LB_TO_KG).toBe(0.45359237);
  });

  it('converts 176000 lb to kg', () => {
    // 176000 * 0.45359237 = 79832.25712 -> 79832 kg for ACE
    expect(poundsToKilograms(176000)).toMatchObject({ kg: 79832 });
    expect(poundsToKilograms(176000, 2).kg).toBe(79832.26);
  });

  it('round-trips kg to lb', () => {
    expect(kilogramsToPounds(79832)).toBe(175999);
  });

  it('detects unit aliases', () => {
    for (const unit of ['kg', 'KG', 'kgs', 'Kilograms', 'kgm']) expect(detectWeightUnit(unit)).toBe('kg');
    for (const unit of ['lb', 'LBS', 'pounds', '#']) expect(detectWeightUnit(unit)).toBe('lb');
    expect(detectWeightUnit('tonnes')).toBe('unknown');
    expect(detectWeightUnit('')).toBe('unknown');
  });

  it('normalizes to kilograms and reports the transformation', () => {
    expect(normalizeWeightToKg(176000, 'lb')).toMatchObject({ kg: 79832, transform: 'lb x 0.45359237' });
    expect(normalizeWeightToKg(80268, 'kg')).toMatchObject({ kg: 80268, transform: null });
  });

  it('assumes kilograms for a unit-less weight, and says so', () => {
    const result = normalizeWeightToKg(80268, '');
    expect(result.kg).toBe(80268);
    expect(result.notes[0]).toMatch(/assumed kilograms/i);
  });

  it('flags an unrecognised unit', () => {
    const result = normalizeWeightToKg(100, 'stone');
    expect(result.kg).toBe(100);
    expect(result.notes[0]).toMatch(/Unrecognised weight unit/i);
  });
});

describe('dates', () => {
  it('normalizes ISO dates', () => {
    expect(normalizeDate('2026-03-12')).toMatchObject({ ok: true, ace: '03/12/2026', iso: '2026-03-12' });
  });

  it('normalizes US dates', () => {
    expect(normalizeDate('3/12/2026')).toMatchObject({ ok: true, ace: '03/12/2026' });
    expect(normalizeDate('03-12-2026')).toMatchObject({ ok: true, ace: '03/12/2026' });
  });

  it('expands a two-digit year and flags the assumption', () => {
    const result = normalizeDate('3/12/26');
    expect(result).toMatchObject({ ok: true, ace: '03/12/2026' });
    expect(result.note).toMatch(/2026/);
  });

  it('normalizes text dates', () => {
    expect(normalizeDate('12 Mar 2026')).toMatchObject({ ok: true, ace: '03/12/2026' });
    expect(normalizeDate('March 12, 2026')).toMatchObject({ ok: true, ace: '03/12/2026' });
  });

  it('reads Excel date serials', () => {
    expect(excelSerialToDate(46093)).toMatchObject({ year: 2026, month: 3, day: 12 });
    expect(normalizeDate(46093)).toMatchObject({ ok: true, ace: '03/12/2026' });
  });

  it('accepts a Date object', () => {
    expect(normalizeDate(new Date(Date.UTC(2026, 2, 12)))).toMatchObject({ ok: true, ace: '03/12/2026' });
  });

  it('rejects impossible and unreadable dates', () => {
    expect(normalizeDate('2026-02-30')).toMatchObject({ ok: false });
    expect(normalizeDate('2026-13-01')).toMatchObject({ ok: false });
    expect(normalizeDate('next tuesday')).toMatchObject({ ok: false });
    expect(normalizeDate('')).toMatchObject({ ok: false });
    expect(normalizeDate(null)).toMatchObject({ ok: false });
  });
});

describe('text', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanText('  SHELLED   ALMONDS \n')).toBe('SHELLED ALMONDS');
  });

  it('strips zero-width characters and neutralises control characters', () => {
    expect(cleanText('AB\u200BCD')).toBe('ABCD');
    expect(cleanText('AB\u0001CD')).toBe('AB CD');
    expect(cleanText('\uFEFFSHELLED ALMONDS')).toBe('SHELLED ALMONDS');
  });

  it('uppercases', () => {
    expect(upperCase(' shelled almonds ')).toBe('SHELLED ALMONDS');
  });

  it('truncates and reports it', () => {
    expect(truncate('abcdef', 3)).toEqual({ value: 'abc', truncated: true });
    expect(truncate('abc', 10)).toEqual({ value: 'abc', truncated: false });
    expect(truncate('abc', undefined)).toEqual({ value: 'abc', truncated: false });
  });
});

describe('codes', () => {
  it('normalizes Schedule B numbers', () => {
    expect(normalizeScheduleB('0802120000')).toMatchObject({ value: '0802.12.0000' });
    expect(normalizeScheduleB('0802.12.0000')).toMatchObject({ value: '0802.12.0000', transform: null });
    expect(normalizeScheduleB('0802 12 0000')).toMatchObject({ value: '0802.12.0000' });
    expect(scheduleBDigits('0802.12.0000')).toBe('0802120000');
  });

  it('flags a Schedule B number of the wrong length rather than guessing', () => {
    const result = normalizeScheduleB('080212');
    expect(result.value).toBe('080212');
    expect(result.note).toMatch(/6 digits/);
  });

  it('normalizes the origin indicator', () => {
    expect(normalizeOriginIndicator('D')).toMatchObject({ value: 'D' });
    expect(normalizeOriginIndicator('domestic')).toMatchObject({ value: 'D' });
    expect(normalizeOriginIndicator('USA')).toMatchObject({ value: 'D' });
    expect(normalizeOriginIndicator('Israel')).toMatchObject({ value: 'F' });
    expect(normalizeOriginIndicator('xx').note).toMatch(/not a recognised/i);
  });

  it('normalizes country codes', () => {
    expect(normalizeCountryCode('il')).toMatchObject({ value: 'IL' });
    expect(normalizeCountryCode('Israel')).toMatchObject({ value: 'IL' });
    expect(normalizeCountryCode('Atlantis').note).toMatch(/not in the local code table/i);
  });

  it('normalizes units of measure', () => {
    expect(normalizeUom('kg')).toMatchObject({ value: 'KG' });
    expect(normalizeUom('Kilograms')).toMatchObject({ value: 'KG' });
    expect(normalizeUom('each')).toMatchObject({ value: 'NO' });
    expect(normalizeUom('widgets').note).toMatch(/not in the local alias table/i);
  });

  it('normalizes ECCNs and short codes', () => {
    expect(normalizeEccn('3a001.a.1')).toMatchObject({ value: '3A001.a.1' });
    expect(normalizeEccn('ear99')).toMatchObject({ value: 'EAR99' });
    expect(normalizeEccn('nope').note).toMatch(/does not look like/i);
    expect(normalizeShortCode(' c33 ')).toMatchObject({ value: 'C33' });
  });
});

describe('runTransforms pipeline', () => {
  const ctx = { settings: DEFAULT_SETTINGS };

  it('formats money without separators', () => {
    expect(runTransforms(633600, ['money'], ctx)).toMatchObject({ text: '633600.00' });
  });

  it('formats a weight to whole kilograms', () => {
    expect(runTransforms(79832.26, ['weight'], ctx)).toMatchObject({ text: '79832' });
  });

  it('formats an ISO date as MM/DD/YYYY', () => {
    expect(runTransforms('2026-03-12', ['date'], ctx)).toMatchObject({ text: '03/12/2026' });
  });

  it('chains transformers', () => {
    expect(runTransforms('  zim shanghai ', ['text', 'upper'], ctx)).toMatchObject({ text: 'ZIM SHANGHAI' });
  });

  it('reports a bad value as an error instead of writing it', () => {
    expect(runTransforms('N/A', ['money'], ctx).error).toMatch(/not a monetary value/i);
  });

  it('reports an unknown transformer name', () => {
    expect(runTransforms('x', ['doesNotExist'], ctx).error).toMatch(/Unknown transformer/i);
  });

  it('passes empty values through untouched', () => {
    expect(runTransforms('', ['money'], ctx)).toMatchObject({ text: '' });
    expect(runTransforms(null, ['date'], ctx)).toMatchObject({ text: '' });
  });
});
