/**
 * INTTRA Helper: page detection, the mapping tables, the field writer, the
 * form filler and the container grid writer, against mock screens.
 *
 * Nothing in the fixtures was captured from the live portal, so these tests
 * prove the mechanics (detection, writing, read-back, refusal to guess),
 * not the selectors. docs/INTTRA-INTEGRATION.md is the live procedure.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { detectInttraPage } from '../inttra-extension/src/content/pageDetector.js';
import { readInttraFieldValue, resolveInttraControl, setInttraFieldValue } from '../inttra-extension/src/content/fieldWriter.js';
import { fillInttraFields, resolvePackageSource } from '../inttra-extension/src/content/filler.js';
import { detectGrid, fillContainerGrid, gridRowsAsTsv, normalizeHeading } from '../inttra-extension/src/content/gridWriter.js';
import { ALL_INTTRA_MAPPINGS, GRID_COLUMNS, inttraFieldsForPage, resolveInttraFields, unverifiedInttraFieldKeys } from '../inttra-extension/src/mappings/index.js';
import { INTTRA_PAGE_SIGNATURES } from '../inttra-extension/src/pages.js';
import { isInttraUrl } from '../inttra-extension/src/ui/tabs.js';
import { parseOverrides } from '../src/ace/selectors/overrides.js';
import { PACKAGE_CONTAINER_FIELDS, PACKAGE_HEADER_FIELDS } from '../shared/src/filingPackage.js';
import { approveDeckhand, buildFilingPackage, type FilingPackage } from '../shared/src/index.js';
import { extractWithRules } from '../deckhand/src/index.js';

const FIXTURES = join(__dirname, 'fixtures');
const html = (name: string): string => readFileSync(join(FIXTURES, `${name}.html`), 'utf8');

function samplePackage(approved = true): FilingPackage {
  const shipment = extractWithRules(readFileSync(join(FIXTURES, 'deckhand', '04-booking-confirmation.txt'), 'utf8'));
  let pkg = buildFilingPackage({ shipment, now: new Date('2026-09-14T00:00:00Z') });
  if (approved) pkg = approveDeckhand(pkg, new Date('2026-09-14T00:00:00Z'));
  return pkg;
}

describe('page detection', () => {
  it('identifies each observed screen from its step strip and heading', () => {
    document.body.innerHTML = html('inttra-general-details');
    const page = detectInttraPage(document);
    expect(page.page).toBe('generalDetails');
    expect(page.confidence).toBe('high');

    document.body.innerHTML = html('inttra-container-grid');
    expect(detectInttraPage(document).page).toBe('copyContainerDetails');
  });

  it('reports unknown with no evidence, and never guesses between equal scores', () => {
    document.body.innerHTML = '<p>Welcome</p>';
    expect(detectInttraPage(document)).toMatchObject({ page: 'unknown', confidence: 'none' });
    document.body.innerHTML = '<h2>General Details</h2><h2>Print Instructions</h2>';
    expect(detectInttraPage(document).page).toBe('unknown');
  });

  it('has a capture hint for every screen', () => {
    for (const signature of INTTRA_PAGE_SIGNATURES) expect(signature.captureHint).toMatch(/DevTools|outerHTML/);
  });
});

describe('mapping tables', () => {
  it('reads only from filing package fields that exist', () => {
    for (const mapping of ALL_INTTRA_MAPPINGS) {
      const [root, field] = mapping.source.split('.');
      if (root === 'header') expect(PACKAGE_HEADER_FIELDS as readonly string[]).toContain(field);
      else if (root === 'container') expect(PACKAGE_CONTAINER_FIELDS as readonly string[]).toContain(field);
      else throw new Error(`unexpected source root in ${mapping.key}: ${mapping.source}`);
    }
    for (const column of GRID_COLUMNS) expect(PACKAGE_CONTAINER_FIELDS as readonly string[]).toContain(column.source);
  });

  it('ships every selector as a placeholder, none marked verified', () => {
    expect(unverifiedInttraFieldKeys()).toEqual(ALL_INTTRA_MAPPINGS.map((mapping) => mapping.key));
    for (const mapping of ALL_INTTRA_MAPPINGS) {
      expect(mapping.verificationStatus).toBe('placeholder');
      expect(mapping.candidates.every((candidate) => candidate.verified === false)).toBe(true);
      expect(mapping.devtoolsHint).toBeTruthy();
    }
  });

  it('keeps keys unique and scopes container fields to the Container & Cargo screen', () => {
    const keys = ALL_INTTRA_MAPPINGS.map((mapping) => mapping.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(inttraFieldsForPage('containerCargo').every((mapping) => mapping.scope === 'container')).toBe(true);
    expect(inttraFieldsForPage('generalDetails').every((mapping) => mapping.scope === 'shipment')).toBe(true);
    expect(inttraFieldsForPage('notificationEmails')).toEqual([]);
    expect(inttraFieldsForPage('unknown')).toEqual([]);
  });

  it('puts a pasted override ahead of the placeholders and marks the field verified', () => {
    const overrides = parseOverrides({ version: 1, fields: { Vessel: [{ strategy: 'id', selector: '#realVesselBox' }] } });
    const vessel = resolveInttraFields('generalDetails', 'shipment', overrides).find((mapping) => mapping.key === 'Vessel');
    expect(vessel?.candidates[0]).toMatchObject({ strategy: 'id', selector: '#realVesselBox', verified: true });
    expect(vessel?.verificationStatus).toBe('verified');
  });
});

describe('setInttraFieldValue', () => {
  beforeEach(() => {
    document.body.innerHTML = html('inttra-general-details');
  });

  it('writes a native input through the native setter, dispatches events, and reads back', () => {
    const input = document.getElementById('vessel') as HTMLInputElement;
    const seen: string[] = [];
    for (const type of ['input', 'change', 'blur', 'focusout', 'keyup']) input.addEventListener(type, () => seen.push(type));
    const result = setInttraFieldValue(input, 'MSC FIRENZE');
    expect(result).toMatchObject({ ok: true, control: 'input', readBack: 'MSC FIRENZE' });
    expect(input.value).toBe('MSC FIRENZE');
    expect(seen).toEqual(expect.arrayContaining(['input', 'change', 'blur', 'focusout', 'keyup']));
  });

  it('matches a dropdown option by value, text or code prefix, and refuses an unknown one', () => {
    const select = document.getElementById('carrier') as HTMLSelectElement;
    expect(setInttraFieldValue(select, 'MAEU')).toMatchObject({ ok: true, control: 'select', selectedText: 'MAEU - Maersk Line' });
    expect(setInttraFieldValue(select, 'MSCU - MSC Mediterranean Shipping Company').ok).toBe(true);
    const refused = setInttraFieldValue(select, 'HLCU');
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/No dropdown option/);
  });

  it('writes a contenteditable cell through textContent', () => {
    document.body.innerHTML = '<div role="gridcell" contenteditable="true"></div>';
    const cell = document.querySelector('[role="gridcell"]') as HTMLElement;
    const seen: string[] = [];
    cell.addEventListener('input', () => seen.push('input'));
    const result = setInttraFieldValue(cell, 'MSCU1234566');
    expect(result).toMatchObject({ ok: true, control: 'contenteditable', readBack: 'MSCU1234566' });
    expect(seen).toContain('input');
    expect(readInttraFieldValue(cell)).toBe('MSCU1234566');
  });

  it('resolves the single input inside a grid cell', () => {
    document.body.innerHTML = '<table><tr><td><input type="text" /></td></tr></table>';
    const cell = document.querySelector('td') as HTMLElement;
    expect(resolveInttraControl(cell).kind).toBe('input');
    expect(setInttraFieldValue(cell, 'SL-1')).toMatchObject({ ok: true, control: 'input' });
  });

  it('reports a cell with no control, a disabled control, and a reverted value as failures', () => {
    document.body.innerHTML = '<td>static text</td><input id="off" disabled />';
    expect(setInttraFieldValue(document.querySelector('td'), 'x')).toMatchObject({ ok: false, control: 'none' });
    expect(setInttraFieldValue(document.getElementById('off'), 'x')).toMatchObject({ ok: false, control: 'input' });

    document.body.innerHTML = '<input id="stubborn" />';
    const stubborn = document.getElementById('stubborn') as HTMLInputElement;
    stubborn.addEventListener('change', () => {
      stubborn.value = 'REVERTED';
    });
    const result = setInttraFieldValue(stubborn, 'WANTED');
    expect(result.ok).toBe(false);
    expect(result.readBack).toBe('REVERTED');
    expect(result.reason).toMatch(/did not keep/);
  });

  it('never throws', () => {
    expect(setInttraFieldValue(null, 'x').ok).toBe(false);
  });
});

describe('fillInttraFields', () => {
  beforeEach(() => {
    document.body.innerHTML = html('inttra-general-details');
  });

  it('fills General Details from the package, with provenance on every outcome', () => {
    const pkg = samplePackage();
    const report = fillInttraFields({ pkg, page: 'generalDetails', scope: 'shipment' }, document);
    expect(report.errors).toBe(0);
    const value = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;
    expect(value('bookingNumber')).toBe('EBKG18531408');
    expect(value('vessel')).toBe('MSC FIRENZE');
    expect(value('voyage')).toBe('541W');
    expect(value('portOfLoading')).toBe('Los Angeles, CA');
    expect(value('portOfDischarge')).toBe('Derince');
    const booking = report.outcomes.find((outcome) => outcome.key === 'BookingNumber');
    expect(booking?.provenance).toContain('Deckhand');
    expect(booking?.readBack).toBe('EBKG18531408');
    // No commercial data: the carrier is skipped, never invented.
    expect(report.outcomes.find((outcome) => outcome.key === 'Carrier')?.status).toBe('skipped');
  });

  it('warns rather than overwrites an existing different value, unless told to', () => {
    const pkg = samplePackage();
    (document.getElementById('vessel') as HTMLInputElement).value = 'OTHER SHIP';
    const report = fillInttraFields({ pkg, page: 'generalDetails', scope: 'shipment' }, document);
    expect(report.outcomes.find((outcome) => outcome.key === 'Vessel')).toMatchObject({ status: 'warning', readBack: 'OTHER SHIP' });
    expect((document.getElementById('vessel') as HTMLInputElement).value).toBe('OTHER SHIP');
    fillInttraFields({ pkg, page: 'generalDetails', scope: 'shipment', overwrite: true }, document);
    expect((document.getElementById('vessel') as HTMLInputElement).value).toBe('MSC FIRENZE');
  });

  it('writes nothing on a dry run and nothing when a field is not found', () => {
    const pkg = samplePackage();
    const dry = fillInttraFields({ pkg, page: 'generalDetails', scope: 'shipment', dryRun: true }, document);
    expect(dry.filled).toBeGreaterThan(0);
    expect((document.getElementById('bookingNumber') as HTMLInputElement).value).toBe('');

    document.body.innerHTML = '<h2>General Details</h2>';
    const none = fillInttraFields({ pkg, page: 'generalDetails', scope: 'shipment' }, document);
    expect(none.filled).toBe(0);
    expect(none.outcomes.every((outcome) => outcome.status === 'warning' || outcome.status === 'skipped')).toBe(true);
    expect(none.outcomes.find((outcome) => outcome.key === 'BookingNumber')?.message).toMatch(/placeholders/);
  });

  it('never presses Save, Continue or Submit', () => {
    const pkg = samplePackage();
    let clicked = false;
    for (const id of ['saveContinue', 'submitSi']) document.getElementById(id)?.addEventListener('click', () => (clicked = true));
    document.querySelector('form')?.addEventListener('submit', () => (clicked = true));
    fillInttraFields({ pkg, page: 'generalDetails', scope: 'shipment' }, document);
    expect(clicked).toBe(false);
  });

  it('reads container fields from the selected container', () => {
    const pkg = samplePackage();
    expect(resolvePackageSource('container.carrierSeal', pkg, pkg.containers[1] ?? null)?.value).toBe('SL-4471210');
    expect(resolvePackageSource('container.containerNumber', pkg, pkg.containers[0] ?? null)?.value).toBe('MSCU1234566');
    expect(resolvePackageSource('nowhere.x', pkg, null)).toBeNull();
    const report = fillInttraFields({ pkg, page: 'containerCargo', scope: 'container', containerIndex: 7 }, document);
    expect(report.errors).toBe(1);
  });
});

describe('the container grid', () => {
  it('identifies columns by heading text, not by position', () => {
    document.body.innerHTML = html('inttra-container-grid');
    const detection = detectGrid(document);
    expect(detection.found).toBe(true);
    expect(detection.kind).toBe('table');
    expect(detection.rowCount).toBe(2);
    expect(detection.headers.map((header) => header.column)).toEqual([
      'ContainerNumber', 'CarrierSeal', 'ShipperSeal', 'CargoDescription', 'MarksAndNumbers', 'HsCode', 'PackageType', 'PackageCount', 'GrossWeight', null,
    ]);
    expect(detection.missingColumns).toEqual([]);
    expect(normalizeHeading('Carrier Seal # *')).toBe('carrierseal');
  });

  it('writes one row per container, container and seals together, and verifies every cell', () => {
    document.body.innerHTML = html('inttra-container-grid');
    const pkg = samplePackage();
    // Three containers, two rows: the third is reported, not squeezed in.
    const report = fillContainerGrid(pkg, { doc: document });
    expect(report.rowsNeeded).toBe(3);
    expect(report.rowsAvailable).toBe(2);
    expect(report.containersFilled).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.messages.some((message) => /Add 1 row/.test(message))).toBe(true);

    const cell = (row: number, name: string): string => (document.querySelector(`[name="rows[${row}].${name}"]`) as HTMLInputElement).value;
    expect(cell(0, 'containerNumber')).toBe('MSCU1234566');
    expect(cell(0, 'carrierSeal')).toBe('SL-4471209');
    expect(cell(0, 'shipperSeal')).toBe('SH-001');
    expect(cell(1, 'containerNumber')).toBe('MSDU7654322');
    expect(cell(1, 'carrierSeal')).toBe('SL-4471210');
    expect(cell(1, 'shipperSeal')).toBe('');
    // Nothing in the package for these: skipped, never invented.
    expect(cell(0, 'packageCount')).toBe('');
    expect(cell(0, 'remarks')).toBe('');

    const verified = report.cells.filter((item) => item.status === 'verified');
    expect(verified.length).toBe(report.verifiedCells);
    expect(verified.map((item) => `${item.row}:${item.column}`)).toEqual(['1:ContainerNumber', '1:CarrierSeal', '1:ShipperSeal', '2:ContainerNumber', '2:CarrierSeal']);
    expect(report.cells.find((item) => item.row === 1 && item.column === 'PackageType')?.status).toBe('skipped');
  });

  it('fills an ARIA grid with contenteditable cells the same way', () => {
    document.body.innerHTML = html('inttra-container-grid-aria');
    const pkg = samplePackage();
    const report = fillContainerGrid(pkg, { doc: document });
    expect(report.detection.kind).toBe('ariaGrid');
    expect(report.containersFilled).toBe(3);
    expect(report.failed).toBe(0);
    const rows = Array.from(document.querySelectorAll('[role="row"]')).slice(1);
    expect(rows[2]?.children[0]?.textContent).toBe('TGHU7654320');
    // The document heads this container's seal just "Seal:", so it lands in
    // Shipper Seal # (column 2), not Carrier Seal # (column 1).
    expect(rows[2]?.children[1]?.textContent).toBe('');
    expect(rows[2]?.children[2]?.textContent).toBe('SL-9');
  });

  it('marks a cell failed when the read-back disagrees, and reports it', () => {
    document.body.innerHTML = html('inttra-container-grid');
    const stubborn = document.querySelector('[name="rows[0].carrierSeal"]') as HTMLInputElement;
    stubborn.addEventListener('change', () => {
      stubborn.value = 'NOPE';
    });
    const report = fillContainerGrid(samplePackage(), { doc: document });
    const cell = report.cells.find((item) => item.row === 1 && item.column === 'CarrierSeal');
    expect(cell?.status).toBe('failed');
    expect(cell?.actual).toBe('NOPE');
    expect(report.failed).toBe(1);
  });

  it('reports a cell it cannot write as unresolved rather than clicking anything', () => {
    document.body.innerHTML = html('inttra-container-grid').replace('<td><input type="text" name="rows[0].containerNumber" /></td>', '<td><span>click to edit</span></td>');
    const report = fillContainerGrid(samplePackage(), { doc: document });
    const cell = report.cells.find((item) => item.row === 1 && item.column === 'ContainerNumber');
    expect(cell?.status).toBe('unresolved');
    expect(report.unresolved).toBe(1);
  });

  it('never presses Add Row, and leaves existing different values alone unless told to overwrite', () => {
    document.body.innerHTML = html('inttra-container-grid');
    let clicked = false;
    document.getElementById('addRow')?.addEventListener('click', () => (clicked = true));
    (document.querySelector('[name="rows[0].containerNumber"]') as HTMLInputElement).value = 'OLDU0000000';
    const report = fillContainerGrid(samplePackage(), { doc: document });
    expect(clicked).toBe(false);
    expect(report.cells.find((item) => item.row === 1 && item.column === 'ContainerNumber')?.status).toBe('warning');
    expect((document.querySelector('[name="rows[0].containerNumber"]') as HTMLInputElement).value).toBe('OLDU0000000');
  });

  it('writes nothing on a dry run, and says when there is no grid', () => {
    document.body.innerHTML = html('inttra-container-grid');
    const dry = fillContainerGrid(samplePackage(), { doc: document, dryRun: true });
    expect(dry.cells.some((item) => item.status === 'dry-run')).toBe(true);
    expect((document.querySelector('[name="rows[0].containerNumber"]') as HTMLInputElement).value).toBe('');

    document.body.innerHTML = '<h2>Copy Container Details</h2>';
    const none = fillContainerGrid(samplePackage(), { doc: document });
    expect(none.detection.found).toBe(false);
    expect(none.messages[0]).toMatch(/No container grid/);
  });

  it('copies the rows as TSV in the grid\'s own column order', () => {
    document.body.innerHTML = html('inttra-container-grid-aria');
    const pkg = samplePackage();
    const tsv = gridRowsAsTsv(pkg, detectGrid(document));
    expect(tsv.split('\r\n')[0]).toBe('MSCU1234566\tSL-4471209\tSH-001\t\t');
    expect(tsv.split('\r\n')).toHaveLength(3);
    expect(gridRowsAsTsv(pkg, null).split('\r\n')[0]?.split('\t')).toHaveLength(GRID_COLUMNS.length);
  });
});

describe('hosts', () => {
  it('addresses only INTTRA and e2open tabs over https', () => {
    expect(isInttraUrl('https://www.inttra.com/si/general')).toBe(true);
    expect(isInttraUrl('https://portal.e2open.com/x')).toBe(true);
    expect(isInttraUrl('http://www.inttra.com/')).toBe(false);
    expect(isInttraUrl('https://ace.cbp.dhs.gov/')).toBe(false);
    expect(isInttraUrl('https://inttra.com.evil.example/')).toBe(false);
  });
});
