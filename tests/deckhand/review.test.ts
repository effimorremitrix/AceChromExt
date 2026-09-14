/**
 * The review model, the text outputs and the JSON round trip.
 *
 * The container-row tests are the previous implementation's format tests,
 * kept because the rows are read by a machine: a seal on the wrong row would
 * be copied into a portal without anyone noticing.
 */

import { describe, expect, it } from 'vitest';
import {
  approveShipment,
  assembleContainers,
  buildReview,
  containerRows,
  CONTAINER_ROW_COLUMNS,
  deckhandFileName,
  emptyDeckhandShipment,
  extractWithRules,
  formatBlock,
  formatCsv,
  formatTsv,
  parseDeckhandJson,
  serializeDeckhandShipment,
  toContainerNumber,
  withCheckDigit,
  DeckhandParseError,
  type DeckhandShipment,
  type SealField,
} from '../../deckhand/src/index.js';
import type { ContainerMention } from '../../deckhand/src/extract/containers.js';

const C1 = withCheckDigit('CSQU305438');
const C2 = withCheckDigit('TGHU765432');
const C3 = withCheckDigit('MSKU123456');

const seal = (raw: string): SealField => ({ raw, confidence: 'high' });
const mention = (raw: string, carrier: string | null, shipper: string | null = null, line = 1): ContainerMention => ({
  number: toContainerNumber(raw),
  carrierSeal: carrier === null ? null : seal(carrier),
  shipperSeal: shipper === null ? null : seal(shipper),
  evidence: 'same_row',
  line,
});

function shipmentWith(mentions: ContainerMention[], unassigned: SealField[] = []): DeckhandShipment {
  const shipment = emptyDeckhandShipment();
  shipment.containers = assembleContainers(mentions);
  shipment.unassignedSeals = unassigned;
  return shipment;
}

const tsvLines = (shipment: DeckhandShipment): string[] => {
  const tsv = formatTsv(shipment);
  return tsv === '' ? [] : tsv.split('\r\n');
};

describe('container rows', () => {
  it('writes one row per container with the seal beside its own container', () => {
    const x = shipmentWith([mention(C1, 'SL-44821'), mention(C2, 'SL-44822')]);
    expect(tsvLines(x)).toEqual([`${C1}\tSL-44821\t`, `${C2}\tSL-44822\t`]);
    expect(formatCsv(x).split('\r\n')).toEqual([CONTAINER_ROW_COLUMNS.join(','), `${C1},SL-44821,`, `${C2},SL-44822,`, '']);
  });

  it('keeps a container with no seal on its row with an empty cell', () => {
    const x = shipmentWith([mention(C1, 'SL-44821'), mention(C2, null)]);
    expect(tsvLines(x)).toEqual([`${C1}\tSL-44821\t`, `${C2}\t\t`]);
    expect(formatTsv(x)).not.toContain(`${C2}\tSL-`);
  });

  it('gives unassigned seals no row at all', () => {
    const x = shipmentWith([mention(C1, 'SL-44821'), { ...mention(C2, null), evidence: null }, { ...mention(C3, null), evidence: null }], [seal('SL-99001'), seal('SL-99002')]);
    expect(tsvLines(x)).toEqual([`${C1}\tSL-44821\t`, `${C2}\t\t`, `${C3}\t\t`]);
    for (const loose of ['SL-99001', 'SL-99002']) {
      expect(formatTsv(x)).not.toContain(loose);
      expect(formatCsv(x)).not.toContain(loose);
    }
    expect(formatBlock(x)).toContain('NOT PAIRED');
  });

  it('carries a failed check digit verbatim', () => {
    const broken = `${C2.slice(0, 10)}${(Number(C2[10]) + 1) % 10}`;
    const x = shipmentWith([mention(C1, 'SL-44821'), mention(broken, 'SL-44822')]);
    expect(tsvLines(x)).toEqual([`${C1}\tSL-44821\t`, `${broken}\tSL-44822\t`]);
    expect(formatTsv(x)).not.toContain(C2);
    expect(formatBlock(x)).toMatch(/CHECK DIGIT FAILS/);
  });

  it('merges a container named twice into one row, taking the seal from the mention that carried it', () => {
    const x = shipmentWith([mention(C1, 'SL-44821'), mention(C2, 'SL-44822'), mention(C1, null, null, 9)]);
    expect(tsvLines(x)).toEqual([`${C1}\tSL-44821\t`, `${C2}\tSL-44822\t`]);
    expect(x.containers[0]?.mentions).toBe(2);
    expect(x.containers[0]?.lines).toEqual([1, 9]);
  });

  it('fills the seal in from whichever mention carried one, in either order', () => {
    const x = shipmentWith([mention(C1, null), mention(C1, 'SL-44821')]);
    expect(tsvLines(x)).toEqual([`${C1}\tSL-44821\t`]);
  });

  it('empties both seal cells rather than picking one when two different seals are given', () => {
    const x = shipmentWith([mention(C1, 'SL-44821', 'SH-1'), mention(C1, 'SL-99999')]);
    expect(tsvLines(x)).toEqual([`${C1}\t\t`]);
    expect(x.containers[0]?.sealConflict).toBe(true);
    const third = shipmentWith([mention(C1, 'SL-44821'), mention(C1, 'SL-99999'), mention(C1, 'SL-44821')]);
    expect(third.containers[0]?.sealConflict).toBe(true);
  });

  it('never invents a pairing across two different containers', () => {
    const x = shipmentWith([mention(C1, null), mention(C2, 'SL-44822'), mention(C3, null)]);
    expect(tsvLines(x)).toEqual([`${C1}\t\t`, `${C2}\tSL-44822\t`, `${C3}\t\t`]);
  });

  it('uses CRLF and exactly three columns per row, quoting only where CSV needs it', () => {
    const x = shipmentWith([mention(C1, 'SL-1, SL-2'), mention(C2, 'SL-"3"')]);
    expect(formatTsv(x)).not.toMatch(/(^|[^\r])\n/);
    for (const line of tsvLines(x)) expect(line.split('\t')).toHaveLength(3);
    const rows = formatCsv(x).split('\r\n');
    expect(rows[1]).toBe(`${C1},"SL-1, SL-2",`);
    expect(rows[2]).toBe(`${C2},"SL-""3""",`);
  });

  it('produces no rows for an empty extraction', () => {
    const x = emptyDeckhandShipment();
    expect(formatTsv(x)).toBe('');
    expect(containerRows(x)).toEqual([]);
    expect(formatCsv(x)).toBe(`${CONTAINER_ROW_COLUMNS.join(',')}\r\n`);
  });

  it('names the file after the booking reference, sanitized', () => {
    expect(deckhandFileName(emptyDeckhandShipment(), 'json')).toBe('deckhand-shipment.json');
    const x = emptyDeckhandShipment();
    x.bookingReference = { value: '../../etc/passwd', confidence: 'low' };
    const name = deckhandFileName(x, 'csv');
    expect(name).toBe('deckhand-etc-passwd.csv');
    expect(name).not.toContain('/');
  });
});

