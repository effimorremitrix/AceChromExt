/**
 * "Clear Imported Data" empties `chrome.storage.session`. All of it.
 *
 * The promise in `docs/SECURITY.md` and above `store/clear` is only auditable
 * while it means the area is EMPTY. The moment it means "empty except for the
 * things we judged harmless", nobody can check it by looking, and the next key
 * somebody adds gets the same pass.
 *
 * This is pinned because it has already been broken once, on 2026-09-22, by
 * this very rule's most innocent-looking violation: the screen the operator
 * was last on (`src/ui/lastTab.ts`), which holds no shipment data at all. The
 * unit suite passed; `npm run smoke` caught it against real Chrome. A test
 * that costs a browser is a test that gets skipped, so here it is in jsdom.
 *
 * The remembered screen earns its place in the clear on its own merits too: it
 * points at a shipment the session no longer has.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let session: Record<string, unknown>;

function stub(): void {
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => (key in session ? { [key]: session[key] } : {})),
        set: vi.fn(async (bag: Record<string, unknown>) => {
          Object.assign(session, bag);
        }),
        remove: vi.fn(async (key: string) => {
          delete session[key];
        }),
      },
    },
  });
}

beforeEach(() => {
  vi.resetModules();
  session = {};
  stub();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the ACE Helper session area', () => {
  it('is emptied by the three clears the worker runs together', async () => {
    const { setImport, clearImport, clearActiveTab, ACTIVE_TAB_KEY } = await import('../src/core/store.js');
    const { logEvent, clearLog } = await import('../src/core/sessionLog.js');
    const { tabMemory } = await import('../src/ui/lastTab.js');

    await setImport({ shipment: { commodities: [] }, validation: [], notes: [], selectedLine: 1 } as never);
    await logEvent('import', 'read a workbook');
    tabMemory(ACTIVE_TAB_KEY).write('side', 'fill');
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();

    // Three keys, so the test would notice a clear that silently stopped
    // covering one of them.
    expect(Object.keys(session).sort()).toHaveLength(3);

    await clearImport();
    await clearLog();
    await clearActiveTab();

    expect(session).toEqual({});
  });

  it('keeps the remembered screen under the key the worker clears', async () => {
    const { ACTIVE_TAB_KEY } = await import('../src/core/store.js');
    const { tabMemory } = await import('../src/ui/lastTab.js');

    tabMemory(ACTIVE_TAB_KEY).write('side', 'fill');
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();

    // A memory written under one key and cleared under another is exactly the
    // hole this file exists to close.
    expect(Object.keys(session)).toEqual([ACTIVE_TAB_KEY]);
  });
});

describe('the INTTRA Helper session area', () => {
  it('is emptied by the three clears the worker runs together', async () => {
    const { setStoredPackage, clearStoredPackage, clearActiveTab, ACTIVE_TAB_KEY, emptyStoredPackage } = await import(
      '../inttra-extension/src/core/store.js'
    );
    // The INTTRA Helper reuses the ACE Helper's session log rather than
    // keeping a second one; its worker imports exactly this module.
    const { logEvent, clearLog } = await import('../src/core/sessionLog.js');
    const { tabMemory } = await import('../src/ui/lastTab.js');

    await setStoredPackage({ ...emptyStoredPackage(), sourceName: 'filing-package.json' });
    await logEvent('import', 'read a package');
    tabMemory(ACTIVE_TAB_KEY).write('side', 'containers');
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();

    expect(Object.keys(session).sort()).toHaveLength(3);

    await clearStoredPackage();
    await clearLog();
    await clearActiveTab();

    expect(session).toEqual({});
  });

  it('does not share a key with the ACE Helper', async () => {
    const ace = await import('../src/core/store.js');
    const inttra = await import('../inttra-extension/src/core/store.js');
    expect(inttra.ACTIVE_TAB_KEY).not.toBe(ace.ACTIVE_TAB_KEY);
  });
});
