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

async function handle(message: BackgroundRequest): Promise<BackgroundResponse> {
  switch (message.type) {
    case 'store/get':
      return { ok: true, type: 'store/data', payload: await getImport() };

    case 'store/set':
      await setImport(message.payload);
      return { ok: true, type: 'store/data', payload: await getImport() };

    case 'store/selectLine':
      return { ok: true, type: 'store/data', payload: await selectLine(message.line) };

    case 'store/clear':
      await clearImport();
      return { ok: true, type: 'store/cleared' };

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
});
