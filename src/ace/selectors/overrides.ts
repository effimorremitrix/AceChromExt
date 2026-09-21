/**
 * Verified selectors, installed without a rebuild.
 *
 * The selectors shipped in this folder match the live portal by label wording
 * (Steps 1-3, captured 2026-09-14) but their ids and names are still guesses,
 * and Step 4 is untouched. Turning a label match into an id match is a
 * DevTools job that happens on an operator's machine, not in this repository -
 * and it will happen again every time CBP redeploys the portal.
 *
 * So the fix must not require a developer. This module lets a captured
 * selector be pasted into the panel as JSON and take effect on the next fill:
 *
 *   {
 *     "version": 1,
 *     "capturedAt": "2026-09-24",
 *     "fields": {
 *       "ScheduleB": [{ "strategy": "id", "selector": "#filingForm_scheduleB" }]
 *     }
 *   }
 *
 * Overrides are inserted *ahead* of the built-in candidates and are marked
 * verified, because a human read them off the live DOM. The built-ins stay
 * underneath as a fallback, so a bad paste degrades to today's behaviour
 * instead of breaking the field.
 *
 * The JSON is untrusted input. It is parsed defensively: unknown keys are
 * dropped, `__proto__` is refused, counts and lengths are capped, and an
 * unusable CSS selector is rejected at paste time rather than at fill time.
 */

import type { AceSelectorCandidate, SelectorStrategy } from '../../models/AceField.js';

/** The part of a mapping overrides act on. AceFieldMapping and the INTTRA mapping both satisfy it. */
export interface OverridableField {
  key: string;
  candidates: AceSelectorCandidate[];
  verificationStatus: 'verified' | 'placeholder';
  devtoolsHint?: string;
}

export const OVERRIDES_STORAGE_KEY = 'aceHelper.selectorOverrides';
export const OVERRIDES_VERSION = 1;

/** Guard rails on pasted JSON. Generous, but finite. */
const MAX_FIELDS = 200;
const MAX_CANDIDATES_PER_FIELD = 10;
const MAX_SELECTOR_LENGTH = 500;
const MAX_LABELS = 12;
const MAX_SECTIONS = 4;
/** Notes carry the DevTools capture hint, which is a sentence or two. */
const MAX_NOTE_LENGTH = 600;

const STRATEGIES: SelectorStrategy[] = ['id', 'name', 'attribute', 'label', 'nearby', 'placeholder'];

export interface SelectorOverrides {
  version: number;
  /** Free text: when and against which ACE release these were captured. */
  capturedAt: string;
  /** Keyed by AceFieldMapping.key. */
  fields: Record<string, AceSelectorCandidate[]>;
}

export class OverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverrideError';
  }
}

export function emptyOverrides(): SelectorOverrides {
  return { version: OVERRIDES_VERSION, capturedAt: '', fields: {} };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, where: string, max = MAX_SELECTOR_LENGTH): string {
  if (typeof value !== 'string') throw new OverrideError(`${where} must be a string.`);
  const text = value.trim();
  if (text.length > max) throw new OverrideError(`${where} is longer than ${max} characters.`);
  return text;
}

/**
 * The row token, for a control that repeats once per container.
 *
 * INTTRA's Particulars section gives every control of container N the same
 * `-N` suffix, numbered from 1 upward (captured from the live DOM on
 * 2026-09-20: `cont-num-1`, `carr-seal-1`, `ship-seal-1`). A container-scoped
 * selector may therefore be written once, with `{n}` where the row number
 * goes, and the INTTRA filler substitutes the row before the detector runs
 * (inttra-extension/src/content/filler.ts).
 *
 * Nothing on the ACE side substitutes it: an ACE selector carrying `{n}`
 * simply matches nothing and the next candidate is tried, which is the same
 * thing that happens to any selector ACE has moved on from.
 */
export const ROW_TOKEN = '{n}';

/** `#cont-num-{n}` + row 2 -> `#cont-num-2`. */
export function withRowNumber(selector: string, row: number): string {
  return selector.split(ROW_TOKEN).join(String(row));
}

/**
 * Refuse a selector the browser cannot parse.
 *
 * `doc` is optional so the parser is testable in Node, where there is no
 * document; when it is absent the syntax check is simply skipped and
 * `safeQueryAll` catches the problem at fill time as it always has.
 *
 * The check runs on the row-substituted form, because `{n}` is not valid CSS
 * and a template selector would otherwise be rejected at paste time.
 */
