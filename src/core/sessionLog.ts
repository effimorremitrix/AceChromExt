/**
 * The session log.
 *
 * One question this tool has to be able to answer: "ACE has the wrong weight
 * on line 2 - where did that come from?" The preview answers it before a fill;
 * afterwards, nothing did. This log does.
 *
 *   20:01  import     Loaded ACE_Invoice_CN-1042.xlsx - 1 line, QuickBooks export
 *   20:02  transform  Line 1 ShippingWeight: 176000 lb -> 79832 kg (lb x 0.45359237)
 *   20:03  fill       Shipment page: filled 4, skipped 1, warnings 0
 *   20:05  fill       Commodity line 1: filled 10, warnings 2
 *
 * Three rules, and they are the reason this is safe to keep:
 *
 *  1. **It stays here.** chrome.storage.session is memory-backed, is not
 *     written to disk by the extension, and is gone when the browser closes.
 *     Nothing is ever uploaded - the extension has no network permission and
 *     scripts/check-bundle.mjs fails the build if one appears.
 *  2. **No credentials, ever.** ACE Helper never sees an ACE, Login.gov or
 *     QuickBooks credential, and `append` refuses any entry whose text looks
 *     like one (see SECRET_PATTERNS) rather than relying on that.
 *  3. **Export is a user action.** "Copy diagnostics" and "Export diagnostics"
 *     put the log where the user asked for it, and nowhere else.
 */

export type SessionLogKind =
  | 'import'
  | 'transform'
  | 'fill'
  | 'diagnostics'
  | 'selectors'
  | 'calculator'
  | 'clear'
  | 'note';

export interface SessionLogEntry {
  /** ISO timestamp. */
  at: string;
  kind: SessionLogKind;
  message: string;
  /** Optional second line: a report summary, a transformation, a reason. */
  detail?: string;
}

export const SESSION_LOG_KEY = 'aceHelper.sessionLog';
/** Enough for a long filing session; old entries fall off the front. */
export const MAX_LOG_ENTRIES = 400;
const MAX_TEXT = 400;

/**
 * Shapes that must never reach the log even by accident.
 *
 * The extension has no path to a credential, so this is belt-and-braces: it
 * catches a future caller that logs something it should not, rather than
 * catching today's code.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bpassword\b/i,
  /\bpasswd\b/i,
  /\bsecret\b/i,
  /\bapi[-_ ]?key\b/i,
  /\bbearer\s+[A-Za-z0-9._-]{8,}/i,
  /\bauthorization\b/i,
  /\bsession[-_ ]?(id|token)\b/i,
  /\btoken\b/i,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function trim(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean;
}

export function makeEntry(kind: SessionLogKind, message: string, detail?: string): SessionLogEntry | null {
  const text = trim(message);
  const extra = detail === undefined ? undefined : trim(detail);
  if (text === '') return null;
  if (looksLikeSecret(text) || (extra !== undefined && looksLikeSecret(extra))) {
    return {
      at: new Date().toISOString(),
      kind: 'note',
      message: 'An entry was refused because it matched a credential pattern.',
    };
  }
  return { at: new Date().toISOString(), kind, message: text, ...(extra === undefined ? {} : { detail: extra }) };
}

/** Append with the cap applied. Pure, so the trimming rule is testable. */
export function appendEntry(log: SessionLogEntry[], entry: SessionLogEntry | null): SessionLogEntry[] {
  if (!entry) return log;
  const next = [...log, entry];
  return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
}

function sessionArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.session ?? null;
}

export async function readLog(): Promise<SessionLogEntry[]> {
  const area = sessionArea();
  if (!area) return [];
  const bag = await area.get(SESSION_LOG_KEY);
  const value = bag[SESSION_LOG_KEY];
  return Array.isArray(value) ? (value as SessionLogEntry[]) : [];
}

export async function writeLog(entries: SessionLogEntry[]): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.set({ [SESSION_LOG_KEY]: entries });
}

export async function logEvent(kind: SessionLogKind, message: string, detail?: string): Promise<void> {
  const entry = makeEntry(kind, message, detail);
  if (!entry) return;
  await writeLog(appendEntry(await readLog(), entry));
}

export async function clearLog(): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.remove(SESSION_LOG_KEY);
}

function clockTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toTimeString().slice(0, 8);
}

/** The log as the plain text "Copy diagnostics" puts on the clipboard. */
export function formatLog(entries: SessionLogEntry[], heading?: string): string {
  const lines: string[] = [];
  if (heading) {
    lines.push(heading);
    lines.push('ACE filing: current browser session. Nothing here was uploaded anywhere.');
    lines.push('');
  }
  if (!entries.length) {
    lines.push('(no activity recorded in this session)');
    return lines.join('\n');
  }
  for (const entry of entries) {
    lines.push(`${clockTime(entry.at)}  ${entry.kind.padEnd(11)} ${entry.message}`);
    if (entry.detail) lines.push(`${' '.repeat(21)} ${entry.detail}`);
  }
  return lines.join('\n');
}
