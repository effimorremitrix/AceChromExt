/**
 * Temporary visual feedback on ACE fields.
 *
 * Styling is applied as an inline style snapshot that is restored afterwards,
 * plus a marker attribute for the "show me the failed field" jump. Nothing is
 * left behind on the page once the highlight expires.
 */

import type { FillStatus } from '../models/AceField.js';

const MARKER_ATTRIBUTE = 'data-ace-helper-field';
const STYLE_ELEMENT_ID = 'ace-helper-highlight-styles';

const COLORS: Record<'filled' | 'transformed' | 'warning' | 'error', { background: string; outline: string }> = {
  filled: { background: '#e6f6e6', outline: '#2e7d32' },
  transformed: { background: '#fff7e0', outline: '#d68910' },
  warning: { background: '#fff7e0', outline: '#d68910' },
  error: { background: '#fdeaea', outline: '#c62828' },
};

interface Snapshot {
  background: string;
  outline: string;
  outlineOffset: string;
  transition: string;
}

const snapshots = new WeakMap<HTMLElement, Snapshot>();
const timers = new Map<HTMLElement, number>();

function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ELEMENT_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    [${MARKER_ATTRIBUTE}] { transition: background-color 120ms ease, outline-color 120ms ease; }
    .ace-helper-pulse { animation: ace-helper-pulse 900ms ease-in-out 2; }
    @keyframes ace-helper-pulse { 0%, 100% { outline-offset: 0; } 50% { outline-offset: 4px; } }
  `;
  doc.head.appendChild(style);
}

export function highlightField(element: HTMLElement, status: FillStatus, durationMs: number, key?: string): void {
  const palette = COLORS[status === 'skipped' ? 'warning' : status];
  if (!palette) return;

  ensureStyles(element.ownerDocument);

  if (!snapshots.has(element)) {
    snapshots.set(element, {
      background: element.style.backgroundColor,
      outline: element.style.outline,
      outlineOffset: element.style.outlineOffset,
      transition: element.style.transition,
    });
  }

  element.style.backgroundColor = palette.background;
  element.style.outline = `2px solid ${palette.outline}`;
  element.style.outlineOffset = '1px';
  if (key) element.setAttribute(MARKER_ATTRIBUTE, key);

  const existing = timers.get(element);
  if (existing) clearTimeout(existing);

  if (durationMs > 0) {
    const timer = setTimeout(() => clearHighlight(element), durationMs) as unknown as number;
    timers.set(element, timer);
  }
}

export function clearHighlight(element: HTMLElement): void {
  const snapshot = snapshots.get(element);
  if (snapshot) {
    element.style.backgroundColor = snapshot.background;
    element.style.outline = snapshot.outline;
    element.style.outlineOffset = snapshot.outlineOffset;
    element.style.transition = snapshot.transition;
    snapshots.delete(element);
  }
  element.removeAttribute(MARKER_ATTRIBUTE);
  element.classList.remove('ace-helper-pulse');
  const timer = timers.get(element);
  if (timer) {
    clearTimeout(timer);
    timers.delete(element);
  }
}

export function clearAllHighlights(doc: Document = document): void {
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>(`[${MARKER_ATTRIBUTE}]`))) {
    clearHighlight(element);
  }
}

/** Scroll to and pulse the field a warning refers to. */
export function revealField(key: string, doc: Document = document): boolean {
  const element = Array.from(doc.querySelectorAll<HTMLElement>(`[${MARKER_ATTRIBUTE}]`)).find(
    (candidate) => candidate.getAttribute(MARKER_ATTRIBUTE) === key,
  );
  if (!element) return false;
  ensureStyles(doc);
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.classList.add('ace-helper-pulse');
  setTimeout(() => element.classList.remove('ace-helper-pulse'), 2000);
  if (typeof (element as HTMLInputElement).focus === 'function') {
    (element as HTMLInputElement).focus({ preventScroll: true });
  }
  return true;
}

export { MARKER_ATTRIBUTE };
