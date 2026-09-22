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

/**
 * The screen the operator was last on (see src/ui/lastTab.ts), owned here
 * because Clear has to be able to drop it.
 *
 * Same reasoning as the session log next door: "Clear Imported Data" promises
 * that nothing of this shipment is left in the session, and the promise is
 * only auditable while it means the area is EMPTY, not "empty except for the
 * things we decided were harmless". A remembered screen also points at a
 * shipment that no longer exists once Clear has run, so Overview is where the
 * operator should land anyway.
 */
export const ACTIVE_TAB_KEY = 'inttraHelper.activeTab';

export async function clearActiveTab(): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.remove(ACTIVE_TAB_KEY);
}
