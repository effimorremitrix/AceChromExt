/**
 * The parsed paste and the portal toggle, for the browsing session only.
 *
 * chrome.storage.session is memory-backed: never written to disk, not readable
 * by a web page, cleared when the browser closes. Same posture as the other two
 * extensions; a shipment does not outlive the window it was pasted into.
 *
 * The toggle is kept under its own key, so Clear empties the box without
 * un-pinning the portal: an operator who has pinned INTTRA is on the INTTRA
 * portal, and the next paste is for the same screen.
 */

import { isFillMode, type FillMode, type StoredPaste } from './messages.js';

const KEY = 'quickfill.paste';
const MODE_KEY = 'quickfill.mode';

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

/** 'auto' unless the operator pinned a portal in this browsing session. */
export async function getMode(): Promise<FillMode> {
  const area = sessionArea();
  if (!area) return 'auto';
  const bag = await area.get(MODE_KEY);
  const value = bag[MODE_KEY];
  return isFillMode(value) ? value : 'auto';
}

export async function setMode(mode: FillMode): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.set({ [MODE_KEY]: mode });
}
