/**
 * The screen the operator was last on.
 *
 * Without this, every reopen lands on Overview. That was tolerable while the
 * helper was a popup that died on its own after one action; a side panel is
 * opened deliberately, and opening it to the wrong screen is a click the
 * operator pays for each time.
 *
 * `chrome.storage.session` on purpose, the same area the imported shipment
 * uses: it is memory-backed, never written to disk, and cleared when the
 * browser closes. A screen remembered from last week would open onto a
 * shipment this session no longer has, and it is not a setting the operator
 * chose, so it does not belong beside the settings in `storage.local`.
 *
 * Kept per surface. The wide panel has tabs the side panel does not (Import,
 * Mapping status, Calculator, Settings), so one shared memory would keep
 * sending the side panel to a screen it cannot show. A remembered screen that
 * no longer exists costs nothing either way: `renderTabs` drops any active tab
 * that is not in the list it just built.
 */

export interface TabMemory {
  /** The remembered screen for this surface, or null when there is none. */
  read(surface: string): Promise<string | null>;
  /** Remember it. Fire and forget: a render must never wait on storage. */
  write(surface: string, tab: string): void;
}

function sessionArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.session ?? null;
}

export function tabMemory(key: string): TabMemory {
  return {
    async read(surface: string): Promise<string | null> {
      const area = sessionArea();
      if (!area) return null;
      const bag = await area.get(key);
      const value = (bag[key] ?? {}) as Record<string, unknown>;
      const remembered = value[surface];
      return typeof remembered === 'string' && remembered ? remembered : null;
    },
    write(surface: string, tab: string): void {
      const area = sessionArea();
      if (!area) return;
      void area
        .get(key)
        .then((bag) => area.set({ [key]: { ...((bag[key] ?? {}) as Record<string, string>), [surface]: tab } }))
        .catch(() => {
          // A screen not remembered is the old behaviour, not a failure to report.
        });
    },
  };
}
