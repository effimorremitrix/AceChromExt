/**
 * INTTRA Helper content script.
 *
 * Runs only on the INTTRA / e2open hosts in the manifest. It answers
 * page-detection, diagnostics and fill requests from the popup and the panel.
 * It never clicks an INTTRA control, never navigates, never submits, and
 * never sees a credential: the operator logs in as usual and the helper
 * only ever types into fields on a screen the operator already opened.
 *
 * It runs in every frame of the tab (all_frames), and the panel sends to the
 * tab without naming a frame, so Chrome keeps the first reply. A frame that
 * holds the screen (a visible container grid, or a captured marker) answers
 * at once; a frame that holds neither answers after a moment, so the frame
 * with the screen wins the race whichever frame the portal drew it in.
 */

import { clearAllHighlights, revealField } from '../../../src/content/highlight.js';
import { detectField } from '../../../src/content/fieldDetector.js';
import { emptyOverrides, unknownOverrideKeys, type SelectorOverrides } from '../../../src/ace/selectors/overrides.js';
import { DEFAULT_INTTRA_SETTINGS, loadInttraSettings, onInttraSettingsChanged, type InttraHelperSettings } from '../core/settings.js';
import type { InttraContentRequest, InttraContentResponse, InttraDiagnosticsSnapshot, InttraGridStatus } from '../core/messages.js';
import { debug, setDebugLogging, warn } from '../core/logger.js';
import { loadInttraOverrides, onInttraOverridesChanged } from '../core/overridesStore.js';
import { inttraFieldsForPage, resolveInttraFields } from '../mappings/index.js';
import { detectInttraPage, hasStructuralEvidence } from './pageDetector.js';
import { fillInttraFields } from './filler.js';
import { detectGrid, fillContainerGrid, gridAcceptsTyping, gridPasteBlock } from './gridWriter.js';

const VERSION = '0.1.0';

/** How long a frame with nothing structural on it waits before answering, so a frame that has the screen answers first. */
const QUIET_FRAME_DELAY_MS = 150;

let settings: InttraHelperSettings = { ...DEFAULT_INTTRA_SETTINGS };
let overrides: SelectorOverrides = emptyOverrides();

function log(kind: 'fill' | 'diagnostics' | 'note', message: string, detail?: string): void {
  try {
    void chrome.runtime.sendMessage({ type: 'log/append', kind, message, ...(detail ? { detail } : {}) });
  } catch {
    // A missing log line must never break a fill.
  }
}

function buildDiagnostics(): InttraDiagnosticsSnapshot {
  const page = detectInttraPage();
  const fields: InttraDiagnosticsSnapshot['fields'] = [];
  for (const mapping of resolveInttraFields(page.page, undefined, overrides)) {
    const detection = detectField(mapping, { root: document });
    const { element: _element, unwritableElement: _unwritable, ...rest } = detection;
    void _element;
    void _unwritable;
    fields.push({ key: mapping.key, label: mapping.label, scope: mapping.scope, verificationStatus: mapping.verificationStatus, detection: rest, ...(mapping.devtoolsHint ? { devtoolsHint: mapping.devtoolsHint } : {}) });
  }
  const grid = detectGrid(document);
  const { root: _root, shape: _shape, ...gridDetection } = grid;
  void _root;
  void _shape;
  return {
    page,
    url: location.href,
    fields,
    grid: gridDetection,
    generatedAt: new Date().toISOString(),
    overrides: { capturedAt: overrides.capturedAt, fieldKeys: Object.keys(overrides.fields), unknownKeys: unknownOverrideKeys(inttraFieldsForPage(page.page), overrides) },
  };
}

function gridStatus(): InttraGridStatus {
  const found = detectGrid(document).found;
  return { found, acceptsTyping: found && gridAcceptsTyping(document) };
}

