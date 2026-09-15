/**
 * The seal column: two columns, no heading, no labels.
 *
 * The shape a carrier email actually arrives in more often than any table:
 *
 *     MSDU7776110  7548801
 *     MEDU7011340  7548805
 *
 * Every seal here used to be lost, in every separator, because an unlabelled
 * token is never called a seal and there was no heading to call it one. The
 * block itself is the heading now.
 *
 * Half of these tests exist to make the rule REFUSE. A rule that reads a seal
 * out of an unlabelled column is only safe if it declines every other kind of
 * two-column list, so the refusals matter more than the successes.
 */

import { describe, expect, it } from 'vitest';
import { extractShipment, buildReview, formatContainerSealTsv } from '../../deckhand/src/index.js';
import { detectSealColumn, twoColumnLine } from '../../deckhand/src/extract/containers.js';

/** Real containers from a carrier list; every one passes its ISO 6346 check digit. */
const PAIRS: Array<[string, string]> = [
  ['MSDU7776110', '7548801'],
  ['MEDU7011340', '7548805'],
  ['TGBU6995401', '7548809'],
  ['MSNU8063113', '7548810'],
  ['MEDU7603673', '7548817'],
  ['MSMU7737784', '7548819'],
  ['MEDU4744019', '7548826'],
];

const read = (text: string) => {
  const shipment = extractShipment({ kind: 'text', text, name: 'pasted text' });
  return shipment.containers.map((c) => [c.containerNumber.normalized ?? c.containerNumber.raw, c.carrierSeal?.raw ?? '']);
};

describe('a two-column list with no heading', () => {
  const expected = PAIRS.map(([container, seal]) => [container, seal]);

  it('reads the seal whatever separates the columns', () => {
    for (const join of [' ', '  ', '\t', ' | ']) {
      expect(read(PAIRS.map(([c, s]) => `${c}${join}${s}`).join('\n')), join).toEqual(expected);
    }
  });

  it('reads it through the blank line a mail client puts between rows', () => {
    expect(read(PAIRS.map(([c, s]) => `${c} ${s}`).join('\n\n'))).toEqual(expected);
  });

  it('reads it with the columns the other way round', () => {
    expect(read(PAIRS.map(([c, s]) => `${s}  ${c}`).join('\n'))).toEqual(expected);
  });

  it('recovers a row whose separator was lost in the paste', () => {
    // "TGBU69954017548809" is one token. ISO 6346 says where the container ends
    // and the check digit agrees, so the row is not dropped.
    const text = PAIRS.map(([c, s], i) => (i === 2 ? `${c}${s}` : `${c} ${s}`)).join('\n');
    expect(read(text)).toEqual(expected);
  });

  it('marks the seal as not certain, because the column named itself', () => {
    const shipment = extractShipment({ kind: 'text', text: PAIRS.map(([c, s]) => `${c} ${s}`).join('\n'), name: 't' });
    expect(shipment.containers[0]?.carrierSeal?.confidence).toBe('low');
    const review = buildReview(shipment);
    expect(review.containers[0]?.carrierSeal.mark).toBe('check');
    // Not certain is not the same as blocking: the rows are still approvable.
    expect(review.canApprove).toBe(true);
  });

  it('feeds the two columns the container template wants', () => {
    const shipment = extractShipment({ kind: 'text', text: PAIRS.map(([c, s]) => `${c} ${s}`).join('\n'), name: 't' });
    expect(formatContainerSealTsv(shipment).split('\r\n')).toEqual(PAIRS.map(([c, s]) => `${c}\t${s}`));
  });
});

describe('what the rule must refuse', () => {
  const refuses = (text: string) => expect([...detectSealColumn(text.split('\n')).keys()]).toEqual([]);

  it('refuses one line on its own, because one line is not a column', () => {
    refuses('MSDU7776110 7548801');
  });

  it('refuses a column that repeats one value, because a seal belongs to one container', () => {
    // A booking number down the column is not seven seals.
    refuses(PAIRS.map(([c]) => `${c} EBKG15117043`).join('\n'));
  });

  it('refuses a size-type column', () => {
    refuses(PAIRS.map(([c]) => `${c} 40HC`).join('\n'));
    refuses(PAIRS.map(([c], i) => `${c} ${['22G1', '45R1', '20GP', '40HQ', '45HC', '22G1', '40DV'][i]}`).join('\n'));
  });

  it('refuses a weight column', () => {
    refuses(PAIRS.map(([c], i) => `${c} ${24000 + i}KG`).join('\n'));
  });

  it('refuses a word beside the container', () => {
    refuses(PAIRS.map(([c]) => `Container ${c}`).join('\n'));
    refuses(PAIRS.map(([c]) => `${c} Shanghai`).join('\n'));
  });

  it('refuses a line carrying anything more than the two values', () => {
    refuses(PAIRS.map(([c, s]) => `${c} ${s} 40HC`).join('\n'));
  });

  it('refuses two containers on one line', () => {
    refuses(`${PAIRS[0]![0]} ${PAIRS[1]![0]}\n${PAIRS[2]![0]} ${PAIRS[3]![0]}`);
  });

  it('refuses a block that changes which side the container is on', () => {
    refuses(`${PAIRS[0]![0]} ${PAIRS[0]![1]}\n${PAIRS[1]![1]} ${PAIRS[1]![0]}`);
  });

  it('refuses to split a run-together token whose check digit does not agree', () => {
    // MSDU7776111 is MSDU7776110 with the check digit changed: not a container,
    // so the cut is not taken and nothing is invented.
    expect(twoColumnLine('MSDU77761117548801')).toBeNull();
    expect(twoColumnLine('MSDU77761107548801')).toEqual({ container: 'MSDU7776110', seal: '7548801', containerFirst: true });
  });

  it('leaves the unpaired-lists case unpaired, which is the failure that matters', () => {
    const text = ['Containers: MSDU7776110, MEDU7011340', 'Seals: 7548801, 7548805'].join('\n');
    expect(read(text).every(([, seal]) => seal === '')).toBe(true);
  });
});

describe('a heading still wins where there is one', () => {
  it('reads the labelled table at full confidence, not as an unlabelled column', () => {
    const text = ['Container #\tSEAL#', 'MSDU7776110\t7548801', 'MEDU7011340\t7548805'].join('\n');
    const shipment = extractShipment({ kind: 'text', text, name: 't' });
    expect(shipment.containers.map((c) => c.carrierSeal?.raw)).toEqual(['7548801', '7548805']);
    expect(shipment.containers[0]?.carrierSeal?.confidence).toBe('high');
  });

  it('keeps a labelled seal labelled', () => {
    const text = ['MSDU7776110 | Seal No: SL-1', 'MEDU7011340 | Seal No: SL-2'].join('\n');
    const shipment = extractShipment({ kind: 'text', text, name: 't' });
    expect(shipment.containers.map((c) => c.carrierSeal?.raw)).toEqual(['SL-1', 'SL-2']);
    expect(shipment.containers[0]?.carrierSeal?.confidence).toBe('high');
  });
});