function assertUsableSelector(selector: string, where: string, doc?: Document): void {
  if (selector === '') throw new OverrideError(`${where}.selector must not be empty.`);
  if (!doc) return;
  try {
    doc.querySelector(withRowNumber(selector, 1));
  } catch {
    throw new OverrideError(`${where}.selector is not a valid CSS selector: ${selector}`);
  }
}

function readCandidate(raw: unknown, where: string, doc?: Document): AceSelectorCandidate {
  if (!isPlainObject(raw)) throw new OverrideError(`${where} must be an object.`);

  const strategy = readString(raw['strategy'], `${where}.strategy`, 20) as SelectorStrategy;
  if (!STRATEGIES.includes(strategy)) {
    throw new OverrideError(`${where}.strategy must be one of: ${STRATEGIES.join(', ')}.`);
  }

  // A captured selector is verified by definition: a human read it off the
  // live DOM. That is the whole point of pasting it in.
  const candidate: AceSelectorCandidate = { strategy, verified: true };

  if (strategy === 'label') {
    const labels = raw['labelText'];
    if (!Array.isArray(labels) || labels.length === 0) {
      throw new OverrideError(`${where}.labelText must be a non-empty array of strings for a label selector.`);
    }
    if (labels.length > MAX_LABELS) throw new OverrideError(`${where}.labelText has more than ${MAX_LABELS} entries.`);
    candidate.labelText = labels.map((label, index) => readString(label, `${where}.labelText[${index}]`, 200));
    const sections = raw['section'];
    if (sections !== undefined) {
      if (!Array.isArray(sections) || sections.length === 0) {
        throw new OverrideError(`${where}.section must be a non-empty array of panel headings when present.`);
      }
      if (sections.length > MAX_SECTIONS) throw new OverrideError(`${where}.section has more than ${MAX_SECTIONS} entries.`);
      candidate.section = sections.map((heading, index) => readString(heading, `${where}.section[${index}]`, 200));
    }
  } else if (strategy === 'placeholder') {
    const text = readString(raw['placeholder'] ?? raw['selector'], `${where}.placeholder`, 200);
    if (text === '') throw new OverrideError(`${where}.placeholder must not be empty.`);
    candidate.placeholder = text;
  } else {
    const selector = readString(raw['selector'], `${where}.selector`);
    assertUsableSelector(selector, where, doc);
    candidate.selector = selector;
    if (strategy === 'nearby' && raw['within'] !== undefined) {
      const within = readString(raw['within'], `${where}.within`);
      assertUsableSelector(within, `${where}.within`, doc);
      candidate.within = within;
    }
  }

  if (raw['note'] !== undefined) candidate.note = readString(raw['note'], `${where}.note`, MAX_NOTE_LENGTH);
  return candidate;
}

/** Parse untrusted JSON text (or an already-parsed value) into overrides. */
export function parseOverrides(input: unknown, doc?: Document): SelectorOverrides {
  let value: unknown = input;
  if (typeof input === 'string') {
    if (input.trim() === '') return emptyOverrides();
    try {
      value = JSON.parse(input);
    } catch (error) {
      throw new OverrideError(`That is not valid JSON: ${(error as Error).message}`);
    }
  }

  if (value === null || value === undefined) return emptyOverrides();
  if (!isPlainObject(value)) throw new OverrideError('Selector overrides must be a JSON object.');

  const version = value['version'];
  if (version !== undefined && version !== OVERRIDES_VERSION) {
    throw new OverrideError(`Unsupported override version ${String(version)}; this build reads version ${OVERRIDES_VERSION}.`);
  }

  const fieldsRaw = value['fields'];
  if (fieldsRaw === undefined) return { ...emptyOverrides(), capturedAt: readOptionalString(value['capturedAt']) };
  if (!isPlainObject(fieldsRaw)) throw new OverrideError('"fields" must be an object keyed by ACE field key.');

  const entries = Object.entries(fieldsRaw);
  if (entries.length > MAX_FIELDS) throw new OverrideError(`More than ${MAX_FIELDS} fields in one override file.`);

  const fields: Record<string, AceSelectorCandidate[]> = Object.create(null) as Record<string, AceSelectorCandidate[]>;
  for (const [key, raw] of entries) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
      throw new OverrideError(`"${key}" is not a valid ACE field key.`);
    }
    if (!Array.isArray(raw)) throw new OverrideError(`fields."${key}" must be an array of selector candidates.`);
    if (raw.length > MAX_CANDIDATES_PER_FIELD) {
      throw new OverrideError(`fields."${key}" has more than ${MAX_CANDIDATES_PER_FIELD} candidates.`);
    }
    fields[key] = raw.map((candidate, index) => readCandidate(candidate, `fields."${key}"[${index}]`, doc));
  }

  return { version: OVERRIDES_VERSION, capturedAt: readOptionalString(value['capturedAt']), fields };
}

function readOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}

/**
 * Apply overrides to a set of mappings.
 *
 * Overrides go first, the built-ins stay behind them, and the mapping's
 * verificationStatus becomes 'verified' for any field that got one - which is
 * what makes the diagnostics panel stop asking for that field to be captured.
 */
export function applyOverrides<T extends OverridableField>(mappings: T[], overrides: SelectorOverrides | null): T[] {
  if (!overrides || !Object.keys(overrides.fields).length) return mappings;
  return mappings.map((mapping) => {
    const extra = overrides.fields[mapping.key];
    if (!extra || !extra.length) return mapping;
    return {
      ...mapping,
      candidates: [...extra, ...mapping.candidates],
      verificationStatus: 'verified' as const,
    };
  });
}

/** Field keys the overrides claim but no mapping uses; surfaced as a warning. */
export function unknownOverrideKeys(mappings: OverridableField[], overrides: SelectorOverrides | null): string[] {
  if (!overrides) return [];
  const known = new Set(mappings.map((mapping) => mapping.key));
  return Object.keys(overrides.fields).filter((key) => !known.has(key));
}

export function serializeOverrides(overrides: SelectorOverrides): string {
  return `${JSON.stringify(overrides, null, 2)}\n`;
}

/**
 * Does this field already hold a selector copied from the live DOM?
 *
 * An id, name or attribute query that was really copied off the portal, which
 * is a different thing from a captured LABEL wording: a label was read off the
 * screen and is worth keeping, but it cannot name a row and it is not what the
 * capture procedure asks for. The one definition of "already captured", used
 * by the starter template and by `fieldsWithoutCapturedSelector`.
 */
export function hasCapturedSelector(field: OverridableField): boolean {
  return field.candidates.some(
    (candidate) => candidate.verified === true && (candidate.strategy === 'id' || candidate.strategy === 'name' || candidate.strategy === 'attribute'),
  );
}

/**
 * A starter file listing every field that still needs capturing, so the
 * operator edits rather than composes. `unresolved` comes from a diagnostics
 * run: fields the helper could not find on the page the operator is looking at.
 *
 * A field whose selector was ALREADY captured is left out. Printing
 * `#REPLACE_WITH_THE_ID_FROM_INTTRA_FOR_ShipperSeal` over a build that ships
 * `#ship-seal-{n}`, captured from the live DOM on 2026-09-20, reads as the
 * capture never landed, and it did: the operator said so on 2026-09-21,
 * looking at that exact box. The template is the work that is LEFT.
 *
 * `unresolved` still wins where it is given, and that is the point of it: a
 * captured selector that did not resolve on the screen in front of the
 * operator is precisely the one worth capturing again.
 */
export function starterOverrides(mappings: OverridableField[], unresolved?: string[], portal = 'ACE'): SelectorOverrides {
  const wanted = unresolved && unresolved.length ? new Set(unresolved) : null;
  const fields: Record<string, AceSelectorCandidate[]> = {};
  for (const mapping of mappings) {
    if (wanted ? !wanted.has(mapping.key) : hasCapturedSelector(mapping)) continue;
    fields[mapping.key] = [
      {
        strategy: 'id',
        selector: `#REPLACE_WITH_THE_ID_FROM_${portal}_FOR_${mapping.key}`,
        verified: true,
        note: mapping.devtoolsHint ?? `Capture from the live ${portal} DOM.`,
      },
    ];
  }
  return { version: OVERRIDES_VERSION, capturedAt: new Date().toISOString().slice(0, 10), fields };
}
