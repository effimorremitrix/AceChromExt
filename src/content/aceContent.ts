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
import { fieldsForPage } from '../ace/mappings/index.js';
import { detectField } from './fieldDetector.js';
import { detectPage, findLineContainer } from './pageDetector.js';
import { fillFields } from './filler.js';
import { clearAllHighlights, revealField } from './highlight.js';

const VERSION = '0.1.0';

let settings: AceHelperSettings = { ...DEFAULT_SETTINGS };

function applySettings(next: AceHelperSettings): void {
  settings = next;
  setDebugLogging(next.debugMode);
  configureCalculator({ rounding: () => settings.rounding, dispatchBlur: settings.dispatchBlur });
}

function buildDiagnostics(): DiagnosticsSnapshot {
  const page = detectPage();
  const fields: DiagnosticsSnapshot['fields'] = [];

  for (const mapping of fieldsForPage(page.page)) {
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

  return { page, url: location.href, fields, generatedAt: new Date().toISOString() };
}

function handleMessage(message: ContentRequest): ContentResponse {
  switch (message.type) {
    case 'content/ping':
      return { ok: true, type: 'content/pong', version: VERSION };

    case 'content/detectPage':
      return { ok: true, type: 'content/page', payload: detectPage() };

    case 'content/diagnostics':
      return { ok: true, type: 'content/diagnostics', payload: buildDiagnostics() };

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
        },
        document,
      );
      debug('fill report', report);
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
}

function boot(): void {
  applySettings({ ...DEFAULT_SETTINGS });

  void loadSettings()
    .then(applySettings)
    .catch((error: unknown) => warn('Could not load settings:', error));

  onSettingsChanged(applySettings);

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
