/**
 * INTTRA page signatures: which Shipping Instructions screen is on the tab?
 *
 * The helper never navigates INTTRA. It answers "which screen is the operator
 * looking at" so Fill Current Page touches only that screen's fields, and the
 * grid writer runs only on Copy Container Details.
 *
 * The screen names below are what was OBSERVED in the portal's workflow
 * (General Details, Container & Cargo, Copy Container Details, Print
 * Instructions, B/L Documents, Notification Emails). Every tab, heading and
 * URL value is guessed wording, so those rungs report a confidence and the UI
 * refuses to fill when confidence is 'none'. Two markers for Copy Container
 * Details were copied from the live DOM on 2026-09-17, and that screen is
 * also identified by its own grid (content/pageDetector.ts): structure
 * outscores wording. Capture the real tab strip and headings per
 * docs/INTTRA-INTEGRATION.md and the other signatures become exact.
 *
 * This file stays free of DOM code: the dashboard imports it for its labels.
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
    // The whole create page, not just its first section. The live portal
    // (2026-09-20) draws General Details, the routing, Customs Compliance and
    // the Particulars container blocks on ONE page, so this signature covers
    // it and `INTTRA_MAPPINGS_BY_PAGE` serves both scopes here. The id stays
    // `generalDetails` because the stored packages, the dashboard and the
    // override files already speak it.
    page: 'generalDetails',
    label: 'Create Shipping Instruction',
    tabText: ['general details', 'general'],
    headingText: ['general details', 'shipping instruction', 'shipping instructions'],
    // `siworkspace#/create` was copied from the live address bar on
    // 2026-09-20: ship.inttra.e2open.com/siact/siworkspace#/create/<draft id>.
    // It is what tells this page apart from the workspace list, which carries
    // no filing fields. The edit and amend URLs are not captured yet.
    urlHints: ['siworkspace#/create', 'general', 'si/details', 'shippinginstruction'],
    markerSelectors: ["[data-step='generalDetails']", '#generalDetails'],
    captureHint: 'Open the draft. Copy the outerHTML of the active step tab (the highlighted one in the step strip) and of the screen heading.',
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
    // Captured from the live DOM on 2026-09-17: the modal wrapper and the grid
    // container. These, and the grid itself, are what identify this screen;
    // its tab wording cannot, because it is a modal over another step and the
    // step strip behind it still names that step. A marker counts only while
    // it is visible (pageDetector.ts).
    markerSelectors: ['#siCopyContainerWrapperDiv', '#editableGridWrapper', "[data-step='copyContainerDetails']", '#copyContainerDetails'],
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
