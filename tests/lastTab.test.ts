/**
 * The screen the operator was last on.
 *
 * Before the side panel this was invisible: a popup opened for one action and
 * died, so landing on Overview cost nothing. A side panel is opened
 * deliberately and kept open, and opening it to the wrong screen is a click
 * the operator pays for every time.
 *
 * Two claims worth pinning, both of which only bite on a real install:
 *
 *   - the two extensions do not share a key. One helper's Containers screen is
 *     not the other's;
 *   - it is chrome.storage.session, the memory-backed area, never local. A
 *     screen remembered from last week opens onto a shipment this session no
 *     longer has, and it is not a setting the operator chose, so it does not
 *     belong beside the settings.
 *
 * It used to be keyed per surface as well. That went with the wide panel on
 * 2026-09-22: one surface, one remembered screen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tabMemory } from '../src/ui/lastTab.js';

let session: Record<string, unknown>;
let local: Record<string, unknown>;

/** Let a fire-and-forget write land. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

beforeEach(() => {
  session = {};
  local = {};
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => (key in session ? { [key]: session[key] } : {})),
        set: vi.fn(async (bag: Record<string, unknown>) => {
          Object.assign(session, bag);
        }),
      },
      local: {
        get: vi.fn(async (key: string) => (key in local ? { [key]: local[key] } : {})),
        set: vi.fn(async (bag: Record<string, unknown>) => {
          Object.assign(local, bag);
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tabMemory', () => {
  it('has nothing to say before the operator has chosen a screen', async () => {
    expect(await tabMemory('aceHelper.activeTab').read()).toBeNull();
  });

  it('gives back the screen the operator chose', async () => {
    const memory = tabMemory('aceHelper.activeTab');
    memory.write('fill');
    await settle();

    expect(await memory.read()).toBe('fill');
  });

  it('holds one screen, and the last one wins', async () => {
    const memory = tabMemory('aceHelper.activeTab');
    memory.write('fill');
    await settle();
    memory.write('mapping');
    await settle();

    expect(await memory.read()).toBe('mapping');
  });

  it('keeps the two extensions apart', async () => {
    tabMemory('aceHelper.activeTab').write('fill');
    await settle();
    tabMemory('inttraHelper.activeTab').write('containers');
    await settle();

    expect(await tabMemory('aceHelper.activeTab').read()).toBe('fill');
    expect(await tabMemory('inttraHelper.activeTab').read()).toBe('containers');
  });

  it('writes to the session area only, never to the settings area', async () => {
    tabMemory('aceHelper.activeTab').write('fill');
    await settle();

    expect(Object.keys(session)).toEqual(['aceHelper.activeTab']);
    expect(local).toEqual({});
  });

  it('is a no-op rather than a throw where there is no storage at all', async () => {
    vi.stubGlobal('chrome', {});
    const memory = tabMemory('aceHelper.activeTab');
    expect(() => memory.write('fill')).not.toThrow();
    expect(await memory.read()).toBeNull();
  });
});
