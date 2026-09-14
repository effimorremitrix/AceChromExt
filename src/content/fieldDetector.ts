/**
 * Field detection.
 *
 * Candidates are tried in the order the mapping lists them, which is also the
 * order of trustworthiness:
 *
 *   1. verified id / name      -> confidence high
 *   2. stable attributes       -> confidence high (verified) / medium
 *   3. associated label text   -> confidence medium
 *   4. nearby DOM structure    -> confidence low
 *   5. placeholder text        -> confidence low
 *
 * Rules that keep this safe:
 *   - a query matching several visible controls is AMBIGUOUS and is never written;
 *   - a match from an unverified candidate is degraded one confidence level;
 *   - no positional heuristics ("the third textbox") exist anywhere in this file.
 */

import type { AceFieldMapping, AceSelectorCandidate, FieldDetection } from '../models/AceField.js';
import { isVisible, isWritable } from './fieldWriter.js';

const CONTROL_SELECTOR = 'input, select, textarea';

function normalizeLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidateQueryDescription(candidate: AceSelectorCandidate): string {
  if (candidate.strategy === 'label') return `label: ${(candidate.labelText ?? []).join(' | ')}`;
  if (candidate.strategy === 'placeholder') return `placeholder: ${candidate.placeholder ?? candidate.selector ?? ''}`;
  if (candidate.strategy === 'nearby') return `${candidate.selector ?? ''} >> ${candidate.within ?? CONTROL_SELECTOR}`;
  return candidate.selector ?? '';
}

function safeQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    // A malformed selector in a mapping must not take the whole fill down.
    return [];
  }
}

/** Controls that could plausibly be written: visible and writable. */
function usableControls(elements: Element[]): Element[] {
  return elements.filter((element) => isVisible(element) && isWritable(element));
}

/** Find controls whose associated label matches any of `labelTexts`. */
function findByLabel(root: ParentNode, labelTexts: string[]): Element[] {
  const wanted = labelTexts.map(normalizeLabel).filter((text) => text !== '');
  if (!wanted.length) return [];

  const matches: Element[] = [];
  const doc = (root as Element).ownerDocument ?? (root as Document);

  // 1. <label for="..."> and <label><input></label>
  for (const label of safeQueryAll(root, 'label')) {
    const text = normalizeLabel(label.textContent ?? '');
    if (!wanted.includes(text)) continue;

    const forAttr = label.getAttribute('for');
    if (forAttr) {
      const target = doc?.getElementById(forAttr);
      if (target) {
        matches.push(target);
        continue;
      }
    }
    const nested = label.querySelector(CONTROL_SELECTOR);
    if (nested) {
      matches.push(nested);
      continue;
    }
    const adjacent = adjacentControl(label);
    if (adjacent) matches.push(adjacent);
  }

  // 2. aria-label / aria-labelledby / title
  for (const control of safeQueryAll(root, CONTROL_SELECTOR)) {
    const aria = normalizeLabel(control.getAttribute('aria-label') ?? '');
    if (aria && wanted.includes(aria)) {
      matches.push(control);
      continue;
    }
    const labelledBy = control.getAttribute('aria-labelledby');
    if (labelledBy) {
      const texts = labelledBy
        .split(/\s+/)
        .map((id) => normalizeLabel(doc?.getElementById(id)?.textContent ?? ''))
        .filter((text) => text !== '');
      if (texts.some((text) => wanted.includes(text))) {
        matches.push(control);
        continue;
      }
    }
    const title = normalizeLabel(control.getAttribute('title') ?? '');
    if (title && wanted.includes(title)) matches.push(control);
  }

  return [...new Set(matches)];
}

/**
 * The control a label sits *beside*.
 *
 * A label with a `for` that resolves to nothing is common on portals that
 * re-render, and the tempting fallback - "the first control inside the label's
 * container" - is wrong in exactly the case that matters: a Line Details panel
 * holds a dozen controls, so a stale label for the licence code would resolve
 * to the export information code and the wrong box would be typed into.
 *
 * So only genuinely adjacent controls count: the element straight after the
 * label, or a single control inside it, or a single control in the next cell
 * of a table row. Anything less definite returns nothing, and detection moves
 * on to the next candidate or reports NOT_FOUND.
 */
function adjacentControl(label: Element): Element | null {
  const next = label.nextElementSibling;
  if (next) {
    if (next.matches(CONTROL_SELECTOR)) return next;
    const inside = safeQueryAll(next, CONTROL_SELECTOR);
    if (inside.length === 1) return inside[0] as Element;
  }

  // <td><label></td><td><input></td>
  const cell = label.parentElement;
  if (cell && cell.children.length === 1) {
    const nextCell = cell.nextElementSibling;
    if (nextCell) {
      if (nextCell.matches(CONTROL_SELECTOR)) return nextCell;
      const inside = safeQueryAll(nextCell, CONTROL_SELECTOR);
      if (inside.length === 1) return inside[0] as Element;
    }
  }

  return null;
}

