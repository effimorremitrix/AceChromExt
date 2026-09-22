/**
 * Background service worker: holds the loaded package and the session log in
 * chrome.storage.session so the popup can be closed and reopened. It makes no
 * network requests of any kind.
 */

import { clearLog, logEvent, readLog } from '../../../src/core/sessionLog.js';
import type { InttraBackgroundRequest, InttraBackgroundResponse } from '../core/messages.js';
import { clearStoredPackage, getStoredPackage, setStoredPackage } from '../core/store.js';

async function handle(message: InttraBackgroundRequest): Promise<InttraBackgroundResponse> {
  switch (message.type) {
    case 'store/get':
      return { ok: true, type: 'store/data', payload: await getStoredPackage() };
    case 'store/set':
      await setStoredPackage(message.payload);
      return { ok: true, type: 'store/data', payload: await getStoredPackage() };
    case 'store/clear':
      await clearStoredPackage();
      await clearLog();
      return { ok: true, type: 'store/cleared' };
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

chrome.runtime.onMessage.addListener((message: InttraBackgroundRequest, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: (error as Error).message } satisfies InttraBackgroundResponse));
  return true;
});

chrome.runtime.onStartup.addListener(() => {
  void clearStoredPackage();
  void clearLog();
});

/**
 * The toolbar icon opens the side panel. See src/background/serviceWorker.ts
 * for why there is no `default_popup`: an action popup is destroyed on its
 * first loss of focus, which on Create Shipping Instruction is the first click
 * into the form.
 */
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Nothing to recover: the icon simply does not open the panel on this Chrome.
  });
}
