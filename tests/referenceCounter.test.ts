/**
 * The Shipment Reference Number counter.
 *
 * The filer's rule (2026-09-16) is that the sequence has NO GAPS and never
 * resets. Most of these tests exist to prove that: the ways a number could
 * quietly be skipped are each given their own case, because a gap is the one
 * outcome that is not allowed.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COUNTER,
  formatReference,
  markFiled,
  mergeCounter,
  nextReference,
  releaseReservation,
  reserve,
  setNextReference,
  type ReferenceCounter,
} from '../src/core/referenceCounter.js';
import { fillFields } from '../src/content/filler.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { emptyInvoice, emptyProvenance, type CanonicalShipment } from '../src/models/CanonicalInvoice.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const at = (lastFiled: number, reserved: number | null = null): ReferenceCounter => ({ lastFiled, reserved, configured: true });

describe('handing out a number', () => {
  it('starts from the number the operator says comes next', () => {
    // They last filed 4087 outside the system, so 4088 comes next.
    const counter = setNextReference(DEFAULT_COUNTER, 4088);
    expect(nextReference(counter)).toBe(4088);
    expect(counter.configured).toBe(true);
  });

  it('does not advance the sequence when a number is handed out', () => {
    const counter = reserve(at(4087));
    expect(nextReference(counter)).toBe(4088);
    expect(counter.lastFiled).toBe(4087);
  });

  it('hands out the SAME number again until the filing is confirmed', () => {
    // The gap case. A draft is started, abandoned, started again: one number.
    let counter = reserve(at(4087));
    expect(nextReference(counter)).toBe(4088);
    counter = reserve(counter);
    counter = reserve(counter);
    expect(nextReference(counter)).toBe(4088);
    expect(counter.lastFiled).toBe(4087);
  });

  it('advances only on markFiled, and only once', () => {
    let counter = markFiled(reserve(at(4087)));
    expect(counter).toMatchObject({ lastFiled: 4088, reserved: null });
    expect(nextReference(counter)).toBe(4089);
    // A second click has nothing reserved to retire, so it cannot skip 4089.
    counter = markFiled(counter);
    expect(counter.lastFiled).toBe(4088);
    expect(nextReference(counter)).toBe(4089);
  });

  it('runs a whole sequence with no gaps and no repeats', () => {
    let counter = setNextReference(DEFAULT_COUNTER, 4088);
    const filed: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      counter = reserve(counter);
      filed.push(nextReference(counter));
      counter = markFiled(counter);
    }
    expect(filed).toEqual([4088, 4089, 4090, 4091, 4092]);
  });

  it('leaves no gap when a reserved number is given back', () => {
    let counter = reserve(at(4087));
    counter = releaseReservation(counter);
    expect(counter.lastFiled).toBe(4087);
    expect(nextReference(counter)).toBe(4088);
  });

  it('never resets: setting the next number forward keeps it there', () => {
    const counter = setNextReference(at(4087), 5000);
    expect(nextReference(counter)).toBe(5000);
    expect(counter.lastFiled).toBe(4999);
  });
});

describe('what comes back out of storage', () => {
  it('falls back to the default for anything unrecognisable', () => {
    for (const junk of [null, undefined, 'nope', 42, [], { lastFiled: 'x' }]) {
      expect(mergeCounter(junk).lastFiled).toBe(0);
    }
  });

  it('drops a reservation that was already filed, so it cannot be handed out twice', () => {
    expect(mergeCounter({ lastFiled: 4090, reserved: 4088, configured: true }).reserved).toBeNull();
    expect(nextReference(mergeCounter({ lastFiled: 4090, reserved: 4088, configured: true }))).toBe(4091);
  });

  it('keeps a live reservation across a restart', () => {
    const stored = mergeCounter({ lastFiled: 4087, reserved: 4088, configured: true });
    expect(nextReference(stored)).toBe(4088);
  });

  it('refuses a negative, fractional or absurd number', () => {
    expect(mergeCounter({ lastFiled: -5, configured: true }).lastFiled).toBe(0);
    expect(mergeCounter({ lastFiled: 4087.9, configured: true }).lastFiled).toBe(4087);
    expect(mergeCounter({ lastFiled: 1e15, configured: true }).lastFiled).toBe(0);
  });
});

describe('what ACE is actually given', () => {
  const html = (name: string): string => readFileSync(join(__dirname, 'fixtures', `${name}.html`), 'utf8');

  function shipment(): CanonicalShipment {
    return {
      invoice: { ...emptyInvoice(), invoiceNumber: 'INV-20451', invoiceDate: '2026-03-12', destination: 'IL', originState: 'CA' },
      commodities: [],
      provenance: emptyProvenance(),
      source: { fileName: 'x.xlsx', sheetName: 'Shipment', importedAt: '', rowCount: 0, headers: [], unknownHeaders: [] },
    };
  }

  const reference = (): string => (document.getElementById('shipmentReferenceNumber') as HTMLInputElement).value;

  it('writes the counter value, not the invoice number, when a counter is set up', () => {
    document.body.innerHTML = html('ace-shipment');
    fillFields(
      {
        shipment: shipment(),
        page: 'shipment',
        scope: 'shipment',
        settings: DEFAULT_SETTINGS,
        operator: { shipmentReference: formatReference(nextReference(at(4087))) },
      },
      document,
    );
    expect(reference()).toBe('4088');
  });

  it('falls back to the invoice number when no counter has been set up', () => {
    // Exactly what this field did before the counter existed, so an operator
    // who never configures one sees no change.
    document.body.innerHTML = html('ace-shipment');
    fillFields({ shipment: shipment(), page: 'shipment', scope: 'shipment', settings: DEFAULT_SETTINGS }, document);
    expect(reference()).toBe('INV-20451');
  });

  it('writes the same number on a re-fill of an abandoned draft', () => {
    const counter = reserve(at(4087));
    for (const _pass of [1, 2]) {
      document.body.innerHTML = html('ace-shipment');
      fillFields(
        {
          shipment: shipment(),
          page: 'shipment',
          scope: 'shipment',
          settings: DEFAULT_SETTINGS,
          operator: { shipmentReference: formatReference(nextReference(counter)) },
        },
        document,
      );
      expect(reference()).toBe('4088');
    }
  });
});
