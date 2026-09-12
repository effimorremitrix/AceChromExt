/**
 * Talking to the ACE tab.
 *
 * The extension only ever addresses tabs whose URL matches the ACE/CBP host
 * patterns in the manifest; it has no permission to touch anything else.
 */

import { CONTENT_NOT_READY, type BackgroundRequest, type BackgroundResponse, type ContentRequest, type ContentResponse } from '../core/messages.js';

/** Keep in step with host_permissions in extension/manifest.json. */
export const ACE_URL_PATTERNS = [
  'https://ace.cbp.dhs.gov/*',
  'https://aesdirect.cbp.dhs.gov/*',
  'https://*.cbp.dhs.gov/*',
];

export interface AceTab {
  id: number;
  url: string;
  title: string;
}

function isAceUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'cbp.dhs.gov' || parsed.hostname.endsWith('.cbp.dhs.gov'));
  } catch {
    return false;
  }
}

/** The ACE tab to act on: the active tab when it is ACE, otherwise the most recently used ACE tab. */
export async function resolveAceTab(): Promise<AceTab | null> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id !== undefined && isAceUrl(active.url)) {
    return { id: active.id, url: active.url ?? '', title: active.title ?? '' };
  }

  const candidates = await chrome.tabs.query({ url: ACE_URL_PATTERNS });
  const usable = candidates
    .filter((tab) => tab.id !== undefined && isAceUrl(tab.url))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));

  const best = usable[0];
  if (!best || best.id === undefined) return null;
  return { id: best.id, url: best.url ?? '', title: best.title ?? '' };
}

export async function sendToTab(tabId: number, request: ContentRequest): Promise<ContentResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, request)) as ContentResponse | undefined;
    if (!response) return { ok: false, error: CONTENT_NOT_READY };
    return response;
  } catch {
    return { ok: false, error: CONTENT_NOT_READY };
  }
}

export async function sendToBackground(request: BackgroundRequest): Promise<BackgroundResponse> {
  try {
    const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse | undefined;
    if (!response) return { ok: false, error: 'The extension background worker did not respond.' };
    return response;
  } catch (error) {
    return { ok: false, error: `Background worker error: ${(error as Error).message}` };
  }
}
