/**
 * Background service worker.
 *
 * Holds the parsed paste and the portal toggle for the browsing session, so
 * closing the popup does not lose either. That is all it does: no session log,
 * no diagnostics, no network request of any kind. The ACE Helper's session log
 * is an audit feature, and Quickfill has no audit story to tell - the filing
 * package the operator keeps is the ACE Helper's job.
 */

import type { QuickfillBackgroundRequest, QuickfillBackgroundResponse, StoredState } from '../core/messages.js';
import { clearPaste, getMode, getPaste, setMode, setPaste } from '../core/store.js';

async function state(): Promise<StoredState> {
  return { paste: await getPaste(), mode: await getMode() };
}

async function handle(message: QuickfillBackgroundRequest): Promise<QuickfillBackgroundResponse> {
  switch (message.type) {
    case 'store/get':
      return { ok: true, type: 'store/data', payload: await state() };
    case 'store/set':
      await setPaste(message.payload);
      return { ok: true, type: 'store/data', payload: await state() };
    case 'store/mode':
      await setMode(message.mode);
      return { ok: true, type: 'store/data', payload: await state() };
    case 'store/clear':
      await clearPaste();
      return { ok: true, type: 'store/cleared' };
    default:
      return { ok: false, error: 'Unsupported request.' };
  }
}

chrome.runtime.onMessage.addListener((message: QuickfillBackgroundRequest, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: (error as Error).message } satisfies QuickfillBackgroundResponse));
  // Keep the message channel open for the async handler.
  return true;
});

/**
 * The toolbar icon opens the side panel, as it does for the other two helpers.
 *
 * Quickfill held out on an action popup longer than they did, and answered the
 * popup's one fatal property - Chrome destroys it on its first loss of focus -
 * with a "Pop out" window instead. Both are gone: three helpers behaving three
 * ways is one thing more to remember than a forwarder in a hurry has room for.
 * See src/background/serviceWorker.ts.
 */
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Nothing to recover: the icon simply does not open the panel on this Chrome.
  });
}
