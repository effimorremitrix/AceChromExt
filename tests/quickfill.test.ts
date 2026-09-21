/**
 * Quickfill: one paste, both portals, nothing in the way.
 *
 * The other end-to-end tests prove the careful path - extract, review, approve,
 * build, resolve, gate, fill. This one proves the fast path: whatever is in the
 * box becomes a package and a canonical shipment in one call, and the same
 * fixtures fill the same forms without an approval, a conflict screen or a gate
 * in between.
 *
 * It also pins the two places where Quickfill is deliberately less careful than
 * the ACE Helper, so neither can be lost by accident and neither can creep into
 * the ACE Helper:
 *
 *   - a container number that fails its ISO 6346 check digit is still filled;
 *   - a disagreement between the invoice and the email is resolved in the
 *     email's favour, silently.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { autoResolve, isFailure, parsePaste, splitRows, type Parsed } from '../quickfill-extension/src/paste.js';
import { aceShipmentFrom } from '../quickfill-extension/src/aceShipment.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { detectPage } from '../src/content/pageDetector.js';
import { fillFields } from '../src/content/filler.js';
import { detectInttraPage } from '../inttra-extension/src/content/pageDetector.js';
import { fillInttraFields } from '../inttra-extension/src/content/filler.js';
import { detectGrid, fillContainerGrid, gridRowsAsTsv } from '../inttra-extension/src/content/gridWriter.js';
import { buildFilingPackage } from '../shared/src/builder.js';
import { serializeFilingPackage } from '../shared/src/serialize.js';
import { extractShipment } from '../deckhand/src/extractor.js';
import { serializeDeckhandShipment } from '../deckhand/src/serialize.js';
import { aceShipmentFromPackage } from '../shared/src/aceView.js';

const FIXTURES = join(__dirname, 'fixtures');
const html = (name: string): string => readFileSync(join(FIXTURES, `${name}.html`), 'utf8');
const email = (name: string): string => readFileSync(join(FIXTURES, 'deckhand', `${name}.txt`), 'utf8');
const NOW = new Date('2026-09-17T09:00:00Z');

const ROWS = ['InvoiceNumber\tScheduleB\tDescription\tQuantity1\tUOM1\tValueOfGoods\tShippingWeight', 'CN-1042\t0802.12.0000\tAlmond Kernels\t400\tKG\t651217.60\t79832'].join('\n');
/** The same rows, but the invoice names a booking the carrier's email contradicts. */
const CONFLICTING_ROWS = ROWS.replace('InvoiceNumber\t', 'InvoiceNumber\tBookingNumber\t').replace('CN-1042\t', 'CN-1042\tEBKG-WRONG-0001\t');

function parsed(text: string): Parsed {
  const result = parsePaste(text, NOW);
  if (isFailure(result)) throw new Error(result.error);
  return result;
}

