/**
 * The parsed paste, for the browsing session only.
 *
 * chrome.storage.session is memory-backed: never written to disk, not readable
 * by a web page, cleared when the browser closes. Same posture as the other two
 * extensions; a shipment does not outlive the window it was pasted into.
 */

import type { StoredPaste } from './messages.js';

const KEY = 'quickfill.paste';

function sessionArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.session ?? null;
}

export async function getPaste(): Promise<StoredPaste | null> {
  const area = sessionArea();
  if (!area) return null;
  const bag = await area.get(KEY);
  const value = bag[KEY];
  return value ? (value as StoredPaste) : null;
}

export async function setPaste(payload: StoredPaste): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.set({ [KEY]: payload });
}

export async function clearPaste(): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.remove(KEY);
}
