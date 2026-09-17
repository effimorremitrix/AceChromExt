/**
 * Which INTTRA screen is on the tab?
 *
 * Same scoring as the ACE detector, against the INTTRA signatures: active
 * tab text, headings, URL, marker elements, and for Copy Container Details
 * the container grid itself. The score becomes a confidence; 'none' blocks
 * filling. A tie between two screens is 'unknown'.
 *
 * Two kinds of evidence, weighted so the second always wins:
 *
 *   - wording: the active step tab, a heading, a URL fragment. All guessed
 *     until captured, and on Copy Container Details WRONG rather than weak,
 *     because that screen is a modal drawn over another step and the strip
 *     behind it still names the step it covers (observed 2026-09-17);
 *   - structure: a marker element whose id was copied from the live DOM, or a
 *     visible grid whose header row says Container Number (findContainerGrid,
 *     the same reading the grid writer uses, whatever the grid is built
 *     from). Structure scores 10, and the three wording rungs together reach
 *     at most 4 + 3 + 2 = 9, so a screen that is structurally on the page
 *     beats any wording behind it.
 *
 * A marker counts only while it is visible: a modal wrapper that the portal
 * keeps in the DOM, hidden, while the modal is closed would otherwise identify
 * every screen as the modal.
 */

import type { InttraPageId } from '../models/InttraField.js';
import { GRID_COLUMNS } from '../mappings/containerGrid.js';
import { INTTRA_PAGE_SIGNATURES, inttraSignatureFor, type InttraPageSignature } from '../pages.js';
import { isInttraVisible } from './fieldWriter.js';
import { findContainerGrid } from './gridWriter.js';

export interface InttraPageDetection {
  page: InttraPageId;
  label: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  evidence: string[];
  scores: Array<{ page: InttraPageId; score: number; reasons: string[] }>;
}

/** What each kind of evidence is worth. Structure (marker, grid) outscores every wording rung combined. */
export const EVIDENCE = Object.freeze({ tab: 4, heading: 3, url: 2, marker: 10, grid: 10 });

const ACTIVE_TAB_SELECTORS = [
  '[aria-selected="true"]',
  '[aria-current="step"]',
  '[aria-current="page"]',
  '.nav-tabs .active',
  '.nav-link.active',
  'li.active > a',
  '.active[role="tab"]',
  '.wizard-step.active',
  '.step.active',
  '.steps .current',
  '.breadcrumb-item.active',
];

function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function safeQueryAll(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function activeTabTexts(doc: Document): string[] {
  const texts: string[] = [];
  for (const selector of ACTIVE_TAB_SELECTORS) {
    for (const element of safeQueryAll(doc, selector)) {
      const text = textOf(element);
      if (text && text.length <= 120) texts.push(text);
    }
  }
  return texts;
}

function headingTexts(doc: Document): string[] {
  const texts: string[] = [];
  for (const heading of Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6, legend, [role="heading"]'))) {
    const text = textOf(heading);
    if (text && text.length <= 120) texts.push(text);
  }
  return texts;
}

/** A marker that is in the DOM but hidden is no evidence of the screen being open. */
function visibleMarker(doc: Document, signature: InttraPageSignature): string | null {
  for (const selector of signature.markerSelectors) {
    if (safeQueryAll(doc, selector).some((element) => isInttraVisible(element))) return selector;
  }
  return null;
}

function scorePage(signature: InttraPageSignature, context: { tabs: string[]; headings: string[]; url: string; doc: Document }): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  for (const hint of signature.tabText) {
    const match = context.tabs.find((text) => text.includes(hint));
    if (match) {
      score += EVIDENCE.tab;
      reasons.push(`Active tab reads "${match}"`);
      break;
    }
  }
  for (const hint of signature.headingText) {
    const match = context.headings.find((text) => text.includes(hint));
    if (match) {
      score += EVIDENCE.heading;
      reasons.push(`Heading reads "${match}"`);
      break;
    }
  }
  for (const hint of signature.urlHints) {
    if (context.url.includes(hint)) {
      score += EVIDENCE.url;
      reasons.push(`URL contains "${hint}"`);
      break;
    }
  }
  const marker = visibleMarker(context.doc, signature);
  if (marker) {
    score += EVIDENCE.marker;
    reasons.push(`Marker element ${marker} is present and visible`);
  }
  return { score, reasons };
}

/**
 * Is anything structural on this document: a visible captured marker, or a
 * visible container grid? The content scripts answer the panel at once when
 * there is, and after a moment when there is not, so that with the helper
 * running in every frame of the tab the frame that holds the screen is the
 * one whose answer the panel keeps.
 */
export function hasStructuralEvidence(doc: Document = document): boolean {
  if (findContainerGrid(doc, GRID_COLUMNS).root) return true;
  return INTTRA_PAGE_SIGNATURES.some((signature) => visibleMarker(doc, signature) !== null);
}

export function detectInttraPage(doc: Document = document): InttraPageDetection {
  const context = {
    tabs: activeTabTexts(doc),
    headings: headingTexts(doc),
    url: `${doc.location?.pathname ?? ''}${doc.location?.search ?? ''}${doc.location?.hash ?? ''}`.toLowerCase(),
    doc,
  };
  const scores = INTTRA_PAGE_SIGNATURES.map((signature) => {
    const { score, reasons } = scorePage(signature, context);
    return { page: signature.page as InttraPageId, score, reasons };
  });

  // The grid is evidence, and it outranks the step strip: if a container grid
  // is visible, the grid is what there is to fill, whatever the strip behind
  // the modal says and whether or not the captured wrapper id still matches.
  // The grid is found by its shape when it has one, and by the wording of its
  // header row when it has not (the live modal's grid is neither a table nor
  // an ARIA grid, fifth run 2026-09-17).
  const grid = findContainerGrid(doc, GRID_COLUMNS);
  const copyContainerDetails = scores.find((entry) => entry.page === 'copyContainerDetails');
  if (grid.root && copyContainerDetails) {
    copyContainerDetails.score += EVIDENCE.grid;
    copyContainerDetails.reasons.push(
      `A visible container grid is on the page (${grid.score} of ${GRID_COLUMNS.length} columns identified by their headings${grid.how === 'wording' ? ', found by the wording of its header row' : ''})`,
    );
  }
  scores.sort((a, b) => b.score - a.score);

  const best = scores[0];
  const runnerUp = scores[1];
  if (!best || best.score === 0) {
    return { page: 'unknown', label: 'Unknown page', confidence: 'none', evidence: ['No INTTRA screen could be identified from the tabs, headings, URL, marker elements, or a container grid.'], scores };
  }
  if (runnerUp && best.score === runnerUp.score) {
    return {
      page: 'unknown',
      label: 'Ambiguous page',
      confidence: 'none',
      evidence: [`Two screens scored equally (${best.page} and ${runnerUp.page}). Fill is blocked until the screen can be identified.`, ...best.reasons],
      scores,
    };
  }
  const confidence: InttraPageDetection['confidence'] = best.score >= 7 ? 'high' : best.score >= 4 ? 'medium' : 'low';
  return { page: best.page, label: inttraSignatureFor(best.page)?.label ?? 'Unknown page', confidence, evidence: best.reasons, scores };
}
