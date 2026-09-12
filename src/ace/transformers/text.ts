/** Text hygiene shared by every string field. */

/** Control characters (except tab/newline) that must never reach an ACE input. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** Zero-width and BOM characters that survive copy/paste out of Excel. */
const INVISIBLE_CHARS = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Collapse whitespace, strip zero-width and control characters. */
export function cleanText(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(CONTROL_CHARS, ' ')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function upperCase(input: unknown): string {
  return cleanText(input).toUpperCase();
}

export interface TruncationResult {
  value: string;
  truncated: boolean;
}

export function truncate(value: string, maxLength: number | undefined): TruncationResult {
  if (!maxLength || value.length <= maxLength) return { value, truncated: false };
  return { value: value.slice(0, maxLength).trim(), truncated: true };
}
