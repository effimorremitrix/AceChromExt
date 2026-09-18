/**
 * The seal column: two columns, no heading, no labels.
 *
 * A very common paste shape, and one that names nobody as the seal's owner, so
 * the seals land on the shipper side like every other unattributed seal (see
 * sealKindOf in deckhand/src/extract/containers.ts):
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
  return shipment.containers.map((c) => [c.containerNumber.normalized ?? c.containerNumber.raw, c.shipperSeal?.raw ?? '']);
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
    expect(shipment.containers[0]?.shipperSeal?.confidence).toBe('low');
    const review = buildReview(shipment);
    expect(review.containers[0]?.shipperSeal.mark).toBe('check');
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
    expect(shipment.containers.map((c) => c.shipperSeal?.raw)).toEqual(['7548801', '7548805']);
    expect(shipment.containers[0]?.shipperSeal?.confidence).toBe('high');
  });

  it('keeps a labelled seal labelled', () => {
    const text = ['MSDU7776110 | Seal No: SL-1', 'MEDU7011340 | Seal No: SL-2'].join('\n');
    const shipment = extractShipment({ kind: 'text', text, name: 't' });
    expect(shipment.containers.map((c) => c.shipperSeal?.raw)).toEqual(['SL-1', 'SL-2']);
    expect(shipment.containers[0]?.shipperSeal?.confidence).toBe('high');
  });
});

/**
 * The loading list the operator's own office produces.
 *
 * Reported on 2026-09-16: Deckhand read this table correctly except that it
 * filed the SEAL# column as the CARRIER's seal. The seals on a shipper's own
 * loading list are the ones that office applied, so they are shipper seals.
 * The columns either side of SEAL# are there because they were in the real
 * document: the rule has to survive them.
 */
describe("a shipper's own loading list", () => {
  const LOADING_LIST = [
    'GALCO\tContainer #\tLOT#:\tSEAL#\tBOOKING#\tVARIETY\tCONSIGNEE',
    '3994\tTLLU7564971\tPK00181\tUL-8546727\tEBKG18531463\tCA STD 5%\tAydin Kuruyemis',
    '4000\tTGBU7182073\tPK00183\tUL-8546730\tEBKG18531463\tCT18/20 SSR\tAydin Kuruyemis',
    '3999\tUETU7528305\tPK00182\tUL-8546729\tEBKG18592770\tCT18/20US.#1\tBaymar Kuruyemis',
  ].join('\n');

  const shipment = extractShipment({ kind: 'text', text: LOADING_LIST, name: 'loading list' });

  it('pairs every container with the seal on its own row', () => {
    expect(shipment.containers.map((c) => [c.containerNumber.normalized, c.shipperSeal?.raw])).toEqual([
      ['TLLU7564971', 'UL-8546727'],
      ['TGBU7182073', 'UL-8546730'],
      ['UETU7528305', 'UL-8546729'],
    ]);
    expect(shipment.unassignedSeals).toEqual([]);
  });

  it('files an unattributed SEAL# column as the shipper seal, not the carrier seal', () => {
    for (const container of shipment.containers) {
      expect(container.shipperSeal).not.toBeNull();
      expect(container.carrierSeal).toBeNull();
    }
  });

  it('says on the record that the attribution was assumed, not read', () => {
    // The document never says whose seal it is. The operator sees that on the
    // review screen rather than having to take the label on trust.
    expect(shipment.containers[0]?.shipperSeal?.label).toContain('unattributed');
  });

  it('is not confused by the booking, lot and variety columns around the seal', () => {
    // Neither the LOT# nor the BOOKING# cell may be mistaken for a seal, and
    // no seal may go missing because the row is seven columns wide.
    for (const container of shipment.containers) {
      expect(container.shipperSeal?.raw).toMatch(/^UL-/);
    }
    expect(shipment.containers.every((c) => c.evidence === 'same_row')).toBe(true);
  });
});

/**
 * The lone row at the top of a quoted reply chain.
 *
 * Reported on 2026-09-18 from a real producer email: fifteen containers, and
 * the seal on the first one missing. A reply chain cuts one list into blocks,
 * newest first, and the newest block is very often a single row - the one
 * container that came in after the rest. One line was not a column, so that
 * row's seal was the only one lost.
 *
 * The row joins the column the rest of the text already made. The refusals
 * below are the price of that: it joins only when the text agrees.
 */
describe('one row on its own, above a column the same text makes', () => {
  const chain = (rows: string[][]) =>
    [
      'Thank you',
      '',
      'On Wed, Jan 28, 2026 at 11:54 AM Ariana C. wrote:',
      '',
      ...(rows[0] as string[]),
      '',
      'On Wed, Jan 28, 2026 at 10:49 AM Ariana C. wrote:',
      '',
      ...(rows[1] as string[]),
    ].join('\n');

  const LONE = `${PAIRS[0]![0]}    ${PAIRS[0]![1]}`;
  const BLOCK = PAIRS.slice(1).map(([c, s]) => `${c}    ${s}`);

  it('reads the lone row as part of the column below it', () => {
    expect(read(chain([[LONE], BLOCK]))).toEqual(PAIRS.map(([c, s]) => [c, s]));
  });

  it('says on the record that the row stood alone', () => {
    const shipment = extractShipment({ kind: 'text', text: chain([[LONE], BLOCK]), name: 't' });
    expect(shipment.containers[0]?.shipperSeal?.label).toContain('row on its own');
    expect(shipment.containers[0]?.shipperSeal?.confidence).toBe('low');
    expect(shipment.containers[1]?.shipperSeal?.label).not.toContain('row on its own');
  });

  it('still refuses a lone row when the text makes no column at all', () => {
    const text = ['On Wed, Jan 28, 2026 at 11:54 AM Ariana C. wrote:', '', LONE].join('\n');
    expect(read(text)).toEqual([[PAIRS[0]![0], '']]);
  });

  it('refuses a lone row that puts the container on the other side', () => {
    const flipped = `${PAIRS[0]![1]}    ${PAIRS[0]![0]}`;
    expect(read(chain([[flipped], BLOCK]))).toEqual([[PAIRS[0]![0], ''], ...PAIRS.slice(1).map(([c, s]) => [c, s])]);
  });

  it('refuses a lone row whose seal the column already carries', () => {
    // The same row quoted twice is not two seals, and a repeated value in a
    // seal column is a booking number, not a seal.
    const repeat = `${PAIRS[0]![0]}    ${PAIRS[1]![1]}`;
    expect(read(chain([[repeat], BLOCK]))).toEqual([[PAIRS[0]![0], ''], ...PAIRS.slice(1).map(([c, s]) => [c, s])]);
  });

  it('refuses a lone row whose second value is a size-type code or a weight', () => {
    for (const token of ['40HC', '24000KG']) {
      expect(read(chain([[`${PAIRS[0]![0]}    ${token}`], BLOCK])), token).toEqual([
        [PAIRS[0]![0], ''],
        ...PAIRS.slice(1).map(([c, s]) => [c, s]),
      ]);
    }
  });

  it('refuses every lone row when the blocks disagree on which side the container is on', () => {
    const text = [
      LONE,
      '',
      'On Wed wrote:',
      '',
      ...PAIRS.slice(1, 4).map(([c, s]) => `${c}  ${s}`),
      '',
      'On Tue wrote:',
      '',
      ...PAIRS.slice(4).map(([c, s]) => `${s}  ${c}`),
    ].join('\n');
    expect(read(text)[0]).toEqual([PAIRS[0]![0], '']);
  });
});
