/**
 * Temporary visual feedback on a portal field.
 *
 * Styling is applied as an inline style snapshot that is restored afterwards,
 * plus a marker attribute for the "show me the failed field" jump. Nothing is
 * left behind on the page once the highlight expires - and, since 2026-09-20,
 * nothing is added to the page's STYLESHEETS either.
 *
 * Why that matters, and it is not cosmetic. This module used to append a
 * `<style>` element to the page for a transition and a pulse keyframe. A
 * stylesheet added to a document invalidates its style, and the detector
 * forces that work to run synchronously a moment later - `isVisible` calls
 * `getClientRects()` and `getComputedStyle()` on every candidate it tries. So
 * the page's own pending font and style work was processed inside OUR call
 * stack, and Chrome attributed the result to us: live INTTRA
 * (2026-09-20) logged
 *
 *   Failed to decode downloaded font:
 *   https://ship.inttra.e2open.com/siact/css/fonts/opensans/OpenSans_600.woff
 *
 * against `inttraContent.js`, on the extension's Errors panel, for a broken
 * font file served by INTTRA from INTTRA's own host. Nothing here loads a
 * font, and the manifest forbids it (`connect-src 'none'`), but the blame
 * landed here and made the helper look broken.
 *
 * So the stylesheet is gone. The transition is an inline style like the rest
 * of the snapshot, and the pulse is a Web Animations call on the one element,
 * which needs no `@keyframes` rule and therefore no stylesheet. The forced
 * style reads in the detector stay - knowing whether a control is visible is
 * the whole point of them - so a page whose own CSS is still loading can
 * still surface its own warnings through us. What is fixed is that we no
 * longer give it anything of ours to process.
 */

import type { FillStatus } from '../models/AceField.js';

const MARKER_ATTRIBUTE = 'data-ace-helper-field';

/** The transition the highlight fades in with, applied inline. */
const TRANSITION = 'background-color 120ms ease, outline-color 120ms ease';

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
const pulses = new WeakMap<HTMLElement, Animation>();

/**
 * Pulse the outline of one element, without a keyframe rule.
 *
 * `Element.animate` keeps the whole thing on the element: no stylesheet, no
 * class, nothing to clean up but the handle. It is absent in jsdom and in any
 * browser older than the manifest's minimum, so a missing method is simply no
 * pulse - the outline and the scroll still say which field is meant.
 */
function pulse(element: HTMLElement): void {
  if (typeof element.animate !== 'function') return;
  cancelPulse(element);
  try {
    const animation = element.animate(
      [{ outlineOffset: '0px' }, { outlineOffset: '4px' }, { outlineOffset: '0px' }],
      { duration: 900, iterations: 2, easing: 'ease-in-out' },
    );
    pulses.set(element, animation);
  } catch {
    // An engine that has animate() but refuses these options is not worth a
    // fallback: the highlight itself is what matters.
  }
}

function cancelPulse(element: HTMLElement): void {
  const animation = pulses.get(element);
  if (!animation) return;
  try {
    animation.cancel();
  } catch {
    // Already finished or detached.
  }
  pulses.delete(element);
}

export function highlightField(element: HTMLElement, status: FillStatus, durationMs: number, key?: string): void {
  const palette = COLORS[status === 'skipped' ? 'warning' : status];
  if (!palette) return;

  if (!snapshots.has(element)) {
    snapshots.set(element, {
      background: element.style.backgroundColor,
      outline: element.style.outline,
      outlineOffset: element.style.outlineOffset,
      transition: element.style.transition,
    });
  }

  element.style.transition = TRANSITION;
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
  cancelPulse(element);
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
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  pulse(element);
  if (typeof (element as HTMLInputElement).focus === 'function') {
    (element as HTMLInputElement).focus({ preventScroll: true });
  }
  return true;
}

export { MARKER_ATTRIBUTE };
