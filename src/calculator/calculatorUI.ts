/**
 * Floating calculator overlay.
 *
 * Why it exists: ACE numeric fields reject * / ( ), so a filer cannot type
 * "79833 * 7.94" into the field itself. The overlay does the arithmetic beside
 * the field and inserts only the result.
 *
 * Interaction:
 *   F2     - open beside the focused numeric field
 *   Enter  - insert the result (and nothing else) into that field
 *   Escape - close, leaving the field exactly as it was
 *
 * The UI lives in a shadow root so ACE's stylesheets cannot affect it and it
 * cannot affect ACE's layout.
 */

import { calculate, type CalcResult, type RoundingOptions } from './calculator.js';
import { setAceFieldValue } from '../content/fieldWriter.js';

const HOST_ID = 'ace-helper-calculator-host';

const STYLES = `
  :host { all: initial; }
  .panel {
    position: fixed;
    z-index: 2147483000;
    width: 260px;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #16222e;
    background: #ffffff;
    border: 1px solid #b9c4cf;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(16, 32, 48, 0.22);
    overflow: hidden;
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px; background: #123a5c; color: #fff; font-weight: 600; font-size: 12px;
  }
  .header .target { font-weight: 400; opacity: 0.85; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .body { padding: 10px; }
  input.expr {
    width: 100%; box-sizing: border-box; padding: 7px 8px; font-size: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    border: 1px solid #9fb0bf; border-radius: 5px; background: #fff; color: #16222e;
  }
  input.expr:focus { outline: 2px solid #1a73c7; outline-offset: 0; border-color: #1a73c7; }
  .result { margin-top: 8px; padding: 7px 8px; border-radius: 5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 15px; min-height: 20px; }
  .result.ok { background: #e9f6ec; color: #1b5e20; border: 1px solid #a5d6a7; }
  .result.err { background: #fdeaea; color: #b3261e; border: 1px solid #f0b3ae; font-family: inherit; font-size: 12px; }
  .result.idle { background: #f2f5f8; color: #5a6b7a; border: 1px solid #dde4ea; font-size: 12px; font-family: inherit; }
  .hint { margin-top: 8px; font-size: 11px; color: #5a6b7a; display: flex; justify-content: space-between; gap: 6px; }
  kbd { background: #eef2f6; border: 1px solid #cfd9e2; border-bottom-width: 2px; border-radius: 3px; padding: 0 3px; font-family: inherit; font-size: 10px; }
`;

interface OverlayState {
  host: HTMLDivElement;
  root: ShadowRoot;
  panel: HTMLDivElement;
  input: HTMLInputElement;
  result: HTMLDivElement;
  target: HTMLInputElement | HTMLTextAreaElement;
  lastResult: CalcResult | null;
}

let state: OverlayState | null = null;
let roundingProvider: () => RoundingOptions = () => ({ mode: 'decimals', decimals: 2 });
let blurOnInsert = true;

export function configureCalculator(options: { rounding: () => RoundingOptions; dispatchBlur: boolean }): void {
  roundingProvider = options.rounding;
  blurOnInsert = options.dispatchBlur;
}

/** True for the kind of ACE control the calculator makes sense for. */
export function isCalculatorTarget(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (!(element instanceof HTMLInputElement)) return false;
  if (element.disabled || element.readOnly) return false;
  const type = (element.getAttribute('type') ?? 'text').toLowerCase();
  return type === 'text' || type === 'number' || type === 'tel' || type === 'search' || type === '';
}

