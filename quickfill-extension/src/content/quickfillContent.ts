/**
 * Quickfill content script. One script, both portals.
 *
 * It runs on the CBP hosts and on the INTTRA / e2open hosts, works out which
 * one it is on, and fills the screen already in front of the operator. It
 * reuses the two extensions' own fill orchestration wholesale, so every
 * selector, transformation and write goes through exactly the code the ACE
 * Helper and the INTTRA Helper use - there is no second selector table and no
 * second writer to drift.
 *
 * What it does NOT reuse is the reporting: `fillFields` and `fillInttraFields`
 * return an outcome per field, and this script tallies them to three numbers
 * and throws the rest away, because Quickfill's entire result surface is one
 * line in a popup.
 *
 * It never clicks. No Save, no Save Line, no Add Line, no Add Row, no Continue,
 * no Submit, no Certify. The automation policies in
 * src/content/automationPolicy.ts and
 * inttra-extension/src/content/automationPolicy.ts hold here unchanged: the
 * last click on a filing is the filer's, because the filing is the filer's
 * legal declaration. Being the fast extension does not change who signs.
 */

import { fillFields } from '../../../src/content/filler.js';
import { detectPage } from '../../../src/content/pageDetector.js';
import { DEFAULT_SETTINGS } from '../../../src/core/settings.js';
import type { FillReport } from '../../../src/models/AceField.js';
import { detectInttraPage } from '../../../inttra-extension/src/content/pageDetector.js';
import { fillInttraFields } from '../../../inttra-extension/src/content/filler.js';
import { detectGrid, fillContainerGrid, gridAcceptsTyping, gridRowsAsTsv } from '../../../inttra-extension/src/content/gridWriter.js';
import type { InttraFillReport } from '../../../inttra-extension/src/models/InttraField.js';
import type { FillCount, QuickfillContentRequest, QuickfillContentResponse, Where } from '../core/messages.js';

const CBP = /(^|\.)cbp\.dhs\.gov$/i;

function onCbpHost(): boolean {
  return CBP.test(location.hostname);
}

/** Which portal this tab is, and what can be filled on it. */
function where(): Where {
  if (onCbpHost()) {
    const page = detectPage(document);
    if (page.page === 'unknown' || page.confidence === 'none') {
      return { portal: 'none', label: 'This CBP page is not one of the four AESDirect filing steps.', hasLines: false, isGrid: false, gridWritable: false };
    }
    return { portal: 'ace', label: page.label, hasLines: page.page === 'commodities', isGrid: false, gridWritable: false };
  }

  // The container grid is evidence, and it outranks the step strip.
  //
  // Copy Container Details is a MODAL over whichever step the operator was on
  // (observed on the live portal on 2026-09-17 at
  // ship.inttra.e2open.com/siact/siworkspace#/create/<id>). The step strip
  // behind the overlay still reports that underlying step, so asking the strip
  // "which screen is this?" answers about the page the operator is no longer
  // looking at - on the first live run it said "B/L Documents" while a
  // container grid filled the screen. Detecting the grid itself cannot make
  // that mistake: if a container grid is on the page, the grid is what there is
  // to fill.
  const grid = detectGrid(document);
  if (grid.found) {
    return { portal: 'inttra', label: 'Copy Container Details', hasLines: false, isGrid: true, gridWritable: gridAcceptsTyping(document) };
  }

  const screen = detectInttraPage(document);
  if (screen.page === 'unknown' || screen.confidence === 'none') {
    return { portal: 'none', label: 'This INTTRA page is not one of the Shipping Instructions screens.', hasLines: false, isGrid: false, gridWritable: false };
  }
  return { portal: 'inttra', label: screen.label, hasLines: false, isGrid: screen.page === 'copyContainerDetails', gridWritable: false };
}

/**
 * A fill report, reduced to what the popup shows.
 *
 * `skipped` is not a failure and is not counted as one: a field with no value
 * in the paste was never going to be written, and telling the operator about it
 * is the kind of notification this extension exists to not send. Only a warning
 * or an error - a field that had a value and did not take it - is named.
 */
