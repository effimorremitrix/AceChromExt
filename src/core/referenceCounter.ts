/**
 * The Shipment Reference Number counter.
 *
 * ACE Step 1 wants a Shipment Reference Number, and the filer's is a single
 * running integer kept outside the system (it stood at 4087 on 2026-09-16).
 * This is that integer, kept here instead, and it is the one piece of operator
 * state the extension owns: not shipment data, not derived from a filing, so
 * it lives in `chrome.storage.local` beside the settings rather than in
 * `chrome.storage.session`.
 *
 * ## Why it reserves instead of incrementing
 *
 * The filer's rule (2026-09-16) is that the sequence may have NO GAPS and
 * never resets. That rules out the obvious design - hand out `last + 1` and
 * advance immediately - because every abandoned draft would burn a number and
 * leave a hole.
 *
 * So the counter hands out a number and does not advance until it is told the
 * filing actually happened:
 *
 *   lastFiled: 4087, reserved: null   -> next is 4088
 *   fill Step 1                       -> writes 4088, reserved: 4088
 *   fill Step 1 again, new draft,     -> writes 4088 again. Same number,
 *     browser restarted, whatever        because nothing was filed yet.
 *   markFiled()                       -> lastFiled: 4088, reserved: null
 *                                        next is 4089
 *
 * Gaps are therefore impossible by construction, which is what was asked for.
 * The cost is the mirror risk: if a filing goes through and nobody says so,
 * the next shipment is handed the same number again. That is why `reserved` is
 * surfaced in the panel rather than hidden - a number in use is visible, with
 * the button that retires it - and why `markFiled` is a deliberate act.
 *
 * Auto-confirming from the page was considered and not built. The ACE header
 * reads "Export Filing (Filer ID ..., ITN TBD)" before certification, so the
 * ITN appearing is the real signal, but the certified header has never been
 * captured and guessing its wording would be the kind of unverified selector
 * this codebase refuses to ship. See docs/ACE-MAPPING.md.
 */

/** Stored shape. Both numbers are plain integers; nothing here identifies a shipment. */
export interface ReferenceCounter {
  /** The highest number that has actually been filed. 0 means "never used". */
  lastFiled: number;
  /** Handed out but not yet confirmed as filed. Null when nothing is in flight. */
  reserved: number | null;
  /** True once the operator has set a starting point, so the panel stops prompting. */
  configured: boolean;
}

export const DEFAULT_COUNTER: ReferenceCounter = { lastFiled: 0, reserved: null, configured: false };

const STORAGE_KEY = 'aceHelper.referenceCounter';

/** ACE's Shipment Reference Number box is maxlength 17; the sequence is far below that. */
export const MAX_REFERENCE = 999_999_999;

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
}

function wholeNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const whole = Math.floor(value);
  if (whole < 0 || whole > MAX_REFERENCE) return fallback;
  return whole;
}

/** Shape-check whatever came out of storage. Anything unrecognisable falls back to the default. */
export function mergeCounter(stored: unknown): ReferenceCounter {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_COUNTER };
  const input = stored as Partial<ReferenceCounter>;
  const lastFiled = wholeNumber(input.lastFiled, DEFAULT_COUNTER.lastFiled);
  const reserved =
    input.reserved === null || input.reserved === undefined ? null : wholeNumber(input.reserved, lastFiled + 1);
  return {
    lastFiled,
    // A reservation at or below lastFiled is stale - it was already filed - so
    // it is dropped rather than handed out a second time.
    reserved: reserved !== null && reserved > lastFiled ? reserved : null,
    configured: input.configured === true,
  };
}

/**
 * The number to write into ACE next.
 *
 * The reservation if there is one, otherwise the next in sequence. Pure, so
 * the panel and the filler always agree without a round trip to storage.
 */
export function nextReference(counter: ReferenceCounter): number {
  return counter.reserved ?? counter.lastFiled + 1;
}

/** ACE takes the reference as text. Kept as plain digits: no padding, no prefix. */
export function formatReference(value: number): string {
  return String(value);
}

/** Take the next number without advancing the sequence. Idempotent while a reservation stands. */
export function reserve(counter: ReferenceCounter): ReferenceCounter {
  if (counter.reserved !== null) return counter;
  return { ...counter, reserved: counter.lastFiled + 1 };
}

/**
 * Retire the reserved number: it is on a filing that exists.
 *
 * This is the only thing that advances the sequence. With nothing reserved it
 * does nothing, so a double click cannot skip a number.
 */
export function markFiled(counter: ReferenceCounter): ReferenceCounter {
  if (counter.reserved === null) return counter;
  return { lastFiled: counter.reserved, reserved: null, configured: true };
}

/**
 * Give the reservation back unused.
 *
 * For the draft that was abandoned: the number returns to the pool and the
 * next fill hands out the same one. The sequence never moves, so this cannot
 * create a gap either.
 */
export function releaseReservation(counter: ReferenceCounter): ReferenceCounter {
  return { ...counter, reserved: null };
}

/**
 * Set where the sequence stands, from the operator's own records.
 *
 * `next` is the number they want handed out next, so an operator who last
 * filed 4087 types 4088. Any reservation is dropped: they have just said what
 * the truth is.
 */
export function setNextReference(counter: ReferenceCounter, next: number): ReferenceCounter {
  const wanted = wholeNumber(next, counter.lastFiled + 1);
  const floor = Math.max(1, wanted);
  return { lastFiled: floor - 1, reserved: null, configured: true };
}

export async function loadCounter(): Promise<ReferenceCounter> {
  if (!hasChromeStorage()) return { ...DEFAULT_COUNTER };
  const bag = await chrome.storage.local.get(STORAGE_KEY);
  return mergeCounter(bag[STORAGE_KEY]);
}

export async function saveCounter(counter: ReferenceCounter): Promise<ReferenceCounter> {
  const next = mergeCounter(counter);
  if (hasChromeStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}
