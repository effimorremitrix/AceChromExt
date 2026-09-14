/**
 * INTTRA page signatures: which Shipping Instructions screen is on the tab?
 *
 * The helper never navigates INTTRA. It answers "which screen is the operator
 * looking at" so Fill Current Page touches only that screen's fields, and the
 * grid writer runs only on Copy Container Details.
 *
 * The screen names below are what was OBSERVED in the portal's workflow
 * (General Details, Container & Cargo, Copy Container Details, Print
 * Instructions, B/L Documents, Notification Emails). None of the tab, heading,
 * URL or marker values has been captured from the live DOM, so detection is
 * by wording only and reports its confidence; the UI refuses to fill when
 * confidence is 'none'. Capture the real tab strip and headings per
 * docs/INTTRA-INTEGRATION.md and the signatures become exact.
 */

import type { InttraPageId } from './models/InttraField.js';

export interface InttraPageSignature {
  page: Exclude<InttraPageId, 'unknown'>;
  label: string;
  tabText: string[];
  headingText: string[];
  urlHints: string[];
  markerSelectors: string[];
  /** What to capture from DevTools to make this page's detection exact. */
  captureHint: string;
}

export const INTTRA_PAGE_SIGNATURES: InttraPageSignature[] = [
  {
    page: 'generalDetails',
    label: 'General Details',
    tabText: ['general details', 'general'],
    headingText: ['general details', 'shipping instruction', 'shipping instructions'],
    urlHints: ['general', 'si/details', 'shippinginstruction'],
    markerSelectors: ["[data-step='generalDetails']", '#generalDetails'],
    captureHint: 'Open General Details. Copy the outerHTML of the active step tab (the highlighted one in the step strip) and of the screen heading.',
  },
  {
    page: 'containerCargo',
    label: 'Container & Cargo',
    tabText: ['container & cargo', 'container and cargo', 'container cargo', 'containers'],
    headingText: ['container & cargo', 'container and cargo', 'container details', 'cargo details'],
    urlHints: ['container', 'cargo'],
    markerSelectors: ["[data-step='containerCargo']", '#containerCargo'],
    captureHint: 'Open Container & Cargo. Copy the outerHTML of the active step tab and of the heading above the first container form.',
  },
  {
    page: 'copyContainerDetails',
    label: 'Copy Container Details',
    tabText: ['copy container details', 'copy container', 'copy containers'],
    headingText: ['copy container details', 'copy container', 'paste container details'],
    urlHints: ['copycontainer', 'copy-container', 'containergrid'],
    markerSelectors: ["[data-step='copyContainerDetails']", '#copyContainerDetails'],
    captureHint: 'Open Copy Container Details. Copy the outerHTML of the grid root, its header row, one empty row, one populated row, and a cell while it is being edited. See docs/INTTRA-INTEGRATION.md for the full list.',
  },
  {
    page: 'printInstructions',
    label: 'Print Instructions',
    tabText: ['print instructions', 'print'],
    headingText: ['print instructions', 'b/l print', 'bill of lading print'],
    urlHints: ['print'],
    markerSelectors: ["[data-step='printInstructions']", '#printInstructions'],
    captureHint: 'Open Print Instructions. Copy the outerHTML of the active step tab and the heading.',
  },
  {
    page: 'blDocuments',
    label: 'B/L Documents',
    tabText: ['b/l documents', 'bl documents', 'documents', 'b/l'],
    headingText: ['b/l documents', 'bill of lading documents', 'document details', 'parties'],
    urlHints: ['document', 'bl', 'parties'],
    markerSelectors: ["[data-step='blDocuments']", '#blDocuments'],
    captureHint: 'Open B/L Documents. Copy the outerHTML of the active step tab, the heading, and the Consignee panel including its heading.',
  },
  {
    page: 'notificationEmails',
    label: 'Notification Emails',
    tabText: ['notification emails', 'notifications', 'notification'],
    headingText: ['notification emails', 'notifications', 'email notifications'],
    urlHints: ['notification', 'email'],
    markerSelectors: ["[data-step='notificationEmails']", '#notificationEmails'],
    captureHint: 'Open Notification Emails. Copy the outerHTML of the active step tab and the heading.',
  },
];

export function inttraSignatureFor(page: InttraPageId): InttraPageSignature | undefined {
  return INTTRA_PAGE_SIGNATURES.find((signature) => signature.page === page);
}

export function inttraPageLabel(page: InttraPageId): string {
  return inttraSignatureFor(page)?.label ?? 'Unknown page';
}
