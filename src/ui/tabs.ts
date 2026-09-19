/**
 * Talking to the ACE tab.
 *
 * The extension only ever addresses tabs whose URL matches the host patterns
 * in its own manifest; it has no permission to touch anything else. That is
 * enforced by asking Chrome to do the matching (`tabPatterns` below) rather
 * than by a second URL test here, so the panel and the page can never disagree
 * about which tabs count: the patterns that decide whether the content script
 * was injected are the patterns the panel searches.
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

/**
 * The pages THIS build may address: whatever its own manifest injects the
 * content script into.
 *
 * The shipping manifest declares the three CBP hosts above and nothing else,
 * so nothing changes for it. The playground build (`npm run build:playground`)
 * declares pages opened from disk and from localhost instead, which is what
 * lets the panel find a mock step without the manifest ever naming a portal.
 * `ACE_URL_PATTERNS` remains the answer where there is no manifest to read.
 */
export function tabPatterns(): string[] {
  try {
    const manifest = chrome.runtime.getManifest() as { content_scripts?: Array<{ matches?: string[] }> };
    const declared = (manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []);
    if (declared.length) return declared;
  } catch {
    // No manifest to read here. Fall through to the shipping patterns.
  }
  return [...ACE_URL_PATTERNS];
}

/** The ACE tab to act on: the active tab when it is one, otherwise the most recently used one. */
export async function resolveAceTab(): Promise<AceTab | null> {
  // Chrome matches the patterns, and hands back a url only for a tab this
  // build has host permission for - which is why the playground manifest keeps
  // host permissions for its local pages while Quickfill's needs none.
  const matching = (await chrome.tabs.query({ url: tabPatterns() })).filter((tab) => tab.id !== undefined);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });

  const here = active?.id === undefined ? undefined : matching.find((tab) => tab.id === active.id);
  const best = here ?? [...matching].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
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