describe('the box reads whatever is in it', () => {
  it('refuses an empty box, and says so in one sentence', () => {
    const result = parsePaste('   ');
    expect(isFailure(result) && result.error).toBe('Paste the email, the package, or the rows first.');
  });

  it('counts no cargo line for an email with no commercial data', () => {
    // The package always carries an invoice half so nothing downstream has to
    // handle a null one; the placeholder commodity inside it is not a line and
    // must never be announced as one.
    expect(parsed(email('04-booking-confirmation')).summary).not.toContain('line');
  });

  it('reads a carrier email', () => {
    const result = parsed(email('04-booking-confirmation'));
    expect(result.kind).toBe('email');
    expect(result.pkg.header.bookingReference.value).toBe('EBKG18531408');
    expect(result.pkg.header.vessel.value).toBe('MSC FIRENZE');
    expect(result.pkg.containers.map((container) => container.containerNumber.value)).toEqual(['MSCU1234566', 'MSDU7654322', 'TGHU7654320']);
    expect(result.summary).toContain('carrier email');
    expect(result.summary).toContain('EBKG18531408');
    expect(result.summary).toContain('3 containers');
  });

  it('reads a filing package', () => {
    const source = parsed(email('04-booking-confirmation'));
    const result = parsed(serializeFilingPackage(source.pkg));
    expect(result.kind).toBe('package');
    expect(result.pkg.header.bookingReference.value).toBe('EBKG18531408');
    expect(result.pkg.containers).toHaveLength(3);
  });

  it('reads a saved Deckhand extraction', () => {
    const shipment = extractShipment({ kind: 'text', text: email('04-booking-confirmation'), name: 'booking' });
    const result = parsed(serializeDeckhandShipment(shipment));
    expect(result.kind).toBe('deckhand');
    expect(result.pkg.header.bookingReference.value).toBe('EBKG18531408');
  });

  it('reads tab-separated spreadsheet rows', () => {
    const result = parsed(ROWS);
    expect(result.kind).toBe('rows');
    expect(result.ace.invoice.invoiceNumber).toBe('CN-1042');
    expect(result.ace.commodities[0]?.scheduleB).toBe('0802.12.0000');
    expect(result.summary).toBe('spreadsheet rows \u00b7 1 line');
  });

  it('splits commas when there are no tabs, and strips the quotes', () => {
    expect(splitRows('a,b,c\n"1","2","3"')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('never approves in the other direction: a package with no Deckhand half stays not-applicable', () => {
    const rows = ['InvoiceNumber\tDescription', 'CN-1042\tAlmond Kernels'].join('\n');
    expect(parsed(rows).pkg.review.deckhand).toBe('not-applicable');
  });

  it('approves the Deckhand half on arrival, with no Approve click', () => {
    expect(parsed(email('04-booking-confirmation')).pkg.review.deckhand).toBe('approved');
  });
});

describe('what Quickfill drops, on purpose', () => {
  it('fills a container number that fails its ISO 6346 check digit', () => {
    // 03-bad-check-digit.txt is the fixture the ACE Helper refuses to fill from:
    // fillGate() blocks on it and aceShipmentFromPackage drops the overlay.
    const result = parsed(email('03-bad-check-digit'));
    const container = result.pkg.containers[0];
    expect(container?.status).toBe('invalid');
    expect(result.ace.invoice.containerNumber).toBe('TGHU7654321');
    expect(result.ace.invoice.sealNumber).toBe('SL-1');

    // The same package through the ACE Helper's gated view: the overlay is
    // dropped and a note says why. Both behaviours must keep existing.
    const gated = aceShipmentFromPackage(result.pkg);
    expect(gated.shipment.invoice.containerNumber).toBe('');
    expect(gated.notes.some((note) => /not applied/.test(note.message))).toBe(true);
  });

  it('resolves a disagreement in the email’s favour instead of blocking', () => {
    const shipment = extractShipment({ kind: 'text', text: email('04-booking-confirmation'), name: 'booking' });
    const invoice = parsed(CONFLICTING_ROWS).ace;
    const conflicted = buildFilingPackage({ invoice, shipment, deckhandApproved: true, now: NOW });
    expect(conflicted.conflicts.some((conflict) => conflict.resolution === 'unresolved')).toBe(true);

    const decisions = autoResolve(conflicted);
    expect(Object.values(decisions.resolutions).every((choice) => choice === 'deckhand')).toBe(true);

    // And through the box, in one call: no unresolved conflict survives.
    const result = parsed(CONFLICTING_ROWS);
    expect(result.pkg.conflicts.filter((conflict) => conflict.resolution === 'unresolved')).toEqual([]);
  });

  it('leaves ACE’s single container field alone when the email names several', () => {
    // Choosing one of three would be a guess, and a guess is the one thing
    // Quickfill still refuses to make.
    const result = parsed(email('04-booking-confirmation'));
    expect(result.pkg.containers).toHaveLength(3);
    expect(result.ace.invoice.containerNumber).toBe('');
  });

  it('carries no shipment reference, because the running counter is not part of this extension', () => {
    expect(parsed(email('04-booking-confirmation')).ace.invoice.invoiceNumber).toBe('');
  });
});

describe('the first live paste, 2026-09-17', () => {
  // The container manifest the office actually works from, as pasted into
  // Quickfill on the live INTTRA portal. It is tabular, so the ladder sent it
  // to the invoice reader, which correctly reported no commodity rows - and
  // the paste was thrown away. Deckhand reads this exact shape.
  const MANIFEST = [
    ['GALCO', 'Container #', 'LOT#:', 'SEAL#', 'BOOKING#', 'VARIETY', 'CONSIGNEE'],
    ['3994', 'TLLU7564971', 'PK00181', 'UL-8546727', 'EBKG18531463', 'CA STD 5%', 'Aydin Kuruyemis'],
    ['4000', 'TGBU7182073', 'PK00183', 'UL-8546730', 'EBKG18531463', 'CT18/20 SSR', 'Aydin Kuruyemis'],
    ['4000.01', 'MSDU7542282', 'PK00190', 'UL-8546728', 'EBKG18531463', 'CT18/20 SSR', 'Aydin Kuruyemis'],
    ['3999', 'UETU7528305', 'PK00182', 'UL-8546729', 'EBKG18592770', 'CT18/20HS #1', 'Aydin Kuruyemis'],
  ].map((row) => row.join('\t')).join('\n');

  it('reads a container manifest that is not an invoice', () => {
    const result = parsed(MANIFEST);
    expect(result.kind).toBe('containers');
    expect(result.pkg.containers.map((container) => container.containerNumber.value)).toEqual([
      'TLLU7564971',
      'TGBU7182073',
      'MSDU7542282',
      'UETU7528305',
    ]);
  });

  it('keeps each seal with its own container', () => {
    // The whole reason Deckhand exists. The SEAL# column is unattributed, so
    // it is the shipper's, which is the column the INTTRA grid wants.
    const result = parsed(MANIFEST);
    expect(result.pkg.containers.map((container) => container.shipperSeal.value)).toEqual([
      'UL-8546727',
      'UL-8546730',
      'UL-8546728',
      'UL-8546729',
    ]);
    expect(result.pkg.containers.every((container) => container.status === 'valid')).toBe(true);
  });

  it('says what it read, in one line, seals included', () => {
    expect(parsed(MANIFEST).summary).toBe('container table \u00b7 4 containers \u00b7 4 with a seal');
  });

  it('counts the containers that carry a seal, so a manifest read without its seals says so', () => {
    // A count, not a check: the line changes, nothing is gated. Eleven
    // containers with no seal beside them must not read like eleven with.
    const withoutSeals = MANIFEST.split('\n')
      .map((line) => line.split('\t').filter((_cell, index) => index !== 3).join('\t'))
      .join('\n');
    const result = parsed(withoutSeals);
    expect(result.pkg.containers).toHaveLength(4);
    expect(result.summary).toBe('container table \u00b7 4 containers \u00b7 0 with a seal');
    expect(parsed(email('04-booking-confirmation')).summary).toContain('3 with a seal');
  });

  it('claims no booking when the table spans two of them', () => {
    // This manifest carries EBKG18531463 on three rows and EBKG18592770 on the
    // fourth. A shipping instruction is per booking, so picking one would be a
    // guess about which containers belong to this filing - and not guessing is
    // the one thing Quickfill kept. The operator sees "4 containers" with no
    // booking and splits the paste themselves.
    expect(parsed(MANIFEST).pkg.header.bookingReference.value).toBe('');
  });

  it('fills the container grid from it', () => {
    document.body.innerHTML = html('inttra-container-grid-aria');
    const report = fillContainerGrid(parsed(MANIFEST).pkg, { doc: document, overwrite: true });
    expect(report.rowsNeeded).toBe(4);
    expect(report.failed).toBe(0);
    expect(report.containersFilled).toBeGreaterThan(0);
  });

  it('produces paste-ready rows in the live grid\u2019s own column order', () => {
    // The live grid refuses cell writes (it opens an editor on click), so the
    // way in is the one the screen is named after: paste a block. The column
    // order must be the grid's, not GRID_COLUMNS', or every value lands one
    // column out.
    document.body.innerHTML = [
      '<table><tr>',
      '<th>Container Number</th><th>Shipper Seal #</th><th>Carrier Seal #</th>',
      '</tr><tr><td></td><td></td><td></td></tr></table>',
    ].join('');
    const result = parsed(MANIFEST);
    const tsv = gridRowsAsTsv(result.pkg, detectGrid(document));
    const first = tsv.split('\r\n')[0]?.split('\t') ?? [];
    // Container, then SHIPPER seal, then carrier - the screen's order, which is
    // not the order GRID_COLUMNS declares.
    expect(first[0]).toBe('TLLU7564971');
    expect(first[1]).toBe('UL-8546727');
    expect(tsv.split('\r\n')).toHaveLength(4);
  });

  it('still prefers the invoice reader when the rows really are an invoice', () => {
    // The fallthrough must not swallow the rows branch.
    expect(parsed(ROWS).kind).toBe('rows');
  });

  it('reports the invoice reader\u2019s message when neither can read the paste', () => {
    const nonsense = ['alpha\tbeta\tgamma', 'one\ttwo\tthree'].join('\n');
    const result = parsePaste(nonsense, NOW);
    expect(isFailure(result)).toBe(true);
  });
});

describe('one paste fills ACE', () => {
  it('fills the Transportation step from the email alone', () => {
    document.body.innerHTML = html('ace-transportation');
    const result = parsed(email('04-booking-confirmation'));
    expect(detectPage(document).page).toBe('transportation');
    const report = fillFields({ shipment: result.ace, page: 'transportation', scope: 'shipment', settings: DEFAULT_SETTINGS, overwrite: true }, document);
    const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;
    expect(value('refNbrValue')).toBe('EBKG18531408');
    expect(value('shipmentInfo.conveyanceName.stringField')).toBe('MSC FIRENZE');
    expect(report.filled).toBeGreaterThan(0);
  });

  it('fills a Commodities line from pasted rows', () => {
    document.body.innerHTML = html('ace-commodities');
    const result = parsed(ROWS);
    const report = fillFields({ shipment: result.ace, page: 'commodities', scope: 'commodityLine', line: 1, settings: DEFAULT_SETTINGS, overwrite: true }, document);
    expect(report.errors).toBe(0);
    const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;
    expect(value('scheduleBNumber')).toBe('0802.12.0000');
    expect(value('commodityLines[0].shipmentWeight.stringField')).toBe('79832');
  });

  it('overwrites a stale value instead of warning about it', () => {
    document.body.innerHTML = html('ace-transportation');
    const field = document.getElementById('refNbrValue') as HTMLInputElement;
    field.value = 'AN-OLD-BOOKING';
    const result = parsed(email('04-booking-confirmation'));
    fillFields({ shipment: result.ace, page: 'transportation', scope: 'shipment', settings: DEFAULT_SETTINGS, overwrite: true }, document);
    expect(field.value).toBe('EBKG18531408');
  });
});

describe('the same paste fills INTTRA', () => {
  it('fills General Details', () => {
    document.body.innerHTML = html('inttra-general-details');
    const result = parsed(email('04-booking-confirmation'));
    expect(detectInttraPage(document).page).toBe('generalDetails');
    const report = fillInttraFields({ pkg: result.pkg, page: 'generalDetails', scope: 'shipment', overwrite: true }, document);
    const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;
    expect(value('bookingNumber')).toBe('EBKG18531408');
    expect(value('vessel')).toBe('MSC FIRENZE');
    expect(value('voyage')).toBe('541W');
    expect(report.filled).toBeGreaterThan(0);
  });

  it('fills the container grid', () => {
    document.body.innerHTML = html('inttra-container-grid-aria');
    const result = parsed(email('04-booking-confirmation'));
    const report = fillContainerGrid(result.pkg, { doc: document, overwrite: true });
    expect(report.rowsNeeded).toBe(3);
    expect(report.containersFilled).toBe(3);
    expect(report.failed).toBe(0);
  });

  /**
   * The two live page types, from one pasted email.
   *
   * This is the claim in the plainest form there is: the operator pastes the
   * carrier's booking confirmation into the one box, and the same paste fills
   * the per-container Particulars blocks on the create page AND produces the
   * block for the Copy Container Details grid - on the SAME document, because
   * on the live portal the grid is a modal drawn over the create page.
   */
  it('fills every container block on the create page, and the grid block, from one email', () => {
    document.body.innerHTML = html('inttra-create-si').replace('id="si-create"', 'id="generalDetails"') + html('inttra-div-grid');
    const result = parsed(email('04-booking-confirmation'));
    expect(result.kind).toBe('email');
    expect(result.pkg.containers).toHaveLength(3);

    // The detector names the create page here, not the grid: the marker
    // `#generalDetails` is visible and worth 10, plus its heading and URL,
    // against the grid's 10. Both routes have to exist on this one answer.
    expect(detectInttraPage(document).page).toBe('generalDetails');
    expect(detectGrid(document).found).toBe(true);

    const report = fillInttraFields({ pkg: result.pkg, page: 'generalDetails', scope: 'container', containerIndex: 0, overwrite: true }, document);
    expect(report.filled).toBeGreaterThan(0);
    const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;
    expect(value('cont-num-1')).toBe('MSCU1234566');
    expect(value('carr-seal-1')).toBe('SL-4471209');
    expect(value('ship-seal-1')).toBe('SH-001');

    // ...and the grid block for the modal over it, cut to the grid's own
    // columns, three rows for three containers.
    const tsv = gridRowsAsTsv(result.pkg, detectGrid(document));
    expect(tsv.split('\r\n')).toHaveLength(3);
    expect(tsv.split('\r\n')[0]?.split('\t')[0]).toBe('MSCU1234566');
  });

  it('still refuses to press Add Row when the grid is short of rows', () => {
    // The table fixture has two editable rows for three containers. Quickfill
    // fills the two and stops: dropping the checks did not buy it the right to
    // press a button in the portal.
    document.body.innerHTML = html('inttra-container-grid');
    const result = parsed(email('04-booking-confirmation'));
    const report = fillContainerGrid(result.pkg, { doc: document, overwrite: true });
    expect(report.rowsNeeded).toBe(3);
    expect(report.containersFilled).toBe(2);
  });
});

describe('aceShipmentFrom', () => {
  it('returns an empty shipment rather than throwing when the package has no invoice', () => {
    const shipment = extractShipment({ kind: 'text', text: email('04-booking-confirmation'), name: 'booking' });
    const pkg = buildFilingPackage({ shipment, deckhandApproved: true, now: NOW });
    expect(pkg.invoice).toBeNull();
    expect(() => aceShipmentFromPackage(pkg)).toThrow();
    const ace = aceShipmentFrom(pkg);
    expect(ace.invoice.bookingNumber).toBe('EBKG18531408');
    expect(ace.commodities).toHaveLength(1);
  });
});
