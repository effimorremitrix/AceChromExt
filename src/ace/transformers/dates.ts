/** Date normalization. ACE date inputs are filed as MM/DD/YYYY. */

export interface NormalizedDate {
  ok: boolean;
  /** MM/DD/YYYY, the ACE input format. */
  ace: string;
  /** YYYY-MM-DD, used internally and in the canonical model. */
  iso: string;
  transform: string | null;
  note: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function fail(note: string): NormalizedDate {
  return { ok: false, ace: '', iso: '', transform: null, note };
}

function build(year: number, month: number, day: number, transform: string | null, note: string | null): NormalizedDate {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return fail('Day or month out of range.');
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return fail('That calendar date does not exist.');
  }
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const yyyy = String(year).padStart(4, '0');
  return { ok: true, ace: `${mm}/${dd}/${yyyy}`, iso: `${yyyy}-${mm}-${dd}`, transform, note };
}

/** Excel serial date (1900 date system) -> calendar date. */
export function excelSerialToDate(serial: number): { year: number; month: number; day: number } | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2958465) return null;
  // Excel's 1900 system treats 1900 as a leap year; serial 60 is the phantom
  // 1900-02-29. Anchoring at 1899-12-30 reproduces Excel for all serials > 60.
  const ms = Math.round(serial) * 86400000;
  const date = new Date(Date.UTC(1899, 11, 30) + ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/**
 * Normalize a date from a spreadsheet cell.
 *
 * Accepts: Date objects, Excel serial numbers, ISO (YYYY-MM-DD), US
 * (M/D/YYYY or M-D-YY), and "12 Mar 2026" / "Mar 12, 2026".
 * Two-digit years resolve to 2000-2099 and are reported as an assumption.
 */
export function normalizeDate(input: unknown): NormalizedDate {
  if (input === null || input === undefined || input === '') return fail('No date given.');

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return fail('Invalid Date value.');
    return build(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate(), null, null);
  }

  if (typeof input === 'number') {
    const parts = excelSerialToDate(input);
    if (!parts) return fail('Not a valid Excel date serial.');
    return build(parts.year, parts.month, parts.day, 'Excel date serial -> MM/DD/YYYY', null);
  }

  const text = String(input).trim();
  if (text === '') return fail('No date given.');

  // Pure digits that look like a serial (Excel exports sometimes stringify them).
  if (/^\d{1,5}$/.test(text)) {
    const parts = excelSerialToDate(Number(text));
    if (!parts) return fail('Not a valid Excel date serial.');
    return build(parts.year, parts.month, parts.day, 'Excel date serial -> MM/DD/YYYY', null);
  }

  // ISO: YYYY-MM-DD or YYYY/MM/DD (optionally with a time part).
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(text);
  if (iso) {
    return build(Number(iso[1]), Number(iso[2]), Number(iso[3]), 'ISO -> MM/DD/YYYY', null);
  }

  // US: M/D/YYYY, M-D-YY, M.D.YYYY
  const us = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (us) {
    const rawYear = Number(us[3]);
    const twoDigit = (us[3] as string).length === 2;
    const year = twoDigit ? 2000 + rawYear : rawYear;
    return build(
      year,
      Number(us[1]),
      Number(us[2]),
      twoDigit ? 'Two-digit year -> 20xx' : null,
      twoDigit ? `Year "${us[3]}" read as ${year}. Confirm before filing.` : null,
    );
  }

  // "12 Mar 2026" / "12-Mar-2026"
  const dmy = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{4})$/.exec(text);
  if (dmy) {
    const month = MONTHS[(dmy[2] as string).toLowerCase()];
    if (!month) return fail(`Unknown month "${dmy[2]}".`);
    return build(Number(dmy[3]), month, Number(dmy[1]), 'Text date -> MM/DD/YYYY', null);
  }

  // "Mar 12, 2026" / "March 12 2026"
  const mdy = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (mdy) {
    const month = MONTHS[(mdy[1] as string).toLowerCase()];
    if (!month) return fail(`Unknown month "${mdy[1]}".`);
    return build(Number(mdy[3]), month, Number(mdy[2]), 'Text date -> MM/DD/YYYY', null);
  }

  return fail(`Could not read "${text}" as a date.`);
}