function countOf(report: FillReport | InttraFillReport): FillCount {
  const written = report.outcomes.filter((outcome) => outcome.status === 'filled' || outcome.status === 'transformed');
  const missed = report.outcomes.filter((outcome) => outcome.status === 'warning' || outcome.status === 'error');
  return { filled: written.length, total: written.length + missed.length, missed: missed.map((outcome) => outcome.label) };
}

function handleMessage(message: QuickfillContentRequest): QuickfillContentResponse {
  switch (message.type) {
    case 'content/where':
      return { ok: true, type: 'content/where', payload: where() };

    case 'content/fillAce': {
      const page = detectPage(document);
      if (page.page === 'unknown' || page.confidence === 'none') {
        return { ok: false, error: 'This is not one of the four AESDirect filing steps, so nothing was filled.' };
      }
      const report = fillFields(
        {
          shipment: message.shipment,
          page: page.page,
          scope: message.scope,
          ...(message.line === undefined ? {} : { line: message.line }),
          settings: DEFAULT_SETTINGS,
          // Quickfill overwrites without asking. The other two extensions leave
          // a field that already holds a different value alone and warn; here
          // the operator pasted the shipment on purpose and is looking at the
          // form, so a stale value in a field is a thing to replace, not a
          // thing to ask about.
          overwrite: true,
        },
        document,
      );
      return { ok: true, type: 'content/count', payload: countOf(report) };
    }

    case 'content/fillInttra': {
      const screen = detectInttraPage(document);
      if (screen.page === 'unknown' || screen.confidence === 'none') {
        return { ok: false, error: 'This is not one of the INTTRA Shipping Instructions screens, so nothing was filled.' };
      }
      const report = fillInttraFields(
        {
          pkg: message.package,
          page: screen.page,
          scope: message.scope,
          ...(message.containerIndex === undefined ? {} : { containerIndex: message.containerIndex }),
          overwrite: true,
          highlightDurationMs: DEFAULT_SETTINGS.highlightDurationMs,
          dispatchBlur: DEFAULT_SETTINGS.dispatchBlur,
        },
        document,
      );
      return { ok: true, type: 'content/count', payload: countOf(report) };
    }

    case 'content/fillGrid': {
      if (!detectGrid(document).found) {
        return { ok: false, error: 'No container grid is on this screen, so nothing was filled. Open Copy Container Details.' };
      }
      const report = fillContainerGrid(message.package, {
        doc: document,
        overwrite: true,
        highlightDurationMs: DEFAULT_SETTINGS.highlightDurationMs,
        dispatchBlur: DEFAULT_SETTINGS.dispatchBlur,
      });
      const missed = report.failed + report.unresolved;
      return {
        ok: true,
        type: 'content/count',
        payload: {
          filled: report.verifiedCells,
          total: report.verifiedCells + missed,
          missed: missed ? [`${missed} grid cell${missed === 1 ? '' : 's'}`] : [],
          // Every cell that had a value held no writable control: the grid
          // opens an editor when a cell is clicked, so there is nothing to
          // write into until then. Observed on the live portal 2026-09-17
          // (Filled 0 of 9). Typing into it is not the way in; pasting is.
          ...(report.verifiedCells === 0 && report.unresolved > 0 ? { useCopyRows: true } : {}),
        },
      };
    }

    // The containers as the grid's own columns, tab separated. The operator
    // clicks the first cell and pastes: that is what Copy Container Details is
    // for, and it needs no selector for the cell editors at all.
    case 'content/gridRows': {
      const tsv = gridRowsAsTsv(message.package, detectGrid(document));
      return { ok: true, type: 'content/rows', payload: { tsv, rows: message.package.containers.length } };
    }

    default:
      return { ok: false, error: 'Unsupported request.' };
  }
}

chrome.runtime.onMessage.addListener((message: QuickfillContentRequest, _sender, sendResponse) => {
  try {
    sendResponse(handleMessage(message));
  } catch (error) {
    sendResponse({ ok: false, error: `Quickfill failed: ${(error as Error).message}` } satisfies QuickfillContentResponse);
  }
  return false;
});
