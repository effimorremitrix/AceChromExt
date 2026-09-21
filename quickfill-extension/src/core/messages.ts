/**
 * What the popup, the worker and the content script say to each other.
 *
 * Deliberately small. The ACE Helper and the INTTRA Helper exchange full
 * FillReports so their panels can render a row per field; Quickfill renders a
 * count, so the content script tallies its report and sends back three numbers
 * and a list of labels. Nothing that could grow into a screen.
 */

import type { CanonicalShipment } from '../../../src/models/CanonicalInvoice.js';
import type { FilingPackage } from '../../../shared/src/filingPackage.js';
import type { GridPasteBlock } from '../../../inttra-extension/src/content/gridWriter.js';

/** Which portal's buttons the popup shows, decided by the page in the tab. */
export type Portal = 'ace' | 'inttra' | 'none';

/**
 * Who decides which portal is being filled.
 *
 * 'auto' is the default and is what the popup did before the toggle existed:
 * the page in the tab answers. 'ace' and 'inttra' pin it, because the operator
 * knows which portal they are on and the detector has been wrong about it on
 * the live INTTRA portal - the third live run read "INTTRA screen not
 * identified" and blocked Fill on the very page the operator was filling
 * (docs/INTTRA-INTEGRATION.md section 5c). A pin is not a claim about the
 * page: what a pinned fill can and cannot write is still decided by what
 * resolves on the screen, and the result line says when the screen was never
 * identified.
 */
export type FillMode = 'auto' | 'ace' | 'inttra';

export const FILL_MODES: readonly FillMode[] = ['auto', 'ace', 'inttra'];

export function isFillMode(value: unknown): value is FillMode {
  return typeof value === 'string' && (FILL_MODES as readonly string[]).includes(value);
}

/**
 * What is on the tab, and which routes into it exist.
 *
 * The two INTTRA routes are answered INDEPENDENTLY, which is the whole point
 * of this shape. `detectInttraPage` returns one screen, and on the live create
 * page with the Copy Container Details modal open it returns the create page:
 * the marker `#generalDetails` is real and visible and scores 10, plus its
 * heading and URL, against the grid's 10. A popup that picked one branch from
 * that one answer offered no grid route at all while the grid was on the
 * screen. So the form and the grid are asked about separately, and whichever
 * exists is offered - the same reach the INTTRA Helper has from its two
 * always-available tabs.
 */
export interface Where {
  portal: Portal;
  /** "Step 4: Transportation", "Create Shipping Instruction", or why neither. */
  label: string;
  /** True when a commodity line can be filled on this ACE page. */
  hasLines: boolean;
  /**
   * True when this screen has fields to fill: an AESDirect step, or an INTTRA
   * screen whose mapping table is not empty. Copy Container Details has no
   * fields of its own (`INTTRA_MAPPINGS_BY_PAGE.copyContainerDetails` is `[]`),
   * so it is false there and the grid is the only route.
   */
  canFillForm: boolean;
  /**
   * True when a container grid is visible on this page, whatever screen the
   * detector named. Read from `detectGrid`, the same reading the grid writer
   * uses, so the popup and the writer cannot disagree.
   */
  hasGrid: boolean;
  /**
   * True when that grid holds a control that can be typed into. False for a
   * click-to-edit grid, where Copy rows is the only route and therefore the
   * button that should come first.
   */
  gridWritable: boolean;
  /**
   * True when the screen was not identified and the toggle is pinned to
   * INTTRA, so a fill will try the Create Shipping Instruction fields. Said
   * before the click, not after it.
   */
  assumingCreatePage?: boolean;
}

export type QuickfillContentRequest =
  | { type: 'content/where'; mode: FillMode }
  | { type: 'content/fillAce'; shipment: CanonicalShipment; scope: 'shipment' | 'commodityLine'; line?: number }
  | { type: 'content/fillInttra'; package: FilingPackage; scope: 'shipment' | 'container'; containerIndex?: number; mode: FillMode }
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
  /**
   * The screen whose fields were tried when the detector could not name one
   * and the toggle was pinned to INTTRA. Naming it is the price of filling a
   * screen nobody identified.
   */
  assumedScreen?: string;
}

export type QuickfillContentResponse =
  | { ok: true; type: 'content/where'; payload: Where }
  | { ok: true; type: 'content/count'; payload: FillCount }
  /** The containers as the block to paste: one cell per grid column, in the grid's own order, with what each column is. */
  | { ok: true; type: 'content/rows'; payload: GridPasteBlock }
  | { ok: false; error: string };

/** The parsed paste, held for the browsing session so a popup reopen is free. */
export interface StoredPaste {
  text: string;
  summary: string;
  package: FilingPackage;
  shipment: CanonicalShipment;
}

/** Everything the popup reloads itself from: the paste, and where the toggle is set. */
export interface StoredState {
  paste: StoredPaste | null;
  mode: FillMode;
}

export type QuickfillBackgroundRequest =
  | { type: 'store/get' }
  | { type: 'store/set'; payload: StoredPaste }
  | { type: 'store/clear' }
  /** The toggle outlives Clear: clearing the box does not un-pin the portal. */
  | { type: 'store/mode'; mode: FillMode };

export type QuickfillBackgroundResponse =
  | { ok: true; type: 'store/data'; payload: StoredState }
  | { ok: true; type: 'store/cleared' }
  | { ok: false; error: string };

export const CONTENT_NOT_READY =
  'Quickfill is not running in this tab. Open an ACE or INTTRA screen and reload the page.';
