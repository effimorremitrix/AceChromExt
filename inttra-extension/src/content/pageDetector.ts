/**
 * Which INTTRA screen is on the tab?
 *
 * Same scoring as the ACE detector, against the INTTRA signatures: active
 * tab text, headings, URL, marker elements. The score becomes a confidence;
 * 'none' blocks filling. A tie between two screens is 'unknown'.
 */

import type { InttraPageId } from '../models/InttraField.js';
import { INTTRA_PAGE_SIGNATURES, inttraSignatureFor, type InttraPageSignature } from '../pages.js';

export interface InttraPageDetection {
  page: InttraPageId;
  label: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  evidence: string[];
  scores: Array<{ page: InttraPageId; score: number; reasons: string[] }>;
}

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

function scorePage(signature: InttraPageSignature, context: { tabs: string[]; headings: string[]; url: string; doc: Document }): { score: number; reasons: string[] } {
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
  }).sort((a, b) => b.score - a.score);

  const best = scores[0];
  const runnerUp = scores[1];
  if (!best || best.score === 0) {
    return { page: 'unknown', label: 'Unknown page', confidence: 'none', evidence: ['No INTTRA screen could be identified from the tabs, headings, URL, or marker elements.'], scores };
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
