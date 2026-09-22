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
 * line in a side panel.
 *
 * It never clicks. No Save, no Save Line, no Add Line, no Add Row, no Continue,
 * no Submit, no Certify. The automation policies in
 * src/content/automationPolicy.ts and
 * inttra-extension/src/content/automationPolicy.ts hold here unchanged: the
 * last click on a filing is the filer's, because the filing is the filer's
 * legal declaration. Being the fast extension does not change who signs.
 */

import { fillFields } from '../../../src/content/filler.js';
import { detectPage, type PageDetection } from '../../../src/content/pageDetector.js';
import { DEFAULT_SETTINGS } from '../../../src/core/settings.js';
import type { FillReport } from '../../../src/models/AceField.js';
import { detectInttraPage, hasStructuralEvidence } from '../../../inttra-extension/src/content/pageDetector.js';
import { fillInttraFields } from '../../../inttra-extension/src/content/filler.js';
import { detectGrid, fillContainerGrid, gridAcceptsTyping, gridPasteBlock } from '../../../inttra-extension/src/content/gridWriter.js';
import { inttraFieldsForPage } from '../../../inttra-extension/src/mappings/index.js';
import { inttraPageLabel } from '../../../inttra-extension/src/pages.js';
import type { InttraFillReport, InttraPageId } from '../../../inttra-extension/src/models/InttraField.js';
import type { FillCount, FillMode, QuickfillContentRequest, QuickfillContentResponse, Where } from '../core/messages.js';

const CBP = /(^|\.)cbp\.dhs\.gov$/i;
const INTTRA = /(^|\.)(inttra\.com|e2open\.com)$/i;

/**
 * The screen a pinned INTTRA fill assumes when the detector named none.
 *
 * The live portal has one page the whole shipping instruction is written on,
 * and `INTTRA_MAPPINGS_BY_PAGE` serves both scopes there: the header fields
 * and the per-container Particulars blocks. So there is one honest guess to
 * make and this is it. Nothing is forced by guessing: the fill still writes
 * only where a selector resolves to exactly one control, an ambiguous match is
 * still refused, and a container row the screen does not have is still
 * reported rather than written into another row.
 */
const ASSUMED_PAGE: InttraPageId = 'generalDetails';

function onCbpHost(): boolean {
  return CBP.test(location.hostname);
}

function onInttraHost(): boolean {
  return INTTRA.test(location.hostname);
}

function nothing(label: string): Where {
  return { portal: 'none', label, hasLines: false, canFillForm: false, hasGrid: false, gridWritable: false };
}

/** An AESDirect step, recognised by its content alone (the step tabs, the headings, the URL), or null. */
function acePage(): PageDetection | null {
  const page = detectPage(document);
  return page.page === 'unknown' || page.confidence === 'none' ? null : page;
}

function aceWhere(): Where | null {
  const page = acePage();
  if (!page) return null;
  return { portal: 'ace', label: page.label, hasLines: page.page === 'commodities', canFillForm: true, hasGrid: false, gridWritable: false };
}

/**
 * An INTTRA Shipping Instructions screen, and whatever routes into it exist.
 *
 * The two routes are answered SEPARATELY, and this is the lesson of the live
 * create page. `detectInttraPage` returns one screen, and on the page the
 * operator actually works from it returns the create page even when the Copy
 * Container Details modal is drawn over it: `#generalDetails` is a real,
 * visible marker worth 10, plus its heading and URL, against the grid's 10
 * (docs/INTTRA-INTEGRATION.md section 5d). A popup that read "is this the grid
 * screen?" off that one answer offered no grid route at all while the grid
 * filled the screen. So the grid is asked about directly, with `detectGrid` -
 * the same reading the grid writer uses - and the form is asked about by
 * whether the named screen has any fields at all. Both can be true at once,
 * and on the live create page with the modal open both are.
 *
 * Returns null when the page holds neither, so the callers can fall through.
 * `pinned` is the operator's toggle: it does not conjure a route that is not
 * there, it only says that an unidentified screen should be treated as the
 * create page rather than as nothing.
 */
