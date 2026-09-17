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
import { fillContainerGrid } from '../inttra-extension/src/content/gridWriter.js';
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
