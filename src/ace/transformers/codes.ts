/**
 * Code normalization: Schedule B, country/origin, UOM, ECCN, licence codes.
 *
 * These tables are intentionally small and conservative. Nothing here guesses
 * at a classification: an unrecognised value is passed through with a note so
 * the preview can flag it rather than silently "fixing" it.
 */

import { cleanText, upperCase } from './text.js';

export interface CodeResult {
  value: string;
  transform: string | null;
  note: string | null;
}

function plain(value: string): CodeResult {
  return { value, transform: null, note: null };
}

/**
 * Schedule B / HTS number -> 10 digits, formatted ####.##.####
 * Accepts "0802.12.0000", "0802120000", "0802 12 0000".
 */
export function normalizeScheduleB(input: unknown): CodeResult {
  const text = cleanText(input);
  if (text === '') return plain('');

  const digits = text.replace(/[^0-9]/g, '');

  if (digits.length === 10) {
    const formatted = `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
    return {
      value: formatted,
      transform: formatted === text ? null : 'Schedule B -> ####.##.####',
      note: null,
    };
  }

  return {
    value: text,
    transform: null,
    note: `Schedule B "${text}" has ${digits.length} digits; ACE expects 10. Value left as-is.`,
  };
}

/** Digits-only Schedule B, for ACE inputs that reject the dots. */
export function scheduleBDigits(input: unknown): string {
  return cleanText(input).replace(/[^0-9]/g, '');
}

/**
 * An HS code as INTTRA's box will take it: digits only.
 *
 * The package derives `hsCode` as the first six digits of the Schedule B
 * number, dot included ("0802.12"), because that is how a tariff code is
 * written on paper. The live INTTRA Create Shipping Instruction screen
 * answered that with "Field cannot contain decimal points." on 2026-09-20, so
 * the separators come off at fill time and the canonical value keeps its dot.
 *
 * Only separators are removed. A code with letters in it (some national
 * tariffs have them) keeps them, because dropping a character that is part of
 * the code would be a silent change of value rather than a change of format.
 */
export function hsCodeDigits(input: unknown): CodeResult {
  const text = cleanText(input);
  if (text === '') return plain('');
  const stripped = text.replace(/[.\-\s]/g, '');
  return {
    value: stripped,
    transform: stripped === text ? null : 'Separators removed (INTTRA rejects decimal points in HS Code)',
    note: null,
  };
}

const COUNTRY_NAMES: Record<string, string> = {
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  us: 'US',
  israel: 'IL',
  canada: 'CA',
  mexico: 'MX',
  china: 'CN',
  germany: 'DE',
  india: 'IN',
  italy: 'IT',
  japan: 'JP',
  netherlands: 'NL',
  spain: 'ES',
  'united kingdom': 'GB',
  uk: 'GB',
  turkey: 'TR',
  france: 'FR',
  brazil: 'BR',
};

/**
 * Normalize the ACE "origin of goods" indicator.
 * D = domestic (grown/produced/manufactured in the US), F = foreign.
 */
export function normalizeOriginIndicator(input: unknown): CodeResult {
  const text = cleanText(input);
  if (text === '') return plain('');

  const upper = text.toUpperCase();
  if (upper === 'D' || upper === 'F') return plain(upper);

  const lower = text.toLowerCase();
  if (lower === 'domestic') {
    return { value: 'D', transform: `"${text}" -> D (domestic)`, note: null };
  }
  if (lower === 'foreign') {
    return { value: 'F', transform: `"${text}" -> F (foreign)`, note: null };
  }

  const mapped = COUNTRY_NAMES[lower];
  if (mapped) {
    return {
      value: mapped === 'US' ? 'D' : 'F',
      transform: `"${text}" -> ${mapped === 'US' ? 'D (domestic)' : 'F (foreign)'}`,
      note: mapped === 'US' ? null : `Origin taken as foreign (${mapped}). Confirm the ACE origin indicator.`,
    };
  }

  return {
    value: upper,
    transform: null,
    note: `Origin "${text}" is not a recognised D/F indicator or country. Confirm in ACE.`,
  };
}

/** Country name or code -> ISO 3166-1 alpha-2, used for destination fields. */
export function normalizeCountryCode(input: unknown): CodeResult {
  const text = cleanText(input);
  if (text === '') return plain('');

  if (/^[A-Za-z]{2}$/.test(text)) return plain(text.toUpperCase());

  const mapped = COUNTRY_NAMES[text.toLowerCase()];
  if (mapped) return { value: mapped, transform: `"${text}" -> ${mapped}`, note: null };

  return {
    value: upperCase(text),
    transform: null,
    note: `Country "${text}" is not in the local code table. Confirm in ACE.`,
  };
}

/**
 * US state / territory names -> the two-letter USPS code ACE Step 1 expects.
 *
 * ACE "Origin State" is the state the goods actually come from, not the state
 * of the export port: almonds grown in California and railed to Norfolk file
 * CA, not VA. The dropdown renders "CA - CALIFORNIA", and the field writer
 * already matches an option by its code prefix, so normalising to the code is
 * enough.
 */
const US_STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC', 'washington dc': 'DC', 'washington d c': 'DC',
  'puerto rico': 'PR', 'virgin islands': 'VI', 'us virgin islands': 'VI',
  guam: 'GU', 'american samoa': 'AS', 'northern mariana islands': 'MP',
};

/** The set of codes ACE accepts, used by the validator to flag a typo before a fill. */
export const US_STATE_CODES = new Set(Object.values(US_STATE_NAMES));

/** US state name or code -> two-letter USPS code, for ACE Step 1 Origin State. */
export function normalizeUsState(input: unknown): CodeResult {
  const text = cleanText(input);
  if (text === '') return plain('');

  if (/^[A-Za-z]{2}$/.test(text)) {
    const code = text.toUpperCase();
    if (US_STATE_CODES.has(code)) return plain(code);
    return {
      value: code,
      transform: null,
      note: `Origin State "${text}" is not a US state code. Confirm in ACE.`,
    };
  }

  const mapped = US_STATE_NAMES[text.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()];
  if (mapped) return { value: mapped, transform: `"${text}" -> ${mapped}`, note: null };

  return {
    value: upperCase(text),
    transform: null,
    note: `Origin State "${text}" is not in the local state table. Confirm in ACE.`,
  };
}

/**
 * Unit of measure -> the Schedule B unit abbreviations ACE expects.
 * Only unambiguous aliases are mapped.
 */
const UOM_ALIASES: Record<string, string> = {
  kg: 'KG', kgs: 'KG', kilogram: 'KG', kilograms: 'KG', kgm: 'KG',
  lb: 'LB', lbs: 'LB', pound: 'LB', pounds: 'LB',
  g: 'G', gram: 'G', grams: 'G',
  mt: 'T', tonne: 'T', tonnes: 'T', 'metric ton': 'T', t: 'T',
  no: 'NO', number: 'NO', each: 'NO', ea: 'NO', unit: 'NO', units: 'NO',
  pcs: 'NO', pieces: 'NO', piece: 'NO',
  doz: 'DOZ', dozen: 'DOZ',
  l: 'L', liter: 'L', liters: 'L', litre: 'L', litres: 'L',
  m: 'M', meter: 'M', meters: 'M', metre: 'M', metres: 'M',
  m2: 'M2', sqm: 'M2', 'square meter': 'M2', 'square meters': 'M2',
  m3: 'M3', cbm: 'M3', 'cubic meter': 'M3', 'cubic meters': 'M3',
  x: 'X', 'no quantity required': 'X',
};

/**
 * The unit codes ACE accepts for a Schedule B reporting quantity.
 *
 * Used by the validator to flag "unexpected UOM" *before* a fill, rather than
 * letting ACE reject the line after it is typed. It is deliberately the small
 * set that covers ordinary export lines: an unlisted code is a warning to
 * confirm, never an error, because the Schedule B schedule is longer than this.
 */
export const KNOWN_UOM_CODES: readonly string[] = [
  'KG', 'LB', 'G', 'T', 'NO', 'DOZ', 'L', 'M', 'M2', 'M3', 'X',
  'CM', 'CM2', 'CM3', 'PCS', 'PRS', 'GM', 'CAR', 'CKG', 'BBL', 'GAL',
];

export function isKnownUom(code: unknown): boolean {
  const text = cleanText(code).toUpperCase();
  return text === '' || KNOWN_UOM_CODES.includes(text);
}

export function normalizeUom(input: unknown): CodeResult {
  const text = cleanText(input);
  if (text === '') return plain('');

  const key = text.toLowerCase().replace(/[.]/g, '');
  const mapped = UOM_ALIASES[key];
  if (mapped) {
    return { value: mapped, transform: mapped === text ? null : `"${text}" -> ${mapped}`, note: null };
  }

  const fallback = upperCase(text);
  return {
    value: fallback,
    transform: fallback === text ? null : `"${text}" -> ${fallback}`,
    note: `UOM "${text}" is not in the local alias table. Confirm it matches the Schedule B unit in ACE.`,
  };
}

/** ECCN, e.g. "3a001.a.1" -> "3A001.a.1". Only the category prefix is uppercased. */
export function normalizeEccn(input: unknown): CodeResult {
  const text = cleanText(input);
  if (text === '') return plain('');

  if (/^EAR99$/i.test(text)) {
    return { value: 'EAR99', transform: text === 'EAR99' ? null : `"${text}" -> EAR99`, note: null };
  }

  const match = /^(\d[A-Za-z]\d{3})(.*)$/.exec(text);
  if (!match) {
    return {
      value: upperCase(text),
      transform: null,
      note: `ECCN "${text}" does not look like #A### or EAR99. Confirm in ACE.`,
    };
  }

  const value = `${(match[1] as string).toUpperCase()}${match[2]}`;
  return { value, transform: value === text ? null : `"${text}" -> ${value}`, note: null };
}

/** Licence / export-information codes are short uppercase alphanumerics (e.g. C33, OS). */
export function normalizeShortCode(input: unknown): CodeResult {
  const text = cleanText(input);
  if (text === '') return plain('');
  const value = upperCase(text).replace(/\s+/g, '');
  return { value, transform: value === text ? null : `"${text}" -> ${value}`, note: null };
}
