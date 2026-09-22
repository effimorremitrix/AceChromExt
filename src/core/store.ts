/**
 * Imported-shipment storage.
 *
 * chrome.storage.session is memory-backed: it is not written to disk, it is not
 * readable by web pages, and it is cleared when the browser closes. Shipment
 * and customer data therefore never persists past the browsing session, and
 * "Clear Imported Data" removes it immediately.
 */

import type { StoredImport } from './messages.js';

const KEY = 'aceHelper.import';

function sessionArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.session ?? null;
}

export async function getImport(): Promise<StoredImport | null> {
  const area = sessionArea();
  if (!area) return null;
  const bag = await area.get(KEY);
  const value = bag[KEY];
  return value ? (value as StoredImport) : null;
}

export async function setImport(payload: StoredImport): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.set({ [KEY]: payload });
}

export async function selectLine(line: number): Promise<StoredImport | null> {
  const current = await getImport();
  if (!current) return null;
  const exists = current.shipment.commodities.some((commodity) => commodity.line === line);
  const next: StoredImport = { ...current, selectedLine: exists ? line : current.selectedLine };
  await setImport(next);
  return next;
}

export async function clearImport(): Promise<void> {
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
export const ACTIVE_TAB_KEY = 'aceHelper.activeTab';

export async function clearActiveTab(): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  await area.remove(ACTIVE_TAB_KEY);
}
