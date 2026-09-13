/**
 * Content script entry point.
 *
 * Runs only on the CBP/ACE hosts listed in the manifest. Responsibilities:
 *   - F2 calculator overlay on the focused field;
 *   - answering page-detection, diagnostics, and fill requests from the popup.
 *
 * It never clicks an ACE control, never navigates, and never submits. Filling
 * happens only in response to an explicit user action in the extension UI.
 */

import { configureCalculator, closeCalculator, isCalculatorOpen, isCalculatorTarget, openCalculator, repositionCalculator } from '../calculator/calculatorUI.js';
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, type AceHelperSettings } from '../core/settings.js';
import { setDebugLogging, debug, warn } from '../core/logger.js';
import type { ContentRequest, ContentResponse, DiagnosticsSnapshot } from '../core/messages.js';
import { fieldsForPage, resolveFields } from '../ace/mappings/index.js';
import { emptyOverrides, unknownOverrideKeys, type SelectorOverrides } from '../ace/selectors/overrides.js';
import { loadOverrides, onOverridesChanged } from '../ace/selectors/overridesStore.js';
import { detectField } from './fieldDetector.js';
import { detectPage, findLineContainer } from './pageDetector.js';
import { fillFields } from './filler.js';
import { clearAllHighlights, revealField } from './highlight.js';

const VERSION = '0.1.0';

let settings: AceHelperSettings = { ...DEFAULT_SETTINGS };
/**
 * Operator-captured selectors, read from storage here rather than accepted
 * from the panel: the content script is the only side that talks to the ACE
 * DOM, so it should not take a selector on trust from another context.
 */
let overrides: SelectorOverrides = emptyOverrides();

/** Fire-and-forget append to the session log owned by the background worker. */
function log(kind: 'fill' | 'calculator' | 'diagnostics' | 'note', message: string, detail?: string): void {
  try {
    void chrome.runtime.sendMessage({ type: 'log/append', kind, message, ...(detail ? { detail } : {}) });
  } catch {
    // The worker may be asleep or the extension reloading. A missing log line
    // must never break a fill.
  }
}

function applySettings(next: AceHelperSettings): void {
  settings = next;
  setDebugLogging(next.debugMode);
  configureCalculator({ rounding: () => settings.rounding, dispatchBlur: settings.dispatchBlur });
}

function buildDiagnostics(): DiagnosticsSnapshot {
  const page = detectPage();
  const fields: DiagnosticsSnapshot['fields'] = [];

  for (const mapping of resolveFields(page.page, undefined, overrides)) {
    const root = mapping.scope === 'commodityLine' ? findLineContainer(page.page) ?? document : document;
    const detection = detectField(mapping, { root });
    const { element: _element, ...rest } = detection;
    void _element;
    fields.push({
      key: mapping.key,
      label: mapping.label,
      scope: mapping.scope,
      verificationStatus: mapping.verificationStatus,
      detection: rest,
      ...(mapping.devtoolsHint ? { devtoolsHint: mapping.devtoolsHint } : {}),
    });
  }

  return {
    page,
    url: location.href,
    fields,
    generatedAt: new Date().toISOString(),
    overrides: {
      capturedAt: overrides.capturedAt,
      fieldKeys: Object.keys(overrides.fields),
      unknownKeys: unknownOverrideKeys(fieldsForPage(page.page), overrides),
    },
  };
}

function handleMessage(message: ContentRequest): ContentResponse {
  switch (message.type) {
    case 'content/ping':
      return { ok: true, type: 'content/pong', version: VERSION };

    case 'content/detectPage':
      return { ok: true, type: 'content/page', payload: detectPage() };

    case 'content/diagnostics': {
      const snapshot = buildDiagnostics();
      const found = snapshot.fields.filter((field) => field.detection.status === 'FOUND').length;
      log('diagnostics', `Diagnostics on ${snapshot.page.label}: ${found}/${snapshot.fields.length} fields detected.`);
      return { ok: true, type: 'content/diagnostics', payload: snapshot };
    }

    case 'content/fill': {
      const page = detectPage();
      if (page.page === 'unknown') {
        return {
          ok: false,
          error: 'The current ACE page could not be identified, so nothing was filled. Open one of the filing steps (Shipment, Parties, Commodities, Transportation).',
        };
      }
      const report = fillFields(
        {
          shipment: message.shipment,
          page: page.page,
          scope: message.scope,
          ...(message.line === undefined ? {} : { line: message.line }),
          settings: message.settings ?? settings,
          ...(message.dryRun ? { dryRun: true } : {}),
          ...(message.overwrite ? { overwrite: true } : {}),
          overrides,
        },
        document,
      );
      debug('fill report', report);
      logFill(report, message.dryRun === true);
      return { ok: true, type: 'content/fillReport', payload: report };
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

/**
 * One log line per fill, plus a line per value that was transformed on its way
 * in. The transformations are the ones somebody will want to trace later:
 * "ACE says 79832 kg and the invoice said 176000" is exactly the question.
 */
function logFill(report: ReturnType<typeof fillFields>, dryRun: boolean): void {
  const scope = report.scope === 'commodityLine' ? `Commodity line ${report.line}` : 'Shipment page';
  const verb = dryRun ? 'Dry run on' : 'Filled';
  log(
    'fill',
    `${verb} ${scope} (${report.page}): filled ${report.filled}, skipped ${report.skipped}, warnings ${report.warnings}, errors ${report.errors}.`,
  );
  for (const outcome of report.outcomes) {
    if (!outcome.transform || outcome.written === undefined) continue;
    log(
      'fill',
      `${scope} ${outcome.label}: ${outcome.original || '(no original)'} -> ${outcome.written}`,
      outcome.transform,
    );
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isCalculatorOpen()) {
    // The overlay handles Escape while focused; this covers Escape pressed
    // after focus moved back to the page.
    closeCalculator();
    return;
  }

  if (event.key !== 'F2' || event.ctrlKey || event.altKey || event.metaKey) return;

  const active = document.activeElement;
  if (!isCalculatorTarget(active)) {
    debug('F2 ignored: the focused element is not a writable text/number field.');
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  openCalculator(active);
  log('calculator', 'F2 calculator opened on a numeric field.');
}

function boot(): void {
  applySettings({ ...DEFAULT_SETTINGS });

  void loadSettings()
    .then(applySettings)
    .catch((error: unknown) => warn('Could not load settings:', error));

  onSettingsChanged(applySettings);

  void loadOverrides()
    .then((loaded) => {
      overrides = loaded;
    })
    .catch((error: unknown) => warn('Could not load selector overrides:', error));

  onOverridesChanged((next) => {
    overrides = next;
  });

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', repositionCalculator, true);
  window.addEventListener('resize', repositionCalculator);

  chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
    try {
      sendResponse(handleMessage(message));
    } catch (error) {
      sendResponse({ ok: false, error: `ACE Helper failed: ${(error as Error).message}` } satisfies ContentResponse);
    }
    // Responses are synchronous; returning false closes the channel.
    return false;
  });

  debug(`ACE Helper content script ${VERSION} ready on ${location.host}`);
}

boot();
