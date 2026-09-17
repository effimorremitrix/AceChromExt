/**
 * The DOC CUT paste: containers came out, seals did not.
 *
 * The extractor was never the problem. Give it the sheet with its rows intact
 * and it returns every container beside its own seal. The paste was the
 * problem: a <textarea> takes the mail client's flattened text/plain and the
 * real <table> in text/html is discarded, so the row a seal shares with its
 * container stops existing before extraction begins.
 *
 * These tests pin both halves: that flattening really does cost the seals, and
 * that reading the html flavour really does bring them back.
 */

import { describe, expect, it } from 'vitest';
import { extractShipment, formatContainerColumn, formatContainerSealTsv, formatSealColumn, carrierSealsOmitted } from '../../deckhand/src/index.js';
import { describeTables, readHtmlClipboard, tableRows, toTsv } from '../../src/ui/htmlTable.js';

const HEAD = ['GALCO', 'Container #', 'LOT#:', 'SEAL#', 'BOOKING#', 'VERITY'];
const ROWS = [
  ['3671', 'MSNU7007075', 'HS03874', 'UL-6611448', 'EBKG15117043', 'CT SSR 23/25'],
  ['3671.01', 'MSNU9690566', 'HS03875', 'UL-6611449', 'EBKG15117043', 'CT SSR 23/25'],
  ['3671.02', 'FFAU1762240', 'HS03876', 'UL-7687051', 'EBKG15117043', 'CT SSR 23/25'],
  ['3671.03', 'TGBU4625141', 'HS03877', 'UL-7687052', 'EBKG15117043', 'CT SSR 23/25'],
  ['3671.04', 'FFAU1945597', 'HS03878', 'UL-7687053', 'EBKG15117043', 'CT SSR 23/25'],
  ['3671.05', 'MSDU7406753', 'HS03879', 'UL-7687054', 'EBKG15117043', 'CT SSR 23/25'],
  ['3671.06', 'MSNU5805374', 'HS03880', 'UL-7687055', 'EBKG15117043', 'CT SSR 23/25'],
  ['3671.07', 'MSMU6012880', 'HS03881', 'UL-7687056', 'EBKG15117043', 'CT SSR 23/25'],
  ['3671.08', 'UETU7107482', 'HS03882', 'UL-7687057', 'EBKG15117043', 'CT SSR 23/25'],
  ['3671.09', 'MEDU7391281', 'HS03883', 'UL-7687058', 'EBKG15117043', 'CT SSR 23/25'],
];

const CONTAINERS = ROWS.map((row) => row[1] as string);
const SEALS = ROWS.map((row) => row[3] as string);

const cell = (tag: string, text: string): string => `<${tag}>${text}</${tag}>`;
/** The message as a mail client puts it on the clipboard: the data table inside a layout table. */
const DOC_CUT_HTML = [
  '<div><table><tr><td>',
  '<p><b>Subject:</b> DOC CUT</p>',
  '<table border="1">',
  `<tr>${HEAD.map((h) => cell('th', h)).join('')}</tr>`,
  ...ROWS.map((row) => `<tr>${row.map((c) => cell('td', c)).join('')}</tr>`),
  '</table>',
  '</td></tr></table></div>',
].join('');

/** The text/plain flavour of that same table: every cell on its own line. */
const FLATTENED = [...HEAD, ...ROWS.flat()].join('\n');

const extracted = (text: string) => {
  const shipment = extractShipment({ kind: 'text', text, name: 'pasted text' });
  return {
    containers: shipment.containers.map((c) => c.containerNumber.normalized ?? c.containerNumber.raw),
    seals: shipment.containers.map((c) => c.shipperSeal?.raw ?? ''),
    shipment,
  };
};

