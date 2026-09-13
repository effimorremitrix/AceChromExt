/**
 * Where selector overrides are kept.
 *
 * chrome.storage.local, not session: a captured selector is a configuration
 * fact about the ACE portal, not shipment data, so it should survive a browser
 * restart. It contains no shipment, customer or credential data - only CSS
 * selectors and label text read off a public form.
 *
 * Split from `overrides.ts` so the parser stays a pure function with no
 * chrome dependency and can be unit-tested in Node.
 */

import { emptyOverrides, OverrideError, OVERRIDES_STORAGE_KEY, parseOverrides, type SelectorOverrides } from './overrides.js';

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
}

export async function loadOverrides(): Promise<SelectorOverrides> {
  if (!hasStorage()) return emptyOverrides();
  const bag = await chrome.storage.local.get(OVERRIDES_STORAGE_KEY);
  try {
    return parseOverrides(bag[OVERRIDES_STORAGE_KEY]);
  } catch {
    // Stored overrides that no longer parse (a downgrade, a manual edit of the
    // profile) must not stop the extension working: fall back to the built-in
    // candidates, which is exactly Phase 1 behaviour.
    return emptyOverrides();
  }
}

/** Validate and store. Throws OverrideError on anything unusable. */
export async function saveOverrides(input: unknown, doc?: Document): Promise<SelectorOverrides> {
  const parsed = parseOverrides(input, doc);
  if (!hasStorage()) throw new OverrideError('This browser profile has no extension storage available.');
  await chrome.storage.local.set({ [OVERRIDES_STORAGE_KEY]: parsed });
  return parsed;
}

export async function clearOverrides(): Promise<void> {
  if (!hasStorage()) return;
  await chrome.storage.local.remove(OVERRIDES_STORAGE_KEY);
}

export function onOverridesChanged(handler: (overrides: SelectorOverrides) => void): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes[OVERRIDES_STORAGE_KEY];
    if (!change) return;
    try {
      handler(parseOverrides(change.newValue));
    } catch {
      handler(emptyOverrides());
    }
  });
}
