/**
 * ACE page signatures.
 *
 * The extension never navigates ACE. It only answers "which step is the user
 * looking at right now?" so that Fill Current Page touches only the fields
 * that belong to that step.
 *
 * The tab and heading wordings for Steps 1-3 match the live portal (captured
 * 2026-09-14: tabs read "Step 1: Shipment" ... "Step 4: Transportation"; the
 * Commodities step has "Line Summary" / "Line Details" sub-tabs and the open
 * line is headed "Line N Details"). The marker selectors are still
 * placeholders; detection therefore reports a confidence level and the UI
 * refuses to fill when confidence is 'none'.
 */

import type { AcePageId } from '../models/AceField.js';

export interface PageSignature {
  page: Exclude<AcePageId, 'unknown'>;
  label: string;
  /** Matched against the visible text of the active tab/step element. */
  tabText: string[];
  /** Matched against the page's main heading text. */
  headingText: string[];
  /** Matched against the URL path/hash, lower-cased. */
  urlHints: string[];
  /** If any of these selectors resolves, it is strong evidence for the page. */
  markerSelectors: string[];
  /**
   * Container that scopes a single commodity Line Details form, when the page
   * has one. Used to keep line-level writes inside the open line.
   */
  lineContainerSelectors?: string[];
  /**
   * Heading text of that form ("Line 1 Details" on the live screen; `N`
   * stands for the line number). Tried after the CSS selectors: the panel
   * headed by one of these is the container.
   */
  lineContainerHeadings?: string[];
}

export const PAGE_SIGNATURES: PageSignature[] = [
  {
    page: 'shipment',
    label: 'Step 1: Shipment',
    tabText: ['shipment', 'step 1'],
    headingText: ['shipment', 'shipment information'],
    urlHints: ['shipment', 'step1'],
    markerSelectors: ['#shipmentReferenceNumber', "[data-section='shipment']"],
  },
  {
    page: 'parties',
    label: 'Step 2: Parties',
    tabText: ['parties', 'step 2'],
    headingText: ['parties', 'usppi', 'ultimate consignee'],
    urlHints: ['parties', 'step2'],
    markerSelectors: ['#ultimateConsigneeName', "[data-section='ultimateConsignee']"],
  },
  {
    page: 'commodities',
    label: 'Step 3: Commodities',
    tabText: ['commodities', 'commodity', 'step 3'],
    headingText: ['commodities', 'commodity lines', 'line details', 'line summary', 'details'],
    urlHints: ['commodit', 'step3', 'line'],
    markerSelectors: ['#scheduleBNumber', "[data-section='commodityLine']"],
    lineContainerSelectors: ["[data-section='commodityLine']", '#lineDetails', "[aria-label='Line Details']"],
    lineContainerHeadings: ['Line Details', 'Line N Details'],
  },
  {
    page: 'transportation',
    label: 'Step 4: Transportation',
    tabText: ['transportation', 'transport', 'step 4'],
    headingText: ['transportation', 'conveyance'],
    urlHints: ['transport', 'step4'],
    markerSelectors: ['#conveyanceName', "[data-section='transportation']"],
  },
];

export function signatureFor(page: AcePageId): PageSignature | undefined {
  return PAGE_SIGNATURES.find((signature) => signature.page === page);
}

export function pageLabel(page: AcePageId): string {
  return signatureFor(page)?.label ?? 'Unknown page';
}
