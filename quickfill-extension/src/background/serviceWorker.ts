/**
 * Background service worker.
 *
 * Holds the parsed paste for the browsing session so closing the popup does not
 * lose it. That is all it does: no session log, no diagnostics, no network
 * request of any kind. The ACE Helper's session log is an audit feature, and
 * Quickfill has no audit story to tell - the filing package the operator keeps
 * is the ACE Helper's job.
 */

import type { QuickfillBackgroundRequest, QuickfillBackgroundResponse } from '../core/messages.js';
import { clearPaste, getPaste, setPaste } from '../core/store.js';

async function handle(message: QuickfillBackgroundRequest): Promise<QuickfillBackgroundResponse> {
  switch (message.type) {
    case 'store/get':
      return { ok: true, type: 'store/data', payload: await getPaste() };
    case 'store/set':
      await setPaste(message.payload);
      return { ok: true, type: 'store/data', payload: await getPaste() };
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