function findByPlaceholder(root: ParentNode, placeholder: string): Element[] {
  const wanted = normalizeLabel(placeholder);
  if (wanted === '') return [];
  return safeQueryAll(root, CONTROL_SELECTOR).filter(
    (control) => normalizeLabel(control.getAttribute('placeholder') ?? '') === wanted,
  );
}

function findNearby(root: ParentNode, containerSelector: string, within: string): Element[] {
  const containers = safeQueryAll(root, containerSelector);
  const found: Element[] = [];
  for (const container of containers) {
    // A container that *is* a control (e.g. the selector matched the input).
    if (container.matches(CONTROL_SELECTOR)) {
      found.push(container);
      continue;
    }
    found.push(...safeQueryAll(container, within));
  }
  return [...new Set(found)];
}

function baseConfidence(candidate: AceSelectorCandidate): FieldDetection['confidence'] {
  switch (candidate.strategy) {
    case 'id':
    case 'name':
      return 'high';
    case 'attribute':
      return 'high';
    case 'label':
      return 'medium';
    case 'nearby':
    case 'placeholder':
    default:
      return 'low';
  }
}

function degrade(confidence: FieldDetection['confidence']): FieldDetection['confidence'] {
  if (confidence === 'high') return 'medium';
  if (confidence === 'medium') return 'low';
  return 'low';
}

export interface DetectOptions {
  /**
   * Restrict the search to this element. Used for commodity-line fields so a
   * write can never land on a different line's inputs.
   */
  root?: ParentNode;
}

/** Resolve one mapping against the DOM. */
export function detectField(field: AceFieldMapping, options: DetectOptions = {}): FieldDetection {
  const root: ParentNode = options.root ?? document;
  const attempts: FieldDetection['attempts'] = [];

  for (const candidate of field.candidates) {
    const query = candidateQueryDescription(candidate);
    let raw: Element[] = [];

    switch (candidate.strategy) {
      case 'id':
      case 'name':
      case 'attribute':
        raw = candidate.selector ? safeQueryAll(root, candidate.selector) : [];
        break;
      case 'label':
        raw = findByLabel(root, candidate.labelText ?? []);
        break;
      case 'placeholder':
        raw = findByPlaceholder(root, candidate.placeholder ?? candidate.selector ?? '');
        break;
      case 'nearby':
        raw = candidate.selector ? findNearby(root, candidate.selector, candidate.within ?? CONTROL_SELECTOR) : [];
        break;
      default:
        raw = [];
    }

    const usable = usableControls(raw);
    attempts.push({ strategy: candidate.strategy, query, matches: usable.length, verified: candidate.verified });

    if (usable.length === 1) {
      const confidence = candidate.verified ? baseConfidence(candidate) : degrade(baseConfidence(candidate));
      return {
        key: field.key,
        label: field.label,
        status: 'FOUND',
        element: usable[0] as HTMLElement,
        matchedBy: candidate.strategy,
        matchedWith: query,
        confidence,
        attempts,
      };
    }

    if (usable.length > 1) {
      return {
        key: field.key,
        label: field.label,
        status: 'AMBIGUOUS',
        element: null,
        matchedBy: candidate.strategy,
        matchedWith: query,
        confidence: 'none',
        attempts,
        ambiguousCount: usable.length,
      };
    }

    // Matched something, but it cannot be written (disabled/hidden). Keep
    // trying later candidates; report NOT_WRITABLE only if nothing else works.
    if (raw.length > 0) {
      attempts[attempts.length - 1] = {
        strategy: candidate.strategy,
        query: `${query} (matched ${raw.length}, none writable)`,
        matches: 0,
        verified: candidate.verified,
      };
    }
  }

  const matchedButUnwritable = attempts.some((attempt) => attempt.query.includes('none writable'));

  return {
    key: field.key,
    label: field.label,
    status: matchedButUnwritable ? 'NOT_WRITABLE' : 'NOT_FOUND',
    element: null,
    matchedBy: null,
    matchedWith: null,
    confidence: 'none',
    attempts,
  };
}

/** Resolve a set of mappings. Used by both the filler and the diagnostics panel. */
export function detectFields(fields: AceFieldMapping[], options: DetectOptions = {}): FieldDetection[] {
  return fields.map((field) => detectField(field, options));
}
