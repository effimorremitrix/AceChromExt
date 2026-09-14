/**
 * THE ONE PLACE that writes into an INTTRA control.
 *
 * Not a copy of setAceFieldValue: INTTRA's Shipping Instructions screens are
 * built on a different front end and the Copy Container Details grid may hold
 * native inputs, contenteditable cells, or framework cells that only open an
 * editor on click. This writer therefore:
 *
 *   1. resolves the actual control behind an element (the input inside a
 *      grid cell, the cell itself when it is contenteditable);
 *   2. sets the value through the mechanism that control kind needs: the
 *      native prototype setter for inputs, textContent for contenteditable;
 *   3. dispatches the events a framework listens to: input, change (and
 *      keyup for grids that commit on key events), then blur/focusout;
 *   4. reads the value back;
 *   5. verifies it against what was asked for;
 *   6. returns a structured result that names the control kind, the
 *      read-back and the reason on failure. It never throws.
 *
 * A control kind it does not recognise is reported as not writable. Nothing is
 * clicked, and no editor is opened by simulated mouse events: if a grid only
 * takes input through a click-to-edit widget, that is reported, so the
 * operator can use the Copy rows (TSV) path instead.
 */

export type InttraControlKind = 'input' | 'textarea' | 'select' | 'contenteditable' | 'none';

export interface InttraWriteOptions {
  blur?: boolean;
  focus?: boolean;
  /** Dispatch keyup after input; some grids commit on it. Default true. */
  keyup?: boolean;
}

export interface InttraWriteResult {
  ok: boolean;
  control: InttraControlKind;
  readBack: string;
  reason?: string;
  selectedText?: string;
}

type NativeControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isNative(element: Element | null): element is NativeControl {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

function isEditable(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  const attribute = element.getAttribute('contenteditable');
  return attribute === '' || attribute === 'true' || attribute === 'plaintext-only';
}

/** Visible in the layout sense. jsdom has no layout, so hidden attributes decide there. */
export function isInttraVisible(element: Element): boolean {
  const node = element as HTMLElement;
  if (!node.isConnected || node.hidden) return false;
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function disabled(element: Element): boolean {
  if (isNative(element) && element.disabled) return true;
  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.readOnly) return true;
  return element.getAttribute('aria-disabled') === 'true' || element.getAttribute('aria-readonly') === 'true';
}

/**
 * The control behind an element: itself when it is a control, otherwise the
 * single control inside it (a grid cell wrapping an input), otherwise the
 * element itself when it is contenteditable.
 */
export function resolveInttraControl(element: Element | null): { element: Element | null; kind: InttraControlKind } {
  if (!element) return { element: null, kind: 'none' };
  if (isNative(element)) {
    const kind: InttraControlKind = element instanceof HTMLSelectElement ? 'select' : element instanceof HTMLTextAreaElement ? 'textarea' : 'input';
    return { element, kind };
  }
  const inner = Array.from(element.querySelectorAll('input, textarea, select')).filter((control) => isInttraVisible(control) && !disabled(control));
  if (inner.length === 1) return resolveInttraControl(inner[0] as Element);
  if (inner.length > 1) return { element: null, kind: 'none' };
  if (isEditable(element)) return { element, kind: 'contenteditable' };
  const editable = Array.from(element.querySelectorAll('[contenteditable]')).filter((node) => isEditable(node) && isInttraVisible(node));
  if (editable.length === 1) return { element: editable[0] as Element, kind: 'contenteditable' };
  return { element: null, kind: 'none' };
}

export function isInttraWritable(element: Element | null): boolean {
  const resolved = resolveInttraControl(element);
  return resolved.element !== null && !disabled(resolved.element) && isInttraVisible(resolved.element);
}

function nativeSetter(element: NativeControl): ((value: string) => void) | null {
  const prototype =
    element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (!descriptor || typeof descriptor.set !== 'function') return null;
  return descriptor.set.bind(element) as (value: string) => void;
}

function dispatch(element: Element, type: string, init: EventInit = { bubbles: true }): void {
  element.dispatchEvent(new Event(type, init));
}

function dispatchAll(element: Element, options: Required<InttraWriteOptions>): void {
  dispatch(element, 'input');
  if (options.keyup) {
    try {
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Tab' }));
    } catch {
      // KeyboardEvent may be unavailable in a minimal environment; keyup is a courtesy, not a requirement.
    }
  }
  dispatch(element, 'change');
  if (options.blur) {
    dispatch(element, 'blur', { bubbles: false });
    dispatch(element, 'focusout');
  }
}

function selectOption(element: HTMLSelectElement, value: string): HTMLOptionElement | null {
  const wanted = value.trim().toLowerCase();
  if (wanted === '') return null;
  const options = Array.from(element.options);
  return (
    options.find((option) => option.value.trim().toLowerCase() === wanted) ??
    options.find((option) => option.textContent?.trim().toLowerCase() === wanted) ??
    options.find((option) => {
      const text = option.textContent?.trim().toLowerCase() ?? '';
      return text.startsWith(`${wanted} `) || text.startsWith(`${wanted}-`) || text.startsWith(`${wanted} -`);
    }) ??
    null
  );
}

const strip = (text: string): string => text.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();

function verify(control: InttraControlKind, readBack: string, wanted: string): InttraWriteResult {
  if (readBack === wanted) return { ok: true, control, readBack };
  if (strip(readBack) === strip(wanted)) return { ok: true, control, readBack, reason: 'INTTRA reformatted the value.' };
  return { ok: false, control, readBack, reason: `INTTRA did not keep the value (the control now reads "${readBack}").` };
}

/** Write `value` into an INTTRA control, make the page notice, and verify the read-back. Never throws. */
export function setInttraFieldValue(element: Element | null, value: string, options: InttraWriteOptions = {}): InttraWriteResult {
  const opts: Required<InttraWriteOptions> = { blur: options.blur ?? true, focus: options.focus ?? true, keyup: options.keyup ?? true };
  const resolved = resolveInttraControl(element);
  const target = resolved.element;
  if (!target || resolved.kind === 'none') {
    return { ok: false, control: 'none', readBack: '', reason: 'No writable control was found behind this element (it may open an editor only on click, which the helper never simulates).' };
  }
  if (disabled(target) || !isInttraVisible(target)) {
    return { ok: false, control: resolved.kind, readBack: readInttraFieldValue(target), reason: 'The control is disabled, read-only, or hidden.' };
  }

  try {
    if (opts.focus && typeof (target as HTMLElement).focus === 'function') (target as HTMLElement).focus({ preventScroll: true });

    if (target instanceof HTMLSelectElement) {
      const option = selectOption(target, value);
      if (!option) return { ok: false, control: 'select', readBack: target.value, reason: `No dropdown option matches "${value}". Choose it manually.` };
      const setter = nativeSetter(target);
      if (setter) setter(option.value);
      else target.value = option.value;
      option.selected = true;
      dispatchAll(target, opts);
      const ok = target.value === option.value;
      return { ok, control: 'select', readBack: target.value, selectedText: option.textContent?.trim() ?? '', ...(ok ? {} : { reason: 'INTTRA reverted the dropdown selection.' }) };
    }

    if (isNative(target)) {
      const setter = nativeSetter(target);
      if (setter) setter(value);
      else target.value = value;
      dispatchAll(target, opts);
      return verify(resolved.kind, target.value, value);
    }

    // contenteditable
    const editable = target as HTMLElement;
    editable.textContent = value;
    dispatchAll(editable, opts);
    return verify('contenteditable', (editable.textContent ?? '').trim(), value);
  } catch (error) {
    return { ok: false, control: resolved.kind, readBack: '', reason: `Write failed: ${(error as Error).message}` };
  }
}

/** The current value of a control, for overwrite warnings and read-back. */
export function readInttraFieldValue(element: Element | null): string {
  const resolved = resolveInttraControl(element);
  const target = resolved.element;
  if (!target) return '';
  if (isNative(target)) return target.value ?? '';
  return (target.textContent ?? '').trim();
}
