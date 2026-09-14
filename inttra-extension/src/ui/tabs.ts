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

export async function resolveInttraTab(): Promise<InttraTab | null> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id !== undefined && isInttraUrl(active.url)) return { id: active.id, url: active.url ?? '', title: active.title ?? '' };
  const candidates = await chrome.tabs.query({ url: INTTRA_URL_PATTERNS });
  const usable = candidates.filter((tab) => tab.id !== undefined && isInttraUrl(tab.url)).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const best = usable[0];
  if (!best || best.id === undefined) return null;
  return { id: best.id, url: best.url ?? '', title: best.title ?? '' };
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
