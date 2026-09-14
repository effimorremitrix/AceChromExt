/**
 * The loaded package, in chrome.storage.session: memory-backed, not written
 * to disk, not readable by web pages, gone when the browser closes.
 */

import type { DeckhandShipment } from '../../../deckhand/src/model.js';
import type { FilingPackage } from '../../../shared/src/filingPackage.js';

export interface StoredPackage {
  package: FilingPackage | null;
  deckhand: { shipment: DeckhandShipment; approvedAt: string | null } | null;
  /** 0-based index of the container the Container & Cargo form is filled from. */
  selectedContainer: number;
  /** Where the package came from, for the screen. */
  sourceName: string;
}

const KEY = 'inttraHelper.package';

function sessionArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.session ?? null;
}

export function emptyStoredPackage(): StoredPackage {
  return { package: null, deckhand: null, selectedContainer: 0, sourceName: '' };
}

export async function getStoredPackage(): Promise<StoredPackage> {
  const area = sessionArea();
  if (!area) return emptyStoredPackage();
  const bag = await area.get(KEY);
  const value = bag[KEY];
  return value ? (value as StoredPackage) : emptyStoredPackage();
}

export async function setStoredPackage(payload: StoredPackage): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.set({ [KEY]: payload });
}

export async function clearStoredPackage(): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.remove(KEY);
}
