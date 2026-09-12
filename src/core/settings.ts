/**
 * User settings.
 *
 * Stored in chrome.storage.local: these are preferences only. No shipment
 * data, no credentials, nothing derived from a filing is ever written here.
 */

import type { RoundingOptions } from '../calculator/calculator.js';

export interface AceHelperSettings {
  /** Rounding applied to calculator results before insertion. */
  rounding: RoundingOptions;
  /** Decimal places for shipping weight (ACE files whole kilograms). */
  weightDecimals: number;
  /** Decimal places for monetary values. */
  valueDecimals: number;
  /** Decimal places for quantities; null keeps the value as imported. */
  quantityDecimals: number | null;
  /** Show the diagnostics panel and per-field detection details. Off by default. */
  debugMode: boolean;
  /** How long the post-fill field highlighting stays on screen. */
  highlightDurationMs: number;
  /** Dispatch a blur/focusout event after writing, for ACE fields that validate on blur. */
  dispatchBlur: boolean;
  /** Assume unit-less weights are already kilograms (true) or pounds (false). */
  assumeWeightIsKg: boolean;
}

export const DEFAULT_SETTINGS: AceHelperSettings = {
  rounding: { mode: 'decimals', decimals: 2 },
  weightDecimals: 0,
  valueDecimals: 2,
  quantityDecimals: null,
  debugMode: false,
  highlightDurationMs: 6000,
  dispatchBlur: true,
  assumeWeightIsKg: true,
};

const STORAGE_KEY = 'aceHelper.settings';

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
}

/** Merge stored settings over the defaults; unknown keys are dropped. */
export function mergeSettings(stored: unknown): AceHelperSettings {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_SETTINGS };
  const input = stored as Partial<AceHelperSettings>;
  return {
    rounding: {
      mode: input.rounding?.mode ?? DEFAULT_SETTINGS.rounding.mode,
      decimals: clampDecimals(input.rounding?.decimals, DEFAULT_SETTINGS.rounding.decimals),
    },
    weightDecimals: clampDecimals(input.weightDecimals, DEFAULT_SETTINGS.weightDecimals),
    valueDecimals: clampDecimals(input.valueDecimals, DEFAULT_SETTINGS.valueDecimals),
    quantityDecimals:
      input.quantityDecimals === null || input.quantityDecimals === undefined
        ? DEFAULT_SETTINGS.quantityDecimals
        : clampDecimals(input.quantityDecimals, 0),
    debugMode: typeof input.debugMode === 'boolean' ? input.debugMode : DEFAULT_SETTINGS.debugMode,
    highlightDurationMs:
      typeof input.highlightDurationMs === 'number' && input.highlightDurationMs >= 0
        ? Math.min(input.highlightDurationMs, 60000)
        : DEFAULT_SETTINGS.highlightDurationMs,
    dispatchBlur: typeof input.dispatchBlur === 'boolean' ? input.dispatchBlur : DEFAULT_SETTINGS.dispatchBlur,
    assumeWeightIsKg:
      typeof input.assumeWeightIsKg === 'boolean' ? input.assumeWeightIsKg : DEFAULT_SETTINGS.assumeWeightIsKg,
  };
}

function clampDecimals(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 0), 6);
}

export async function loadSettings(): Promise<AceHelperSettings> {
  if (!hasChromeStorage()) return { ...DEFAULT_SETTINGS };
  const bag = await chrome.storage.local.get(STORAGE_KEY);
  return mergeSettings(bag[STORAGE_KEY]);
}

export async function saveSettings(partial: Partial<AceHelperSettings>): Promise<AceHelperSettings> {
  const current = await loadSettings();
  const next = mergeSettings({ ...current, ...partial });
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  }
  return next;
}

export function onSettingsChanged(handler: (settings: AceHelperSettings) => void): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes[STORAGE_KEY];
    if (!change) return;
    handler(mergeSettings(change.newValue));
  });
}
