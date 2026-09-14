/**
 * Operator-captured INTTRA selectors, in chrome.storage.local under the
 * helper's own key. The parser is the shared one: same JSON shape, same
 * guard rails, same "overrides go first, placeholders stay behind".
 */

import { emptyOverrides, OverrideError, parseOverrides, type SelectorOverrides } from '../../../src/ace/selectors/overrides.js';

export const INTTRA_OVERRIDES_KEY = 'inttraHelper.selectorOverrides';

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
}

export async function loadInttraOverrides(): Promise<SelectorOverrides> {
  if (!hasStorage()) return emptyOverrides();
  const bag = await chrome.storage.local.get(INTTRA_OVERRIDES_KEY);
  try {
    return parseOverrides(bag[INTTRA_OVERRIDES_KEY]);
  } catch {
    return emptyOverrides();
  }
}

export async function saveInttraOverrides(input: unknown, doc?: Document): Promise<SelectorOverrides> {
  const parsed = parseOverrides(input, doc);
  if (!hasStorage()) throw new OverrideError('This browser profile has no extension storage available.');
  await chrome.storage.local.set({ [INTTRA_OVERRIDES_KEY]: parsed });
  return parsed;
}

export async function clearInttraOverrides(): Promise<void> {
  if (!hasStorage()) return;
  await chrome.storage.local.remove(INTTRA_OVERRIDES_KEY);
}

export function onInttraOverridesChanged(handler: (overrides: SelectorOverrides) => void): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes[INTTRA_OVERRIDES_KEY];
    if (!change) return;
    try {
      handler(parseOverrides(change.newValue));
    } catch {
      handler(emptyOverrides());
    }
  });
}
