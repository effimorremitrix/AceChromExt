/**
 * Which ACE step is on screen?
 *
 * The extension never navigates ACE. This module only reads the page so that
 * Fill Current Page can restrict itself to the fields that belong to the step
 * the user is actually looking at.
 *
 * Evidence is scored, and the score becomes a confidence level. When confidence
 * is 'none' the UI refuses to fill rather than guessing.
 */

import type { AcePageId } from '../models/AceField.js';
import { PAGE_SIGNATURES, signatureFor, type PageSignature } from '../ace/pages.js';
import { findSectionRoots } from './fieldDetector.js';

export interface PageDetection {
  page: AcePageId;
  label: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** Human-readable reasons, shown in the diagnostics panel. */
  evidence: string[];
  /** Scores for every candidate page, for debugging a misdetection. */
  scores: Array<{ page: AcePageId; score: number; reasons: string[] }>;
  /** Element that scopes the open commodity Line Details form, when found. */
  lineContainerFound: boolean;
}

/** Elements that commonly carry the "current step" state in tabbed wizards. */
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
  '.breadcrumb-item.active',
];

function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function activeTabTexts(doc: Document): string[] {
  const texts: string[] = [];
  for (const selector of ACTIVE_TAB_SELECTORS) {
    let elements: Element[] = [];
    try {
      elements = Array.from(doc.querySelectorAll(selector));
    } catch {
      elements = [];
    }
    for (const element of elements) {
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

function scorePage(
  signature: PageSignature,
  context: { tabs: string[]; headings: string[]; url: string; doc: Document },
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  for (const hint of signature.tabText) {
    const match = context.tabs.find((text) => text.includes(hint));
    if (match) {
      score += 4;
      reasons.push(`Active tab reads "${match}"`);
      break;
    }
  }

  for (const hint of signature.headingText) {
    const match = context.headings.find((text) => text.includes(hint));
    if (match) {
      score += 3;
      reasons.push(`Heading reads "${match}"`);
      break;
    }
  }

  for (const hint of signature.urlHints) {
    if (context.url.includes(hint)) {
      score += 2;
      reasons.push(`URL contains "${hint}"`);
      break;
    }
  }

  for (const selector of signature.markerSelectors) {
    let found = false;
    try {
      found = !!context.doc.querySelector(selector);
    } catch {
      found = false;
    }
    if (found) {
      score += 4;
      reasons.push(`Marker element ${selector} is present`);
      break;
    }
  }

  return { score, reasons };
}

export function detectPage(doc: Document = document): PageDetection {
  const context = {
    tabs: activeTabTexts(doc),
    headings: headingTexts(doc),
    url: `${doc.location?.pathname ?? ''}${doc.location?.search ?? ''}${doc.location?.hash ?? ''}`.toLowerCase(),
    doc,
  };

  const scores = PAGE_SIGNATURES.map((signature) => {
    const { score, reasons } = scorePage(signature, context);
    return { page: signature.page as AcePageId, score, reasons };
  }).sort((a, b) => b.score - a.score);

  const best = scores[0];
  const runnerUp = scores[1];

  if (!best || best.score === 0) {
    return {
      page: 'unknown',
      label: 'Unknown page',
      confidence: 'none',
      evidence: ['No ACE step could be identified from the tabs, headings, URL, or marker elements.'],
      scores,
      lineContainerFound: false,
    };
  }

  // A clear winner is required; two pages scoring the same means "unknown".
  if (runnerUp && best.score === runnerUp.score) {
    return {
      page: 'unknown',
      label: 'Ambiguous page',
      confidence: 'none',
      evidence: [
        `Two steps scored equally (${best.page} and ${runnerUp.page}). Fill is blocked until the page can be identified.`,
        ...best.reasons,
      ],
      scores,
      lineContainerFound: false,
    };
  }

  const confidence: PageDetection['confidence'] = best.score >= 7 ? 'high' : best.score >= 4 ? 'medium' : 'low';

  return {
    page: best.page,
    label: signatureFor(best.page)?.label ?? 'Unknown page',
    confidence,
    evidence: best.reasons,
    scores,
    lineContainerFound: !!findLineContainer(best.page, doc),
  };
}

/**
 * The container that scopes one open commodity Line Details form.
 * Returning null is fine: detection then falls back to the whole document, and
 * an ambiguous match will block the write rather than hit the wrong line.
 */
export function findLineContainer(page: AcePageId, doc: Document = document): ParentNode | null {
  const signature = signatureFor(page);
  if (!signature) return null;
  for (const selector of signature.lineContainerSelectors ?? []) {
    try {
      const element = doc.querySelector(selector);
      if (element) return element;
    } catch {
      continue;
    }
  }
  // The live screen has no marker attribute, but it does have a heading:
  // "Line 1 Details". Exactly one such panel scopes the fill; two open panels
  // (which ACE does not do) would be as good as none.
  if (signature.lineContainerHeadings?.length) {
    const panels = findSectionRoots(doc, signature.lineContainerHeadings);
    if (panels.length === 1) return panels[0] as Element;
  }
  return null;
}
