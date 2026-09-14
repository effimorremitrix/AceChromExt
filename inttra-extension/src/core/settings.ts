/**
 * INTTRA Helper settings. Preferences only, in chrome.storage.local. No
 * shipment data and no credential is ever written here.
 */

export interface InttraHelperSettings {
  debugMode: boolean;
  highlightDurationMs: number;
  dispatchBlur: boolean;
}

export const DEFAULT_INTTRA_SETTINGS: InttraHelperSettings = {
  debugMode: false,
  highlightDurationMs: 6000,
  dispatchBlur: true,
};

const STORAGE_KEY = 'inttraHelper.settings';

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
}

export function mergeInttraSettings(stored: unknown): InttraHelperSettings {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_INTTRA_SETTINGS };
  const input = stored as Partial<InttraHelperSettings>;
  return {
    debugMode: typeof input.debugMode === 'boolean' ? input.debugMode : DEFAULT_INTTRA_SETTINGS.debugMode,
    highlightDurationMs:
      typeof input.highlightDurationMs === 'number' && input.highlightDurationMs >= 0 ? Math.min(input.highlightDurationMs, 60000) : DEFAULT_INTTRA_SETTINGS.highlightDurationMs,
    dispatchBlur: typeof input.dispatchBlur === 'boolean' ? input.dispatchBlur : DEFAULT_INTTRA_SETTINGS.dispatchBlur,
  };
}

export async function loadInttraSettings(): Promise<InttraHelperSettings> {
  if (!hasChromeStorage()) return { ...DEFAULT_INTTRA_SETTINGS };
  const bag = await chrome.storage.local.get(STORAGE_KEY);
  return mergeInttraSettings(bag[STORAGE_KEY]);
}

export async function saveInttraSettings(partial: Partial<InttraHelperSettings>): Promise<InttraHelperSettings> {
  const next = mergeInttraSettings({ ...(await loadInttraSettings()), ...partial });
  if (hasChromeStorage()) await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function onInttraSettingsChanged(handler: (settings: InttraHelperSettings) => void): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes[STORAGE_KEY];
    if (change) handler(mergeInttraSettings(change.newValue));
  });
}
