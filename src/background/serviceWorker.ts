/**
 * Background service worker.
 *
 * Holds the imported shipment for the browsing session so the popup can be
 * closed and reopened without re-importing. Storage is chrome.storage.session
 * (memory-backed, cleared when the browser closes) - see src/core/store.ts.
 *
 * The worker makes no network requests of any kind.
 */

import type { BackgroundRequest, BackgroundResponse } from '../core/messages.js';
import { clearImport, getImport, selectLine, setImport } from '../core/store.js';
import { clearLog, logEvent, readLog } from '../core/sessionLog.js';


async function handle(message: BackgroundRequest): Promise<BackgroundResponse> {
  switch (message.type) {
    case 'store/get':
      return { ok: true, type: 'store/data', payload: await getImport() };

    case 'store/set':
      await setImport(message.payload);
      return { ok: true, type: 'store/data', payload: await getImport() };

    case 'store/selectLine':
      return { ok: true, type: 'store/data', payload: await selectLine(message.line) };

    // Clearing the import clears the log with it. The log holds invoice
    // numbers, weights and values derived from the shipment, so leaving it
    // behind would make "Clear Imported Data" a promise the extension does not
    // keep. Export diagnostics first if the trail is wanted.
    case 'store/clear':
      await clearImport();
      await clearLog();
      return { ok: true, type: 'store/cleared' };

    // The log is owned here so the panel, the popup and the content script all
    // append to one ordered list instead of three private ones.
    case 'log/append':
      await logEvent(message.kind, message.message, message.detail);
      return { ok: true, type: 'log/ok' };

    case 'log/get':
      return { ok: true, type: 'log/data', payload: await readLog() };

    case 'log/clear':
      await clearLog();
      return { ok: true, type: 'log/ok' };

    default:
      return { ok: false, error: 'Unsupported request.' };
  }
}

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: (error as Error).message } satisfies BackgroundResponse));
  // Keep the message channel open for the async handler.
  return true;
});

// Session storage is memory-backed, but be explicit: a fresh browser start
// must never find shipment data lying around.
chrome.runtime.onStartup.addListener(() => {
  void clearImport();
  void clearLog();
});

/**
 * The toolbar icon opens the side panel.
 *
 * There is no `default_popup` in the manifest any more. Chrome destroys an
 * action popup the moment it loses focus, so the helper closed on the first
 * click into the ACE form and the operator had to go back to the toolbar for
 * every field. A side panel is docked beside the page, survives that click,
 * survives a tab switch, and closes when the operator closes it.
 *
 * Chrome persists the behaviour, so one call would do; it is made on every
 * worker start because a service worker is not persistent and this costs
 * nothing. A build running on a Chrome without the API is left as it is rather
 * than being broken by the attempt.
 */
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Nothing to recover: the icon simply does not open the panel on this Chrome.
  });
}
