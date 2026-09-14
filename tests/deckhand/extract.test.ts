/**
 * Deckhand extraction: what it reads, what it refuses to pair, what it flags.
 *
 * Every test here is really one assertion from a different angle: a seal
 * reaches a container only through evidence that the document showed them
 * together, and nothing is corrected or invented.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractShipment, extractWithRules, readInput, withCheckDigit } from '../../deckhand/src/index.js';

const FIXTURES = join(__dirname, '..', 'fixtures', 'deckhand');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

const C1 = 'CSQU3054383';
const C2 = 'TGHU7654320';

describe('header fields', () => {
  it('reads booking, vessel, voyage and ports from behind their labels', () => {
    const x = extractWithRules(fixture('01-aligned.txt'));
    expect(x.bookingReference).toMatchObject({ value: 'SHPX-99120', confidence: 'high' });
    expect(x.vessel).toMatchObject({ value: 'Meridian Aurora', confidence: 'high' });
    expect(x.voyage).toMatchObject({ value: '12E', confidence: 'high' });
    expect(x.portOfLoading.value).toBe('Shanghai');
    expect(x.portOfDischarge.value).toBe('Rotterdam');
    expect(x.bookingReference.evidence).toMatch(/line \d+/);
  });

  it('keeps a missing field as an explicit null, and lists it under uncertainties', () => {
    const x = extractWithRules(`Container ${C1} | Seal No: SL-9`);
    expect(x.bookingReference).toEqual({ value: null, confidence: 'unsure' });
    expect(x.vessel.value).toBeNull();
    const missing = x.uncertainties.filter((item) => item.code === 'missing-field').map((item) => item.field);
    expect(missing).toEqual(['bookingReference', 'shipmentReference', 'vessel', 'voyage', 'portOfLoading', 'portOfDischarge']);
  });

  it('splits "Vessel/Voyage: X / Y" into both fields', () => {
    const x = extractWithRules('Vessel/Voyage: MSC FIRENZE / 541W');
    expect(x.vessel.value).toBe('MSC FIRENZE');
    expect(x.voyage.value).toBe('541W');
  });

  it('reads a shipment reference separately from the booking reference', () => {
    const x = extractWithRules(fixture('04-booking-confirmation.txt'));
    expect(x.bookingReference.value).toBe('EBKG18531408');
    expect(x.shipmentReference.value).toBe('SID-2026-0042');
  });

  it('does not mistake "policy" for a port of loading label', () => {
    const x = extractWithRules('Our policy: never guess.\nPOL: Haifa');
    expect(x.portOfLoading.value).toBe('Haifa');
  });

  it('lowers confidence and flags when a label carries two different values', () => {
    const x = extractWithRules('Booking Ref: AAA-1\nSome text\nBooking No: BBB-2');
    expect(x.bookingReference.value).toBe('AAA-1');
    expect(x.bookingReference.confidence).toBe('low');
    expect(x.uncertainties.some((item) => item.code === 'ambiguous-field' && item.field === 'bookingReference')).toBe(true);
  });
});

describe('containers and seals', () => {
  it('pairs a container with the seal on the same table row', () => {
    const x = extractWithRules(fixture('01-aligned.txt'));
    expect(x.containers).toHaveLength(2);
    expect(x.containers[0]).toMatchObject({ containerNumber: { normalized: C1, status: 'valid' }, carrierSeal: { raw: 'SL-44821' }, evidence: 'same_row' });
    expect(x.containers[1]).toMatchObject({ containerNumber: { normalized: C2 }, carrierSeal: { raw: 'SL-44822' } });
    expect(x.unassignedSeals).toEqual([]);
  });

  it('refuses to pair containers and seals listed separately', () => {
    // The failure that matters. Two containers, two seals, nothing tying a
    // seal to a container. Zipping them by position is the one thing that
    // must never happen.
    const x = extractWithRules(fixture('02-unaligned.txt'));
    expect(x.containers.map((container) => container.containerNumber.normalized)).toEqual([C1, C2]);
    for (const container of x.containers) {
      expect(container.carrierSeal).toBeNull();
      expect(container.evidence).toBeNull();
      expect(container.containerNumber.confidence).toBe('low');
    }
    expect(x.unassignedSeals.map((seal) => seal.raw)).toEqual(['SL-44821', 'SL-44822']);
    const flag = x.uncertainties.find((item) => item.code === 'unassigned-seals');
    expect(flag?.severity).toBe('error');
    expect(flag?.message).toMatch(/NOT paired/);
  });

  it('reads a table by its header row, including a shipper seal column', () => {
    const x = extractWithRules(fixture('04-booking-confirmation.txt'));
    const first = x.containers.find((container) => container.containerNumber.normalized === 'MSCU1234566');
    expect(first).toMatchObject({ carrierSeal: { raw: 'SL-4471209' }, shipperSeal: { raw: 'SH-001' }, evidence: 'same_row' });
    const second = x.containers.find((container) => container.containerNumber.normalized === 'MSDU7654322');
    expect(second).toMatchObject({ carrierSeal: { raw: 'SL-4471210' }, shipperSeal: null, evidence: 'same_row' });
  });

  it('pairs a container with the seal on the very next line as one labelled block', () => {
    const x = extractWithRules(fixture('04-booking-confirmation.txt'));
    const third = x.containers.find((container) => container.containerNumber.normalized === C2);
    expect(third).toMatchObject({ carrierSeal: { raw: 'SL-9' }, evidence: 'same_block' });
  });

  it('does not treat a seal two lines away as the same block', () => {
    const x = extractWithRules(`Container: ${C1}\n\nUnrelated line\nSeal: SL-1`);
    expect(x.containers[0]?.carrierSeal).toBeNull();
    expect(x.unassignedSeals.map((seal) => seal.raw)).toEqual(['SL-1']);
  });

  it('merges repeat mentions of one container into one entry and keeps the seal', () => {
    const x = extractWithRules(fixture('04-booking-confirmation.txt'));
    const reefer = x.containers.filter((container) => container.containerNumber.normalized === 'MSCU1234566');
    expect(reefer).toHaveLength(1);
    expect(reefer[0]?.mentions).toBe(2);
    expect(reefer[0]?.carrierSeal?.raw).toBe('SL-4471209');
    expect(x.containers).toHaveLength(3);
  });

  it('keeps spare seals that belong to no container out of every row', () => {
    const x = extractWithRules(fixture('04-booking-confirmation.txt'));
    expect(x.unassignedSeals.map((seal) => seal.raw)).toEqual(['SL-99001', 'SL-99002']);
    for (const container of x.containers) {
      expect(container.carrierSeal?.raw).not.toMatch(/SL-9900/);
    }
  });

  it('empties the seal and flags the container when two different seals are claimed', () => {
    const x = extractWithRules(`${C1} | Seal No: SL-1\nNote: ${C1} seal: SL-2`);
    expect(x.containers).toHaveLength(1);
    expect(x.containers[0]?.sealConflict).toBe(true);
    expect(x.containers[0]?.carrierSeal).toBeNull();
    expect(x.uncertainties.some((item) => item.code === 'seal-conflict' && item.severity === 'error')).toBe(true);
  });

  it('is not a conflict when the same seal is stated twice', () => {
    const x = extractWithRules(`${C1} | Seal No: SL-1\nNote: ${C1} seal: SL-1`);
    expect(x.containers[0]?.sealConflict).toBe(false);
    expect(x.containers[0]?.carrierSeal?.raw).toBe('SL-1');
  });

  it('flags a container with no seal in the document', () => {
    const x = extractWithRules(`Container: ${C1} Seal: SL-1\nContainer: ${C2}`);
    expect(x.containers[1]?.carrierSeal).toBeNull();
    expect(x.uncertainties.some((item) => item.code === 'seal-missing' && item.container === C2)).toBe(true);
  });

  it('flags a failed check digit loudly and never corrects it', () => {
    const x = extractWithRules(fixture('03-bad-check-digit.txt'));
    expect(x.containers[0]?.containerNumber).toMatchObject({ raw: 'TGHU7654321', normalized: 'TGHU7654321', status: 'invalid' });
    expect(x.containers[0]?.carrierSeal?.raw).toBe('SL-1');
    const flag = x.uncertainties.find((item) => item.code === 'check-digit');
    expect(flag?.severity).toBe('error');
    expect(flag?.message).toContain('TGHU7654321');
    expect(JSON.stringify(x)).not.toContain(C2);
  });

  it('reads containers written with spaces or dashes', () => {
    const number = withCheckDigit('MSKU987654');
    const spaced = `${number.slice(0, 4)} ${number.slice(4, 10)} ${number.slice(10)}`;
    const x = extractWithRules(`Container: ${spaced} Seal: S1`);
    expect(x.containers[0]?.containerNumber.normalized).toBe(number);
  });

  it('records several containers on one line as unpaired mentions with low confidence', () => {
    const x = extractWithRules(`Boxes ${C1} and ${C2} loaded. Seal: SL-1`);
    expect(x.containers).toHaveLength(2);
    expect(x.containers.every((container) => container.evidence === null && container.containerNumber.confidence === 'low')).toBe(true);
    expect(x.unassignedSeals.map((seal) => seal.raw)).toEqual(['SL-1']);
  });

  it('says so when nothing was recognised', () => {
    const x = extractWithRules('Hello, please call me about the shipment.');
    expect(x.containers).toEqual([]);
    expect(x.uncertainties.some((item) => item.code === 'no-containers')).toBe(true);
  });
});

describe('confidence', () => {
  it('is carried per field and per container, never as one score', () => {
    const x = extractWithRules(fixture('02-unaligned.txt'));
    expect(x.bookingReference.confidence).toBe('high');
    expect(x.containers[0]?.containerNumber.confidence).toBe('low');
    expect(x.unassignedSeals[0]?.confidence).toBe('low');
    expect('confidence' in x).toBe(false);
  });
});

describe('inputs', () => {
  it('reads the text/plain part of a saved .eml, decoding quoted-printable', () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, '05-saved-email.eml')));
    const read = readInput({ kind: 'file', name: 'booking.eml', mediaType: 'message/rfc822', bytes });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.text).toContain('Subject: Container & seal details - SHPX-99120');
    expect(read.text).toContain('Regards – Operations Desk');
    expect(read.text).not.toContain('<html>');
    const x = extractShipment({ kind: 'file', name: 'booking.eml', mediaType: '', bytes });
    expect(x.containers).toHaveLength(2);
    expect(x.containers[0]?.carrierSeal?.raw).toBe('SL-44821');
    expect(x.source).toMatchObject({ kind: 'file', name: 'booking.eml', extractor: 'rules-1' });
  });

  it('reads a plain text file', () => {
    const bytes = new TextEncoder().encode(fixture('01-aligned.txt'));
    const x = extractShipment({ kind: 'file', name: 'booking.txt', mediaType: 'text/plain', bytes });
    expect(x.bookingReference.value).toBe('SHPX-99120');
  });

  it('declines a PDF or an image honestly rather than pretending', () => {
    for (const [name, mediaType] of [
      ['notice.pdf', 'application/pdf'],
      ['scan.png', 'image/png'],
    ] as const) {
      const x = extractShipment({ kind: 'file', name, mediaType, bytes: new Uint8Array([1, 2, 3]) });
      expect(x.containers).toEqual([]);
      expect(x.uncertainties[0]?.code).toBe('reader');
      expect(x.uncertainties[0]?.severity).toBe('error');
      expect(x.uncertainties[0]?.message).toMatch(/paste/i);
    }
  });

  it('refuses empty text with a reason', () => {
    const x = extractShipment({ kind: 'text', text: '   ' });
    expect(x.uncertainties[0]).toMatchObject({ code: 'reader', severity: 'error' });
  });
});