function inttraWhere(pinned: boolean): Where | null {
  const screen = detectInttraPage(document);
  const named = screen.page !== 'unknown' && screen.confidence !== 'none';
  const grid = detectGrid(document);
  const hasGrid = grid.found;
  const gridWritable = hasGrid && gridAcceptsTyping(document);
  if (named) {
    return {
      portal: 'inttra',
      label: screen.label,
      hasLines: false,
      // Copy Container Details has no fields of its own: its mapping table is
      // empty because the grid is written from GRID_COLUMNS, not field by
      // field. Offering "Fill this screen" there would be a button that can
      // only ever report nothing mapped.
      canFillForm: inttraFieldsForPage(screen.page).length > 0,
      hasGrid,
      gridWritable,
    };
  }
  if (!hasGrid && !pinned) return null;
  return {
    portal: 'inttra',
    label: pinned
      ? `INTTRA screen not identified. Set to INTTRA, so Fill writes the ${inttraPageLabel(ASSUMED_PAGE)} fields.`
      : 'INTTRA screen not identified, but a container grid is on the page, so the grid can still be filled and copied.',
    hasLines: false,
    canFillForm: pinned,
    hasGrid,
    gridWritable,
    ...(pinned ? { assumingCreatePage: true } : {}),
  };
}

/** The INTTRA host with nothing on it the helper can name: Copy rows still needs no screen. */
function unnamedInttra(): Where {
  return {
    portal: 'inttra',
    label: 'INTTRA screen not identified. Copy rows still copies the container block, in the default column order, for Copy Container Details.',
    hasLines: false,
    canFillForm: false,
    hasGrid: false,
    gridWritable: false,
  };
}

/**
 * Which portal this tab is, and what can be filled on it.
 *
 * In 'auto' the host says which detector speaks first and the page's content
 * gives the answer, which is what the popup did before the toggle existed. On
 * a CBP host only an AESDirect step counts. On an INTTRA host the INTTRA
 * detector goes first, and when it identifies nothing the page is still
 * INTTRA: the operator may well be looking at the grid (the fifth live run: a
 * grid the detector had never been shown the shape of), and Copy rows needs no
 * detection at all - the block is the package's containers in the default
 * column order - so that button stays, alone, and its result line says the
 * order is the default one. Off both portals (the playground build, which runs
 * on pages opened from disk) an AESDirect step is looked for first: the INTTRA
 * signatures are wording guesses that an ACE page can brush against - Step 2's
 * "parties" reads as the B/L Documents screen's Parties heading - and a step
 * named by its own tabs and headings is the better answer.
 *
 * Pinned, the host is not consulted at all. That is the point of pinning: the
 * operator is looking at the portal and the detector is not, so their answer
 * wins. What the pin cannot do is make a fill write something that is not on
 * the screen, and the label says plainly when the page disagrees.
 */