describe('the review', () => {
  it('marks every header field and every container, and prints missing values', () => {
    const x = extractWithRules(`Container ${C1} | Seal No: SL-9`);
    const review = buildReview(x);
    expect(review.headerRows.map((row) => row.mark)).toEqual(['warn', 'warn', 'warn', 'warn', 'warn', 'warn']);
    expect(review.containers[0]?.number.mark).toBe('ok');
    expect(review.containers[0]?.carrierSeal.mark).toBe('ok');
    expect(review.canApprove).toBe(true);
    const block = formatBlock(x);
    for (const label of ['Booking reference', 'Vessel', 'Voyage', 'Port of loading', 'Port of discharge', 'Anything I am unsure of']) expect(block).toContain(label);
    expect(block).toContain('(missing)');
  });

  it('blocks approval on a failed check digit, a seal conflict, or an unpaired list', () => {
    const bad = extractWithRules(`Container TGHU7654321 | Seal No: SL-1`);
    expect(buildReview(bad).canApprove).toBe(false);
    expect(() => approveShipment(bad)).toThrow(/check digit/);

    const conflict = extractWithRules(`${C1} | Seal No: SL-1\n${C1} seal: SL-2`);
    expect(buildReview(conflict).canApprove).toBe(false);

    const unaligned = extractWithRules(`Containers: ${C1}, ${C2}\nSeals: SL-1, SL-2`);
    expect(buildReview(unaligned).canApprove).toBe(false);
    expect(() => approveShipment(unaligned)).toThrow(/NOT paired/);
  });

  it('does not block approval on a missing value; missing is filled by hand', () => {
    const x = extractWithRules(`Container ${C1}\nContainer ${C2} Seal: SL-2`);
    const review = buildReview(x);
    expect(review.containers[0]?.carrierSeal.mark).toBe('warn');
    expect(review.canApprove).toBe(true);
    const approved = approveShipment(x, new Date('2026-09-14T10:00:00Z'));
    expect(approved.approvedAt).toBe('2026-09-14T10:00:00.000Z');
  });

  it('refuses to approve an extraction with no containers', () => {
    expect(() => approveShipment(extractWithRules('nothing here'))).toThrow(/nothing to approve/);
  });

  it('prints the review block with marks per line and container/seal on one line each', () => {
    const block = formatBlock(extractWithRules(`Booking Ref: SHPX-99120\n${C1} | Seal No: SL-44821\n${C2} | Seal No: SL-44822`), { ascii: true });
    expect(block).toMatch(/Booking reference\s+: SHPX-99120\s+v/);
    expect(block).toMatch(new RegExp(`${C1}\\s+v\\s+carrier seal SL-44821\\s+v`));
    expect(block).toMatch(new RegExp(`${C2}\\s+v\\s+carrier seal SL-44822`));
  });
});

describe('serialization', () => {
  it('round-trips through JSON', () => {
    const x = extractWithRules(`Booking Ref: SHPX-99120\nVessel: X   Voyage: 1\n${C1} | Seal No: SL-1\n${C2} | Shipper seal: SH-2`);
    const back = parseDeckhandJson(serializeDeckhandShipment(x));
    expect(back).toEqual(x);
  });

  it('recomputes container status from the raw number rather than trusting the file', () => {
    const x = extractWithRules(`Container TGHU7654321 | Seal No: SL-1`);
    const forged = JSON.parse(serializeDeckhandShipment(x)) as { containers: Array<{ containerNumber: { status: string } }> };
    forged.containers[0]!.containerNumber.status = 'valid';
    const back = parseDeckhandJson(JSON.stringify(forged));
    expect(back.containers[0]?.containerNumber.status).toBe('invalid');
  });

  it('rejects a wrong schema version, non-JSON, and a container without a number', () => {
    expect(() => parseDeckhandJson('not json')).toThrow(DeckhandParseError);
    expect(() => parseDeckhandJson('{"schemaVersion":"9.9"}')).toThrow(/schema version/);
    expect(() => parseDeckhandJson('{"schemaVersion":"1.0","containers":[{"containerNumber":{}}]}')).toThrow(/no container number/);
  });
});
