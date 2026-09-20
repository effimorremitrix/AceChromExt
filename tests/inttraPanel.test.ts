/**
 * The INTTRA Helper panel, in jsdom, on the Copy Container Details grid.
 *
 * One claim, and it is the one a live run of 2026-09-20 failed on. The grid
 * was detected correctly - the panel said so - and the operator still got
 * nowhere, because "use the Containers tab" was a line of small grey text
 * under four disabled buttons. Detection was never the problem; the route
 * was.
 *
 * So: on the grid page the Fill tab must LEAD to the Containers tab, and the
 * Containers tab must spell out the paste that the helper will not perform
 * itself. `chrome` is stubbed with what `startApp` touches.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { approveDeckhand, buildFilingPackage, type FilingPackage } from '../shared/src/index.js';
import { extractWithRules } from '../deckhand/src/index.js';
import type { StoredPackage } from '../inttra-extension/src/core/store.js';

const FIXTURES = join(__dirname, 'fixtures');

let session: Record<string, unknown>;
let page: { page: string; label: string; confidence: string; evidence: unknown[] };
let grid: { found: boolean; acceptsTyping: boolean };

async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

function button(label: string): HTMLButtonElement | null {
  const match = Array.from(document.querySelectorAll('button')).find((node) => node.textContent === label);
  return (match ?? null) as HTMLButtonElement | null;
}

function screen(): string {
  return document.querySelector('#root')?.textContent ?? '';
}

function storedPackage(): StoredPackage {
  const shipment = extractWithRules(readFileSync(join(FIXTURES, 'deckhand', '04-booking-confirmation.txt'), 'utf8'));
  const pkg: FilingPackage = approveDeckhand(buildFilingPackage({ shipment, now: new Date('2026-09-14T00:00:00Z') }), new Date('2026-09-14T00:00:00Z'));
  return { package: pkg, deckhand: null, selectedContainer: 0, sourceName: 'filing-package-TEST.json' };
}

async function open(): Promise<void> {
  const { startApp } = await import('../inttra-extension/src/ui/app.js');
  await startApp('panel');
  await settle();
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  session = { 'inttraHelper.package': storedPackage() };
  page = { page: 'copyContainerDetails', label: 'Copy Container Details', confidence: 'high', evidence: [] };
  grid = { found: true, acceptsTyping: false };

  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: () => ({ version: '0.1.0', version_name: '0.1.0+test' }),
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: vi.fn(async (message: { type: string; payload?: StoredPackage }) => {
        if (message.type === 'store/get') return { ok: true, type: 'store/data', payload: session['inttraHelper.package'] };
        if (message.type === 'store/set') {
          session['inttraHelper.package'] = message.payload;
          return { ok: true, type: 'store/data', payload: message.payload };
        }
        if (message.type === 'log/get') return { ok: true, type: 'log/data', payload: [] };
        if (message.type === 'log/append') return { ok: true, type: 'log/data', payload: [] };
        return { ok: false, error: `no stub for ${message.type}` };
      }),
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
      session: {
        get: vi.fn(async (key: string) => (key in session ? { [key]: session[key] } : {})),
        set: vi.fn(async (bag: Record<string, unknown>) => {
          Object.assign(session, bag);
        }),
        remove: vi.fn(async () => undefined),
      },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 7, url: 'https://ship.inttra.e2open.com/siact/siworkspace#/create/1789904042068', title: 'INTTRA - Shipping Instruction', active: true }]),
      sendMessage: vi.fn(async (_id: number, message: { type: string }) => {
        if (message.type === 'content/detectPage') return { ok: true, type: 'content/page', payload: page, grid };
        return { ok: false, error: `no stub for ${message.type}` };
      }),
      create: vi.fn(async () => undefined),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Fill tab on the Copy Container Details grid', () => {
  it('does not leave the operator with four disabled buttons and a grey sentence', async () => {
    await open();
    button('Fill INTTRA')?.click();
    await settle();

    // Fill genuinely cannot write this screen: the cells hold no control
    // until they are clicked, and the helper never clicks.
    expect(button('Fill Current Page')?.disabled).toBe(true);
    expect(screen()).toContain('cells hold no control until they are clicked');
    // ...so the way forward is a button, not a footnote.
    expect(button('Go to Containers')).not.toBeNull();
    expect(button('Go to Containers')?.disabled).toBe(false);
  });

  it('opens the Containers tab, with the paste spelled out and Copy rows leading', async () => {
    await open();
    button('Fill INTTRA')?.click();
    await settle();
    button('Go to Containers')?.click();
    await settle();

    expect(screen()).toContain('Copy Container Details');
    expect(button('Copy rows')).not.toBeNull();
    const steps = Array.from(document.querySelectorAll('ol.steps li')).map((node) => node.textContent ?? '');
    expect(steps.length).toBe(5);
    expect(steps[2]).toContain('Copy rows');
    expect(steps[3]).toContain('Ctrl+V');
    // The last step is INTTRA's own button, and it stays the operator's.
    expect(steps[4]).toContain('Create Containers');
    expect(screen()).toContain('the paste is yours');
  });

  it('says the grid cannot be typed into, rather than offering Fill as if it could', async () => {
    await open();
    button('Containers')?.click();
    await settle();

    expect(screen()).toContain('opens an editor when a cell is clicked');
    const actions = Array.from(document.querySelectorAll('.actions button')).map((node) => node.textContent);
    // Copy rows leads; Fill Container Grid is still there for a typeable grid.
    expect(actions[0]).toBe('Copy rows');
  });
});