function describeTarget(element: HTMLInputElement | HTMLTextAreaElement): string {
  const doc = element.ownerDocument;
  const id = element.getAttribute('id');
  if (id) {
    // Matched by property rather than by selector: an ACE id can contain
    // characters that would need escaping, and CSS.escape is not everywhere.
    const label = Array.from(doc.querySelectorAll('label')).find((candidate) => candidate.htmlFor === id);
    const text = label?.textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return element.getAttribute('aria-label') ?? element.getAttribute('name') ?? id ?? 'numeric field';
}

function position(panel: HTMLElement, target: Element): void {
  const rect = target.getBoundingClientRect();
  const width = 260;
  const gap = 8;
  const estimatedHeight = 170;

  let left = rect.right + gap;
  if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - gap);
  if (left < 8) left = 8;

  let top = rect.top;
  if (top + estimatedHeight > window.innerHeight - 8) top = Math.max(8, window.innerHeight - estimatedHeight - 8);

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function render(current: OverlayState): void {
  const expression = current.input.value;

  if (expression.trim() === '') {
    current.lastResult = null;
    current.result.className = 'result idle';
    current.result.textContent = 'Type an expression, e.g. 79833 * 7.94';
    return;
  }

  const result = calculate(expression, roundingProvider());
  current.lastResult = result;

  if (result.ok) {
    current.result.className = 'result ok';
    current.result.textContent = `= ${result.display}`;
  } else {
    current.result.className = 'result err';
    current.result.textContent = result.message;
  }
}

function insert(current: OverlayState): void {
  const result = current.lastResult;
  if (!result || !result.ok) {
    current.result.className = 'result err';
    current.result.textContent = result?.message ?? 'Nothing to insert yet.';
    return;
  }

  const write = setAceFieldValue(current.target, result.insert, { blur: blurOnInsert });
  closeCalculator();

  if (!write.ok) {
    // The field rejected the value: tell the user rather than failing silently.
    console.warn('[ACE Helper] Calculator could not write the result:', write.reason);
  }
}

export function closeCalculator(): void {
  if (!state) return;
  const { host, target } = state;
  host.remove();
  state = null;
  if (typeof target.focus === 'function') target.focus({ preventScroll: true });
}

export function isCalculatorOpen(): boolean {
  return state !== null;
}

/** Open the calculator beside `target`. Re-opening moves the existing panel. */
export function openCalculator(target: HTMLInputElement | HTMLTextAreaElement): void {
  if (state) closeCalculator();

  const doc = target.ownerDocument;
  const host = doc.createElement('div');
  host.id = HOST_ID;
  // 'open' rather than 'closed': the shadow root isolates styling, which is
  // the point, and there is nothing private in a calculator panel - the host
  // element is visible to the page either way. Open keeps it testable.
  const root = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = STYLES;

  const panel = doc.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'ACE Helper calculator');

  const header = doc.createElement('div');
  header.className = 'header';
  const title = doc.createElement('span');
  title.textContent = 'Calculator';
  const targetName = doc.createElement('span');
  targetName.className = 'target';
  targetName.textContent = describeTarget(target);
  header.append(title, targetName);

  const body = doc.createElement('div');
  body.className = 'body';

  const input = doc.createElement('input');
  input.className = 'expr';
  input.type = 'text';
  input.setAttribute('aria-label', 'Expression');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.placeholder = '20 * 4';

  const result = doc.createElement('div');
  result.className = 'result idle';
  result.setAttribute('aria-live', 'polite');
  result.textContent = 'Type an expression, e.g. 79833 * 7.94';

  const hint = doc.createElement('div');
  hint.className = 'hint';
  const left = doc.createElement('span');
  left.innerHTML = '<kbd>Enter</kbd> insert result';
  const right = doc.createElement('span');
  right.innerHTML = '<kbd>Esc</kbd> cancel';
  hint.append(left, right);

  body.append(input, result, hint);
  panel.append(header, body);
  root.append(style, panel);
  doc.body.appendChild(host);

  position(panel, target);

  state = { host, root, panel, input, result, target, lastResult: null };
  const current = state;

  input.addEventListener('input', () => render(current));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      insert(current);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeCalculator();
      return;
    }
    // Keep ACE's own shortcut handlers out of the calculator.
    event.stopPropagation();
  });

  // Seed the expression with the field's current numeric content, if any.
  const existing = target.value.trim();
  if (existing !== '' && /^[\d,.\s]+$/.test(existing)) {
    input.value = existing;
    render(current);
  }

  input.focus({ preventScroll: true });
  input.select();
}

/** Reposition on scroll/resize so the panel stays beside its field. */
export function repositionCalculator(): void {
  if (!state) return;
  if (!state.target.isConnected) {
    closeCalculator();
    return;
  }
  position(state.panel, state.target);
}