describe('the failure the paste caused', () => {
  it('loses every seal when the rows are flattened to one cell per line', () => {
    const out = extracted(FLATTENED);
    // The containers are still recognised, by shape alone.
    expect(out.containers).toEqual(CONTAINERS);
    // And not one seal, because no container shares a row with one any more.
    expect(out.seals.filter((seal) => seal !== '')).toEqual([]);
  });

  it('reads every seal once the rows are rows again', () => {
    const out = extracted(toTsv([HEAD, ...ROWS]));
    expect(out.containers).toEqual(CONTAINERS);
    expect(out.seals).toEqual(SEALS);
  });
});

describe('reading the table out of the clipboard html', () => {
  it('recovers the rows, and the extractor then finds every seal', () => {
    const pasted = readHtmlClipboard(DOC_CUT_HTML);
    expect(pasted).not.toBeNull();
    const out = extracted(pasted!.text);
    expect(out.containers).toEqual(CONTAINERS);
    expect(out.seals).toEqual(SEALS);
  });

  it('keeps the prose around the table, so the header lines are not thrown away', () => {
    expect(readHtmlClipboard(DOC_CUT_HTML)!.text).toContain('Subject: DOC CUT');
  });

  it('reports the data table and not the layout table wrapped around it', () => {
    const pasted = readHtmlClipboard(DOC_CUT_HTML)!;
    expect(pasted.tables).toEqual([{ rows: 11, columns: 6 }]);
    expect(describeTables(pasted.tables)).toBe('11 rows x 6 columns');
  });

  it('leaves a paste with no data table to the browser', () => {
    expect(readHtmlClipboard('<p>Please see the attached booking confirmation.</p>')).toBeNull();
    // A one-column table is layout, not data.
    expect(readHtmlClipboard('<table><tr><td>a</td></tr><tr><td>b</td></tr></table>')).toBeNull();
  });

  it('keeps a cell that spans columns from shifting the ones below it', () => {
    const table = [
      '<table>',
      '<tr><th>Container</th><th>Seal</th><th>Notes</th></tr>',
      '<tr><td colspan="2">spanned</td><td>tail</td></tr>',
      '</table>',
    ].join('');
    const parsed = new DOMParser().parseFromString(table, 'text/html');
    expect(tableRows(parsed.querySelector('table')!)).toEqual([
      ['Container', 'Seal', 'Notes'],
      ['spanned', '', 'tail'],
    ]);
  });

  it('strips the newlines and tabs inside a cell, which would otherwise split the row', () => {
    const table = '<table><tr><th>Container</th><th>Seal</th></tr><tr><td>MSNU7007075</td><td>UL-6611448\n\tsecond line</td></tr></table>';
    const parsed = new DOMParser().parseFromString(table, 'text/html');
    expect(tableRows(parsed.querySelector('table')!)).toEqual([
      ['Container', 'Seal'],
      ['MSNU7007075', 'UL-6611448 second line'],
    ]);
  });
});

describe('the two columns the container template wants', () => {
  const shipment = extracted(toTsv([HEAD, ...ROWS])).shipment;

  it('emits container and seal, and nothing else', () => {
    expect(formatContainerSealTsv(shipment).split('\r\n')).toEqual(ROWS.map((row) => `${row[1]}\t${row[3]}`));
  });

  it('carries no lot, booking or bookkeeping column into the output', () => {
    const tsv = formatContainerSealTsv(shipment);
    for (const noise of ['HS03874', 'EBKG15117043', 'CT SSR', '3671']) expect(tsv).not.toContain(noise);
  });

  it('gives the two single columns in the same row order', () => {
    expect(formatContainerColumn(shipment).split('\r\n')).toEqual(CONTAINERS);
    expect(formatSealColumn(shipment).split('\r\n')).toEqual(SEALS);
  });

  it('never promotes a carrier seal into an empty shipper seal cell, and counts the rows it left empty', () => {
    const both = extracted(['Container No\tCarrier Seal\tShipper Seal', 'MSNU7007075\tSL-1\t'].join('\n')).shipment;
    expect(formatContainerSealTsv(both)).toBe('MSNU7007075\t');
    expect(carrierSealsOmitted(both)).toBe(1);
    expect(carrierSealsOmitted(shipment)).toBe(0);
  });
});
