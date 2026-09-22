/**
 * The watcher that keeps a surface that STAYS OPEN honest.
 *
 * A popup never needed this: Chrome destroyed it on its first loss of focus,
 * so it could not be wrong about the page. The side panel and the pop-out
 * window are still on the screen when the operator switches tab, and a stale
 * "Create Shipping Instruction, 7 containers" reads as current.
 *
 * Two promises are pinned here, because both are the kind that only break on
 * the live portal where nobody is looking:
 *
 *   - a burst of events is ONE probe, and two probes never overlap. Loading a
 *     portal page fires onUpdated several times with onActivated alongside it;
 *     one probe per event is four round trips to a content script that is
 *     still parsing;
 *   - a repaint driven by the BROWSER never takes the caret out of a box the
 *     operator is typing in.
 *
 * It used to pin a third: that a DETACHED surface resolved the portal tab from
 * a normal browser window rather than its own. That went with the Quickfill
 * pop-out window on 2026-09-22; all three helpers are side panels now, docked
 * inside the window whose page they fill, so the ordinary active-tab query is
 * right for every one of them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isEditing, watchBrowser } from '../src/ui/liveTab.js';

type Listener = (...args: unknown[]) => void;

interface Hooks {
  activated: Listener[];
  updated: Listener[];
  focus: Listener[];
}

let hooks: Hooks;

function stubChrome(tabsQuery: (query: Record<string, unknown>) => Promise<unknown[]>): void {
  hooks = { activated: [], updated: [], focus: [] };
  vi.stubGlobal('chrome', {
    tabs: {
      onActivated: { addListener: (fn: Listener) => hooks.activated.push(fn) },
      onUpdated: { addListener: (fn: Listener) => hooks.updated.push(fn) },
      query: vi.fn(tabsQuery),
    },
    windows: { onFocusChanged: { addListener: (fn: Listener) => hooks.focus.push(fn) } },
  });
}

/** Let the scheduled probe fire and its promise settle. */
async function settle(ms = 400): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

beforeEach(() => {
  stubChrome(async () => []);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('watchBrowser', () => {
  it('subscribes to the tab and window events a docked surface needs', () => {
    watchBrowser(async () => undefined);
    expect(hooks.activated).toHaveLength(1);
    expect(hooks.updated).toHaveLength(1);
    expect(hooks.focus).toHaveLength(1);
  });

  it('collapses a burst of events into one probe', async () => {
    const probe = vi.fn(async () => undefined);
    watchBrowser(probe, 20);

    // What loading a portal page looks like: a tab switch, then several
    // onUpdated hits as the document works through to complete.
    hooks.activated[0]?.({ tabId: 7 });
    hooks.updated[0]?.(7, { status: 'loading' }, {});
    hooks.updated[0]?.(7, { url: 'https://ship.inttra.e2open.com/siworkspace' }, {});
    hooks.updated[0]?.(7, { status: 'complete' }, {});

    await settle(120);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('ignores a tab change that cannot have changed the answer', async () => {
    const probe = vi.fn(async () => undefined);
    watchBrowser(probe, 20);

    // Chrome reports these on any tab. None of them moves the page.
    hooks.updated[0]?.(7, { audible: true }, {});
    hooks.updated[0]?.(7, { mutedInfo: { muted: true } }, {});
    hooks.updated[0]?.(7, { favIconUrl: 'https://example.test/i.png' }, {});

    await settle(120);
    expect(probe).not.toHaveBeenCalled();
  });

  it('never runs two probes at once, and runs once more for what arrived mid-probe', async () => {
    let running = 0;
    let overlapped = false;
    const probe = vi.fn(async () => {
      running += 1;
      if (running > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 60));
      running -= 1;
    });
    watchBrowser(probe, 10);

    hooks.activated[0]?.({ tabId: 1 });
    await settle(40);
    // The operator moved again while the first probe was still out.
    hooks.activated[0]?.({ tabId: 2 });
    await settle(200);

    expect(overlapped).toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('returns a re-probe the caller can fire itself', async () => {
    const probe = vi.fn(async () => undefined);
    const reprobe = watchBrowser(probe, 10);
    reprobe();
    await settle(60);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('subscribes to nothing rather than throwing where an event is missing', async () => {
    // The playground build, and any surface running on a smaller chrome than a
    // portal gives it. A probe not scheduled costs a refresh, not the panel.
    vi.stubGlobal('chrome', { tabs: { query: vi.fn(async () => []) } });
    expect(() => watchBrowser(async () => undefined)).not.toThrow();
  });
});

/**
 * Whether a browser-driven repaint may run.
 *
 * `tabs.onUpdated` fires for EVERY tab, so a background news tab finishing its
 * load is enough to trigger a probe. The probe is harmless; the re-render
 * after it would rebuild the DOM and take the caret out of whatever box the
 * operator was halfway through - which a popup, being already destroyed, could
 * never have done to them.
 */
describe('isEditing', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is false with nothing focused', () => {
    document.body.innerHTML = '<div id="root"><p>nothing to type in</p></div>';
    expect(isEditing()).toBe(false);
  });

  it('is true while the operator is in a box', () => {
    for (const markup of ['<textarea id="box"></textarea>', '<input id="box" />', '<select id="box"></select>']) {
      document.body.innerHTML = markup;
      (document.getElementById('box') as HTMLElement).focus();
      expect(isEditing(), markup).toBe(true);
    }
  });

  it('is false where the focus is on a button, which a render may safely replace', () => {
    document.body.innerHTML = '<button id="go">Fill</button>';
    (document.getElementById('go') as HTMLElement).focus();
    expect(isEditing()).toBe(false);
  });
});
