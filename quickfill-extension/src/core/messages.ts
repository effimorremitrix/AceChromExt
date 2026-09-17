/**
 * What the popup, the worker and the content script say to each other.
 *
 * Deliberately four messages. The ACE Helper and the INTTRA Helper exchange
 * full FillReports so their panels can render a row per field; Quickfill
 * renders a count, so the content script tallies its report and sends back
 * three numbers and a list of labels. Nothing that could grow into a screen.
 */

import type { CanonicalShipment } from '../../../src/models/CanonicalInvoice.js';
import type { FilingPackage } from '../../../shared/src/filingPackage.js';

/** Which pair of buttons the popup shows, decided by the page in the tab. */
export type Portal = 'ace' | 'inttra' | 'none';

export interface Where {
  portal: Portal;
  /** "Step 4: Transportation", "General Details", or why neither. */
  label: string;
  /** True when a commodity line can be filled on this ACE page. */
  hasLines: boolean;
  /** True when this INTTRA screen is the container grid. */
  isGrid: boolean;
  /**
   * True when the grid holds a control that can be typed into. False for a
   * click-to-edit grid, where Copy rows is the only route and therefore the
   * button that should come first.
   */
  gridWritable: boolean;
}

export type QuickfillContentRequest =
  | { type: 'content/where' }
  | { type: 'content/fillAce'; shipment: CanonicalShipment; scope: 'shipment' | 'commodityLine'; line?: number }
  | { type: 'content/fillInttra'; package: FilingPackage; scope: 'shipment' | 'container'; containerIndex?: number }
  | { type: 'content/fillGrid'; package: FilingPackage }
  | { type: 'content/gridRows'; package: FilingPackage };

/** The whole result surface: how many, and which ones did not take. */
export interface FillCount {
  filled: number;
  total: number;
  /** Labels of the fields that were not written, for the second line. */
  missed: string[];
  /**
   * Set when nothing could be written because the grid's cells hold no
   * writable control - the click-to-edit case. The popup turns this into the
   * one sentence that tells the operator to paste instead.
   */
  useCopyRows?: boolean;
}

export type QuickfillContentResponse =
  | { ok: true; type: 'content/where'; payload: Where }
  | { ok: true; type: 'content/count'; payload: FillCount }
  /** The containers as tab-separated rows, in the grid's own column order. */
  | { ok: true; type: 'content/rows'; payload: { tsv: string; rows: number } }
  | { ok: false; error: string };

/** The parsed paste, held for the browsing session so a popup reopen is free. */
export interface StoredPaste {
  text: string;
  summary: string;
  package: FilingPackage;
  shipment: CanonicalShipment;
}

export type QuickfillBackgroundRequest =
  | { type: 'store/get' }
  | { type: 'store/set'; payload: StoredPaste }
  | { type: 'store/clear' };

export type QuickfillBackgroundResponse =
  | { ok: true; type: 'store/data'; payload: StoredPaste | null }
  | { ok: true; type: 'store/cleared' }
  | { ok: false; error: string };

export const CONTENT_NOT_READY =
  'Quickfill is not running in this tab. Open an ACE or INTTRA screen and reload the page.';