function handleMessage(message: InttraContentRequest): InttraContentResponse {
  switch (message.type) {
    case 'content/ping':
      return { ok: true, type: 'content/pong', version: VERSION };
    case 'content/detectPage':
      return { ok: true, type: 'content/page', payload: detectInttraPage(), grid: gridStatus() };
    case 'content/diagnostics': {
      const snapshot = buildDiagnostics();
      log('diagnostics', `Diagnostics on ${snapshot.page.label}: ${snapshot.fields.filter((field) => field.detection.status === 'FOUND').length}/${snapshot.fields.length} fields, grid ${snapshot.grid.found ? 'found' : 'not found'}.`);
      return { ok: true, type: 'content/diagnostics', payload: snapshot };
    }
    case 'content/fill': {
      const page = detectInttraPage();
      if (page.page === 'unknown') {
        return { ok: false, error: 'The INTTRA screen could not be identified, so nothing was filled. Open one of the Shipping Instructions screens (General Details, Container & Cargo, Print Instructions, B/L Documents).' };
      }
      const report = fillInttraFields(
        {
          pkg: message.package,
          page: page.page,
          scope: message.scope,
          ...(message.containerIndex === undefined ? {} : { containerIndex: message.containerIndex }),
          ...(message.dryRun ? { dryRun: true } : {}),
          ...(message.overwrite ? { overwrite: true } : {}),
          overrides,
          highlightDurationMs: settings.highlightDurationMs,
          dispatchBlur: settings.dispatchBlur,
        },
        document,
      );
      debug('fill report', report);
      log('fill', `${message.dryRun ? 'Dry run on' : 'Filled'} ${page.label}: filled ${report.filled}, skipped ${report.skipped}, warnings ${report.warnings}, errors ${report.errors}.`);
      return { ok: true, type: 'content/fillReport', payload: report };
    }
    case 'content/fillGrid': {
      const page = detectInttraPage();
      // A visible container grid identifies the screen as Copy Container
      // Details whatever the step strip says (pageDetector.ts), so this branch
      // is reached only when there is no grid on the document at all.
      if (page.page !== 'copyContainerDetails' && page.page !== 'unknown' && !message.anyPage) {
        return { ok: false, error: `The tab shows ${page.label} and no container grid is on it. Open Copy Container Details first, or tick "Look for the grid even when the screen was not identified".` };
      }
      const report = fillContainerGrid(message.package, {
        doc: document,
        dryRun: message.dryRun ?? false,
        overwrite: message.overwrite ?? false,
        highlightDurationMs: settings.highlightDurationMs,
        dispatchBlur: settings.dispatchBlur,
      });
      log('fill', `${message.dryRun ? 'Dry run on' : 'Filled'} the container grid: containers ${report.containersFilled}/${report.rowsNeeded}, verified cells ${report.verifiedCells}, warnings ${report.warnings}, failed ${report.failed}, unresolved ${report.unresolved}.`);
      return { ok: true, type: 'content/gridReport', payload: report };
    }
    case 'content/gridRows': {
      const block = gridPasteBlock(message.package, detectGrid(document));
      log('note', `Copied ${block.rows} container row(s) as ${block.width} column(s)${block.fromGrid ? " in the grid's own order" : ' in the default order (no grid found)'}${block.blank.length ? `; left blank: ${block.blank.join(', ')}` : ''}.`);
      return { ok: true, type: 'content/rows', payload: block };
    }
    case 'content/revealField':
      return { ok: true, type: 'content/revealed', found: revealField(message.key) };
    case 'content/clearHighlights':
      clearAllHighlights();
      return { ok: true, type: 'content/ok' };
    default:
      return { ok: false, error: 'Unsupported request.' };
  }
}

function boot(): void {
  setDebugLogging(settings.debugMode);
  void loadInttraSettings()
    .then((loaded) => {
      settings = loaded;
      setDebugLogging(loaded.debugMode);
    })
    .catch((error: unknown) => warn('Could not load settings:', error));
  onInttraSettingsChanged((next) => {
    settings = next;
    setDebugLogging(next.debugMode);
  });
  void loadInttraOverrides()
    .then((loaded) => {
      overrides = loaded;
    })
    .catch((error: unknown) => warn('Could not load selector overrides:', error));
  onInttraOverridesChanged((next) => {
    overrides = next;
  });

  chrome.runtime.onMessage.addListener((message: InttraContentRequest, _sender, sendResponse) => {
    const respond = (): void => {
      try {
        sendResponse(handleMessage(message));
      } catch (error) {
        sendResponse({ ok: false, error: `INTTRA Helper failed: ${(error as Error).message}` } satisfies InttraContentResponse);
      }
    };
    if (hasStructuralEvidence()) {
      respond();
      return false;
    }
    // Nothing structural here: let a frame that has the screen answer first.
    setTimeout(respond, QUIET_FRAME_DELAY_MS);
    return true;
  });

  debug(`INTTRA Helper content script ${VERSION} ready on ${location.host}`);
}

boot();
