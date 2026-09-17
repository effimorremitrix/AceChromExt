/**
 * Talking to the INTTRA tab. Only tabs on the hosts in the manifest are ever
 * addressed; the host is re-checked here rather than trusted.
 */

import { INTTRA_CONTENT_NOT_READY, type InttraBackgroundRequest, type InttraBackgroundResponse, type InttraContentRequest, type InttraContentResponse } from '../core/messages.js';

/** Keep in step with host_permissions in inttra-extension/manifest.json. */
export const INTTRA_URL_PATTERNS = ['https://*.inttra.com/*', 'https://*.e2open.com/*'];

export interface InttraTab {
  id: number;
  url: string;
  title: string;
}

export function isInttraUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    return host === 'inttra.com' || host.endsWith('.inttra.com') || host === 'e2open.com' || host.endsWith('.e2open.com');
  } catch {
    return false;
  }
}

function asInttraTab(tab: chrome.tabs.Tab): InttraTab | null {
  if (tab.id === undefined || !isInttraUrl(tab.url)) return null;
  return { id: tab.id, url: tab.url ?? '', title: tab.title ?? '' };
}

/**
 * The INTTRA tab to address.
 *
 * From the popup it is the active tab. The panel is a tab of its own, so from
 * there it is a choice: the INTTRA tab in the panel's own window first, then
 * any window, most recently used first. The header shows which one was
 * chosen, because a Shipping Instruction open in a second tab would otherwise
 * be described as if it were the one the operator is looking at.
 */
export async function resolveInttraTab(): Promise<InttraTab | null> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeInttra = active ? asInttraTab(active) : null;
  if (activeInttra) return activeInttra;
  for (const query of [{ url: INTTRA_URL_PATTERNS, currentWindow: true }, { url: INTTRA_URL_PATTERNS }]) {
    const candidates = await chrome.tabs.query(query);
    const usable = candidates
      .map((tab) => ({ tab, lastAccessed: tab.lastAccessed ?? 0 }))
      .sort((a, b) => b.lastAccessed - a.lastAccessed)
      .map(({ tab }) => asInttraTab(tab))
      .filter((tab): tab is InttraTab => tab !== null);
    if (usable[0]) return usable[0];
  }
  return null;
}

export async function sendToTab(tabId: number, request: InttraContentRequest): Promise<InttraContentResponse> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, request)) as InttraContentResponse | undefined;
    return response ?? { ok: false, error: INTTRA_CONTENT_NOT_READY };
  } catch {
    return { ok: false, error: INTTRA_CONTENT_NOT_READY };
  }
}

export async function sendToBackground(request: InttraBackgroundRequest): Promise<InttraBackgroundResponse> {
  try {
    const response = (await chrome.runtime.sendMessage(request)) as InttraBackgroundResponse | undefined;
    return response ?? { ok: false, error: 'The extension background worker did not respond.' };
  } catch (error) {
    return { ok: false, error: `Background worker error: ${(error as Error).message}` };
  }
}