function where(mode: FillMode): Where {
  if (mode === 'ace') {
    return aceWhere() ?? nothing('Set to ACE, and this page is not one of the four AESDirect filing steps, so there is nothing here to fill. Switch to Auto or INTTRA, or open an AESDirect step.');
  }
  if (mode === 'inttra') {
    // An AESDirect step is not an unidentified INTTRA screen. Assuming the
    // create page on one would aim INTTRA's label ladders at an ACE form,
    // where a wording like "Vessel" or "Booking Number" can brush against a
    // real control, so a mis-set toggle would write INTTRA's values into ACE's
    // boxes. On a named step the pin falls back to Copy rows, which touches
    // nothing but the clipboard.
    return inttraWhere(acePage() === null) ?? unnamedInttra();
  }
  if (onCbpHost()) {
    return aceWhere() ?? nothing('This CBP page is not one of the four AESDirect filing steps.');
  }
  if (onInttraHost()) return inttraWhere(false) ?? aceWhere() ?? unnamedInttra();
  return aceWhere() ?? inttraWhere(false) ?? nothing('This page is neither an AESDirect step nor an INTTRA screen.');
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
      return { ok: true, type: 'content/where', payload: where(message.mode) };

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
      const named = screen.page !== 'unknown' && screen.confidence !== 'none';
      // Pinned to INTTRA, an unidentified screen is filled as the create page
      // rather than refused. The refusal was right while the toggle did not
      // exist - a fill has to aim at some mapping table, and guessing one is
      // not the helper's call to make silently - but an operator who has
      // pinned the portal has made it, so the assumption is made, named in the
      // result line, and never made in 'auto'.
      const step = acePage();
      const page = named ? screen.page : message.mode === 'inttra' && step === null ? ASSUMED_PAGE : null;
      if (page === null) {
        return {
          ok: false,
          error: step
            ? `This tab is ${step.label}, an AESDirect step, not an INTTRA screen, so nothing was filled. Set the toggle to Auto or ACE.`
            : 'This is not one of the INTTRA Shipping Instructions screens, so nothing was filled. Set the toggle to INTTRA to fill it as the Create Shipping Instruction page anyway.',
        };
      }
      // A container-scoped fill with no index means every container: the live
      // page repeats the Particulars block per container, numbered from 1
      // upward, so one press fills every row and each row's number and seals
      // travel together (inttra-extension/src/content/filler.ts).
      const rows =
        message.scope === 'container' && message.containerIndex === undefined
          ? message.package.containers.map((_, index) => index)
          : [message.containerIndex];
      const counts = rows.map((containerIndex) =>
        countOf(
          fillInttraFields(
            {
              pkg: message.package,
              page,
              scope: message.scope,
              ...(containerIndex === undefined ? {} : { containerIndex }),
              overwrite: true,
              highlightDurationMs: DEFAULT_SETTINGS.highlightDurationMs,
              dispatchBlur: DEFAULT_SETTINGS.dispatchBlur,
            },
            document,
          ),
        ),
      );
      return {
        ok: true,
        type: 'content/count',
        payload: {
          filled: counts.reduce((sum, count) => sum + count.filled, 0),
          total: counts.reduce((sum, count) => sum + count.total, 0),
          missed: [...new Set(counts.flatMap((count) => count.missed))],
          ...(named ? {} : { assumedScreen: inttraPageLabel(page) }),
        },
      };
    }

    // The grid is filled and copied by what is on the page, never by what the
    // detector called the page. On the live create page with the modal open
    // the detector names the create page, and the grid is there all the same.
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

    // The containers as the grid's own columns, one cell per column and blank
    // where nothing feeds one, so the block lines up with the grid. The
    // operator clicks the first Container Number cell and pastes: that is what
    // Copy Container Details is for, and it needs no selector for the cell
    // editors at all.
    case 'content/gridRows':
      return { ok: true, type: 'content/rows', payload: gridPasteBlock(message.package, detectGrid(document)) };

    default:
      return { ok: false, error: 'Unsupported request.' };
  }
}

/** How long an INTTRA frame with nothing structural on it waits before answering, so a frame that has the screen answers first. */
const QUIET_FRAME_DELAY_MS = 150;

/**
 * One listener per frame, however many times this script is started.
 *
 * Chrome injects a content script when a page LOADS, so a tab that was already
 * open when this build was loaded or rebuilt has none - and on 2026-09-21 that
 * was the whole of the live run: the popup could reach no frame and withdrew
 * every route, including Copy rows, which needs nothing from the page. The
 * popup now starts this script itself in a tab that has none
 * (`chrome.scripting.executeScript`, docs/QUICKFILL.md section 6b). A frame
 * that already had it would then register a SECOND listener, both would answer
 * the same message, and Chrome would report "Could not send response more than
 * once" - so the flag below is the whole of the idempotence. It lives in the
 * extension's isolated world, one per frame, invisible to the page.
 */
interface QuickfillFrame {
  __quickfillListening?: boolean;
}

const frame = globalThis as unknown as QuickfillFrame;

if (!frame.__quickfillListening) {
  frame.__quickfillListening = true;

  // The script runs in every frame of the tab and the popup keeps the first
  // reply. On an INTTRA tab a frame that holds the screen (a visible container
  // grid, or a captured marker) answers at once and a frame that holds neither
  // answers after a moment, so the frame with the screen wins whichever frame
  // the portal drew it in. A CBP tab answers at once: the ACE steps are never
  // in a child frame.
  chrome.runtime.onMessage.addListener((message: QuickfillContentRequest, _sender, sendResponse) => {
    const respond = (): void => {
      try {
        sendResponse(handleMessage(message));
      } catch (error) {
        sendResponse({ ok: false, error: `Quickfill failed: ${(error as Error).message}` } satisfies QuickfillContentResponse);
      }
    };
    // Reading the page can throw in a frame the portal is still drawing, and a
    // listener that throws closes its port without answering. With every frame
    // silent the popup reads the tab as not running and starts a second copy of
    // this script into it, which is a worse answer than "not this frame".
    let structural = false;
    try {
      structural = onCbpHost() || hasStructuralEvidence();
    } catch {
      structural = false;
    }
    if (structural) {
      respond();
      return false;
    }
    setTimeout(respond, QUIET_FRAME_DELAY_MS);
    return true;
  });
}
