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
 * One screen, not one per surface: there is one surface now. This was keyed by
 * surface while a wide `panel.html` existed beside the side panel and carried
 * tabs the side panel did not, so a shared memory would have sent the side
 * panel to a screen it could not show. Both surfaces are one, so the key is
 * one. A remembered screen that no longer exists still costs nothing:
 * `renderTabs` drops any active tab that is not in the list it just built.
 */

export interface TabMemory {
  /** The remembered screen, or null when there is none. */
  read(): Promise<string | null>;
  /** Remember it. Fire and forget: a render must never wait on storage. */
  write(tab: string): void;
}

function sessionArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.session ?? null;
}

export function tabMemory(key: string): TabMemory {
  return {
    async read(): Promise<string | null> {
      const area = sessionArea();
      if (!area) return null;
      const bag = await area.get(key);
      const remembered = bag[key];
      return typeof remembered === 'string' && remembered ? remembered : null;
    },
    write(tab: string): void {
      const area = sessionArea();
      if (!area) return;
      void area.set({ [key]: tab }).catch(() => {
        // A screen not remembered is the old behaviour, not a failure to report.
      });
    },
  };
}
