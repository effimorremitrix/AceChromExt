/**
 * THE ONE PLACE that writes into an ACE input.
 *
 * ACE is a framework-driven application: assigning `element.value = x` updates
 * the DOM node but leaves the framework's own model untouched, so the value
 * looks right on screen and is missing (or stale) when the filing is validated.
 *
 * setAceFieldValue therefore:
 *   1. writes through the *native* value setter, so the framework's patched
 *      property setter does not swallow the change;
 *   2. dispatches `input`  (React / Angular / Vue listen to this);
 *   3. dispatches `change` (jQuery and plain-DOM handlers listen to this);
 *   4. optionally dispatches `blur` + `focusout` for fields that validate on blur;
 *   5. reads the value back and reports whether ACE kept it.
 *
 * Every future ACE write must go through this function.
 */

export type WritableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface WriteOptions {
  /** Dispatch blur/focusout after writing. Default true. */
  blur?: boolean;
  /** Focus the element before writing, as a real user would. Default true. */
  focus?: boolean;
}

export interface WriteResult {
  ok: boolean;
  /** What the element holds after the write. */
  readBack: string;
  /** Set when the write could not be performed or did not stick. */
  reason?: string;
  /** For <select>: the option text that ended up selected. */
  selectedText?: string;
}

function nativeSetter(element: WritableElement): ((value: string) => void) | null {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : null;

  if (!prototype) return null;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (!descriptor || typeof descriptor.set !== 'function') return null;
  return descriptor.set.bind(element) as (value: string) => void;
}

export function isWritable(element: Element | null): element is WritableElement {
  if (!element) return false;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
    return false;
  }
  if (element.disabled) return false;
  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.readOnly) return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

/** Visible in the layout sense: the user could see and click it. */
export function isVisible(element: Element): boolean {
  const node = element as HTMLElement;
  if (!node.isConnected) return false;
  if (node.hidden) return false;
  if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) {
    // jsdom has no layout, so an element with no rects there is still
    // considered visible unless it is explicitly hidden.
    const hasLayout = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function';
    if (!hasLayout) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  }
  return true;
}

function dispatch(element: WritableElement, type: string, eventInit: EventInit = { bubbles: true }): void {
  element.dispatchEvent(new Event(type, eventInit));
}

/** Pick the <option> that best matches `value`: exact value, then exact text, then a code prefix. */
function selectOption(element: HTMLSelectElement, value: string): HTMLOptionElement | null {
  const wanted = value.trim().toLowerCase();
  if (wanted === '') return null;

  const options = Array.from(element.options);

  const byValue = options.find((option) => option.value.trim().toLowerCase() === wanted);
  if (byValue) return byValue;

  const byText = options.find((option) => option.textContent?.trim().toLowerCase() === wanted);
  if (byText) return byText;

  // ACE dropdowns often render "C33 - License Exception STA".
  const byCodePrefix = options.find((option) => {
    const text = option.textContent?.trim().toLowerCase() ?? '';
    return text.startsWith(`${wanted} `) || text.startsWith(`${wanted}-`) || text.startsWith(`${wanted} -`);
  });
  if (byCodePrefix) return byCodePrefix;

  return null;
}

/**
 * Write `value` into an ACE form control and make ACE notice.
 * Never throws: failures come back as `{ ok: false, reason }`.
 */
export function setAceFieldValue(element: Element | null, value: string, options: WriteOptions = {}): WriteResult {
  const { blur = true, focus = true } = options;

  if (!isWritable(element)) {
    return { ok: false, readBack: '', reason: 'The field is missing, disabled, or read-only.' };
  }

  const target = element;

  try {
    if (focus && typeof target.focus === 'function') target.focus({ preventScroll: true });

    if (target instanceof HTMLSelectElement) {
      const option = selectOption(target, value);
      if (!option) {
        return {
          ok: false,
          readBack: target.value,
          reason: `No dropdown option matches "${value}". Choose it manually.`,
        };
      }
      const setter = nativeSetter(target);
      if (setter) setter(option.value);
      else target.value = option.value;
      option.selected = true;

      dispatch(target, 'input');
      dispatch(target, 'change');
      if (blur) {
        dispatch(target, 'blur', { bubbles: false });
        dispatch(target, 'focusout');
      }

      const ok = target.value === option.value;
      return {
        ok,
        readBack: target.value,
        selectedText: option.textContent?.trim() ?? '',
        ...(ok ? {} : { reason: 'ACE reverted the dropdown selection.' }),
      };
    }

    const setter = nativeSetter(target);
    if (setter) setter(value);
    else target.value = value;

    dispatch(target, 'input');
    dispatch(target, 'change');
    if (blur) {
      dispatch(target, 'blur', { bubbles: false });
      dispatch(target, 'focusout');
    }

    const readBack = target.value;
    if (readBack === value) return { ok: true, readBack };

    // ACE masks and re-formats some fields (dates, money). A value that only
    // differs in punctuation is accepted; anything else is reported.
    const strip = (text: string) => text.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
    if (strip(readBack) === strip(value)) {
      return { ok: true, readBack, reason: 'ACE reformatted the value.' };
    }

    return { ok: false, readBack, reason: `ACE did not keep the value (field now reads "${readBack}").` };
  } catch (error) {
    return { ok: false, readBack: '', reason: `Write failed: ${(error as Error).message}` };
  }
}

/** Read the current value of an ACE control, for diagnostics and overwrite warnings. */
export function readAceFieldValue(element: Element | null): string {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
    return '';
  }
  return element.value ?? '';
}
