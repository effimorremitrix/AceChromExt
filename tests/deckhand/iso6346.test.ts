/**
 * ISO 6346 container numbers.
 *
 * Migrated from the previous Deckhand implementation's unit tests and kept
 * whole: every check digit in the product depends on this file.
 */

import { describe, expect, it } from 'vitest';
import { containerCheckDigit, normalizeContainerNumber, validateContainerNumber, withCheckDigit } from '../../deckhand/src/iso6346.js';

describe('ISO 6346', () => {
  it('computes the published check digit', () => {
    // The worked example from the standard itself.
    expect(containerCheckDigit('CSQU305438')).toBe(3);
    expect(withCheckDigit('CSQU305438')).toBe('CSQU3054383');
  });

  it('skips every multiple of 11 in the letter values', () => {
    // K=21 then L=23 (22 skipped), U=32 then V=34 (33 skipped). Any drift here
    // changes every check digit, so pin it with prefixes that differ only there.
    expect(containerCheckDigit('KKKU000000')).not.toBe(containerCheckDigit('LLLU000000'));
    expect(containerCheckDigit('UUUU000000')).not.toBe(containerCheckDigit('VVVU000000'));
  });

  it('accepts the freight category identifiers and rejects the rest', () => {
    for (const category of ['U', 'J', 'Z']) {
      expect(validateContainerNumber(withCheckDigit(`ABC${category}123456`))).toBe('valid');
    }
    expect(validateContainerNumber('ABCD1234561')).toBe('malformed');
  });

  it('normalizes the spacing and punctuation people actually type', () => {
    const canonical = withCheckDigit('MSKU123456');
    expect(normalizeContainerNumber(`${canonical.slice(0, 4)} ${canonical.slice(4, 10)} ${canonical.slice(10)}`)).toBe(canonical);
    expect(normalizeContainerNumber(`msku-123456-${canonical[10]}`)).toBe(canonical);
    expect(normalizeContainerNumber(`  ${canonical}  `)).toBe(canonical);
  });

  it('reports a wrong check digit as invalid, not malformed, and never corrects it', () => {
    const valid = withCheckDigit('TGHU765432');
    const broken = valid.slice(0, 10) + String((Number(valid[10]) + 1) % 10);
    expect(validateContainerNumber(valid)).toBe('valid');
    expect(validateContainerNumber(broken)).toBe('invalid');
    expect(normalizeContainerNumber(broken)).toBe(broken);
  });

  it('calls anything that is not the ISO 6346 shape malformed', () => {
    for (const raw of ['', 'MSKU12345', 'MSKU12345678', '1234567890X', 'M5KU1234567', 'MSKU123456A', 'SEAL-99871', 'MSKUABCDEFG']) {
      expect(validateContainerNumber(raw), raw || '(empty)').toBe('malformed');
    }
    // Internal spacing is normalized away, so this is a real number with a bad
    // check digit, not a malformed one.
    expect(validateContainerNumber('MSK U1234567')).toBe('invalid');
  });

  it('always yields a single digit, folding a remainder of 10 to 0', () => {
    const seen = new Set<number>();
    for (let index = 0; index < 500; index += 1) {
      const digit = containerCheckDigit(`MSKU${String(index).padStart(6, '0')}`);
      expect(digit).toBeGreaterThanOrEqual(0);
      expect(digit).toBeLessThanOrEqual(9);
      seen.add(digit);
    }
    expect(seen.has(0)).toBe(true);
  });

  it('refuses a prefix that is not 4 letters and 6 digits', () => {
    expect(() => containerCheckDigit('MSKU12345')).toThrow(/Not a container prefix/);
    expect(() => containerCheckDigit('MSK123456X')).toThrow(/Not a container prefix/);
  });
});
