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

import { detectInttraPage, EVIDENCE, hasStructuralEvidence } from '../inttra-extension/src/content/pageDetector.js';
import { isInttraVisible, readInttraFieldValue, resolveInttraControl, setInttraFieldValue } from '../inttra-extension/src/content/fieldWriter.js';
import { fillInttraFields, mappingsForRow, resolvePackageSource } from '../inttra-extension/src/content/filler.js';
import { detectField } from '../src/content/fieldDetector.js';
import { detectGrid, fillContainerGrid, findContainerGrid, findHeaderRowByText, gridAcceptsTyping, gridPasteBlock, gridRowsAsTsv, normalizeHeading, readHeaderCell } from '../inttra-extension/src/content/gridWriter.js';
import { probeStructure } from '../inttra-extension/src/content/structureProbe.js';
import { ALL_INTTRA_MAPPINGS, GRID_COLUMNS, inttraFieldsForPage, resolveInttraFields, unverifiedInttraFieldKeys } from '../inttra-extension/src/mappings/index.js';
import { INTTRA_PAGE_SIGNATURES } from '../inttra-extension/src/pages.js';
import { isInttraUrl } from '../inttra-extension/src/ui/tabs.js';
import { parseOverrides } from '../src/ace/selectors/overrides.js';
import { PACKAGE_CONTAINER_FIELDS, PACKAGE_HEADER_FIELDS } from '../shared/src/filingPackage.js';
import { approveDeckhand, buildFilingPackage, setManualContainer, type FilingPackage } from '../shared/src/index.js';
import { extractWithRules } from '../deckhand/src/index.js';

const FIXTURES = join(__dirname, 'fixtures');
const html = (name: string): string => readFileSync(join(FIXTURES, `${name}.html`), 'utf8');

function samplePackage(approved = true): FilingPackage {
  const shipment = extractWithRules(readFileSync(join(FIXTURES, 'deckhand', '04-booking-confirmation.txt'), 'utf8'));
  let pkg = buildFilingPackage({ shipment, now: new Date('2026-09-14T00:00:00Z') });
  if (approved) pkg = approveDeckhand(pkg, new Date('2026-09-14T00:00:00Z'));
  return pkg;
}

/**
 * The live workspace, 2026-09-17: a modal grid among other tables.
 *
 * ship.inttra.e2open.com draws Copy Container Details as a modal over a
 * workspace that has tables of its own, and none of the guessed ids or
 * attributes are there. Every rung of GRID_ROOT_CANDIDATES therefore fails -
 * the last-resort `table` matches several, and "exactly one" rejects it - so
 * the page's only real grid went undetected and the popup offered to fill the
 * step behind the modal instead.
 */
describe('finding the grid among other tables', () => {
  const OTHER_TABLE = '<table><tr><th>Booking</th><th>Status</th></tr><tr><td>EBKG1</td><td>Draft</td></tr></table>';
  const GRID = [
    '<table><tr>',
    '<th>Container Number</th><th>Carrier Seal #</th><th>Shipper Seal #</th><th>HS Code</th>',
    '</tr><tr>',
    '<td><input name="r0.c" /></td><td><input name="r0.cs" /></td><td><input name="r0.ss" /></td><td><input name="r0.hs" /></td>',
    '</tr></table>',
  ].join('');

  it('was not found before, because more than one table matched', async () => {
    const { GRID_ROOT_CANDIDATES } = await import('../inttra-extension/src/mappings/containerGrid.js');
    document.body.innerHTML = `${OTHER_TABLE}<div role="dialog">${GRID}</div>`;
    // The old last resort: exactly one <table> on the page. There are two.
    expect(GRID_ROOT_CANDIDATES[GRID_ROOT_CANDIDATES.length - 1]?.selector).toBe('table');
    expect(document.querySelectorAll('table')).toHaveLength(2);
  });

  it('picks the table whose headings say it is a container grid', () => {
    document.body.innerHTML = `${OTHER_TABLE}<div role="dialog">${GRID}</div>`;
    const detection = detectGrid(document);
    expect(detection.found).toBe(true);
    expect(detection.matchedWith).toContain('headings');
    expect(detection.headers.filter((header) => header.column !== null).map((header) => header.column)).toEqual([
      'ContainerNumber',
      'CarrierSeal',
      'ShipperSeal',
      'HsCode',
    ]);
  });

  it('fills that grid, and leaves the other table alone', () => {
    document.body.innerHTML = `${OTHER_TABLE}<div role="dialog">${GRID}</div>`;
    const before = (document.querySelectorAll('table')[0] as HTMLElement).innerHTML;
    const report = fillContainerGrid(samplePackage(), { doc: document, overwrite: true });
    expect(report.failed).toBe(0);
    expect(report.containersFilled).toBeGreaterThan(0);
    expect((document.querySelector('input[name="r0.c"]') as HTMLInputElement).value).not.toBe('');
    expect((document.querySelectorAll('table')[0] as HTMLElement).innerHTML).toBe(before);
  });

  it('finds the grid by the captured wrapper id, among other tables', () => {
    // The real modal, as captured from the live DOM on 2026-09-17:
    //   <div id="siCopyContainerWrapperDiv" class="preLoaderWrapper">
    //     <div class="preLoaderMask" ...><div class="preLoader" ...>
    //     <div class="row"> ... bootstrap columns ...
    //     <div id="editableGridWrapper" class="col-sm-12 pushdown10"> [grid]
    //     <div class="modal-footer">
    document.body.innerHTML = [
      OTHER_TABLE,
      '<div id="siCopyContainerWrapperDiv" class="preLoaderWrapper">',
      '<div class="preLoaderMask" id="preLoaderMaskSiCopyContainer" style="display: none;"></div>',
      '<div class="preLoader" id="preLoaderSiCopyContainer" style="display: none;"></div>',
      '<div class="row"><div class="col-sm-7"><div class="row row-5-gutter">',
      '<div class="col-sm-7 col-5-gutter"></div><div class="col-sm-5 col-5-gutter"></div>',
      '</div></div>',
      `<div id="editableGridWrapper" class="col-sm-12 pushdown10">${GRID}</div>`,
      '<div class="modal-footer"></div>',
      '</div>',
    ].join('');
    const detection = detectGrid(document);
    expect(detection.found).toBe(true);
    expect(detection.matchedWith).toContain('editableGridWrapper');
    expect(detection.root?.closest('#editableGridWrapper')).not.toBeNull();
  });

  it('identifies the screen by the captured modal id, not the tab behind it', () => {
    // The step strip still names the step the modal covers; the modal's own id
    // is what says which screen this is.
    document.body.innerHTML = [
      '<nav><a class="nav-link active">B/L Documents</a></nav>',
      '<div id="siCopyContainerWrapperDiv"></div>',
    ].join('');
    const page = detectInttraPage(document);
    expect(page.page).toBe('copyContainerDetails');
    expect(page.confidence).toBe('high');
  });

  it('says a grid with inputs can be typed into', () => {
    document.body.innerHTML = `<div role="dialog">${GRID}</div>`;
    expect(gridAcceptsTyping(document)).toBe(true);
  });

  it('says a click-to-edit grid cannot', () => {
    // The live portal, 2026-09-17: the cells hold no control until clicked, so
    // Fill can never write one value into them however good the selectors are.
    const CLICK_TO_EDIT = [
      '<table><tr>',
      '<th>Container Number</th><th>Carrier Seal #</th><th>Shipper Seal #</th><th>HS Code</th>',
      '</tr><tr><td></td><td></td><td></td><td></td></tr></table>',
    ].join('');
    document.body.innerHTML = `<div role="dialog">${CLICK_TO_EDIT}</div>`;
    expect(detectGrid(document).found).toBe(true);
    expect(gridAcceptsTyping(document)).toBe(false);
  });

  it('says no when there is no grid at all', () => {
    document.body.innerHTML = OTHER_TABLE;
    expect(gridAcceptsTyping(document)).toBe(false);
  });

  it('ignores a table that has no Container Number column', () => {
    document.body.innerHTML = OTHER_TABLE;
    expect(detectGrid(document).found).toBe(false);
  });

  it('prefers the inner grid when one table wraps another', () => {
    document.body.innerHTML = `<table><tr><td>${GRID}</td></tr></table>`;
    const detection = detectGrid(document);
    expect(detection.found).toBe(true);
    expect(detection.root?.querySelectorAll('table')).toHaveLength(0);
  });
});

/**
 * The live grid's header row, 2026-09-17: the two seal headings are dropdowns
 * of seal types, so the heading a column shows is the option it has selected.
 * Read as textContent, a <select> is every option run together, and both seal
 * columns then carry the same wording whichever option each shows.
 */
/**
 * The fifth live run, 2026-09-17: with the merged build the operator's
 * Diagnostics listed every grid rung at 0, `table` at 2, and "with a Container
 * Number heading" at 0. So two tables were visible and neither was the grid:
 * the grid the operator pastes into is not a table, not an ARIA grid, and in
 * neither captured id. tests/fixtures/inttra-div-grid.html is that page.
 */
describe('a grid that is not a table', () => {
  beforeEach(() => {
    document.body.innerHTML = html('inttra-div-grid');
  });

  it('was found by nothing that looks for a table or an ARIA grid', () => {
    const attempts = detectGrid(document).attempts;
    const byShape = attempts.find((attempt) => /with a Container Number heading/.test(attempt.query));
    expect(byShape).toMatchObject({ matches: 0, raw: 2 });
    expect(attempts.find((attempt) => attempt.query === 'table')).toMatchObject({ matches: 2, raw: 2 });
  });

  it('is found by the wording of its header row, and read as a div grid with its rows', () => {
    const grid = detectGrid(document);
    expect(grid.found).toBe(true);
    expect(grid.kind).toBe('divGrid');
    expect(grid.matchedWith).toBe('header row by wording: 4 of 9 columns identified');
    expect(grid.headers.map((header) => header.column)).toEqual(['ContainerNumber', 'CarrierSeal', 'ShipperSeal', 'HsCode']);
    expect(grid.headers[1]?.options).toHaveLength(3);
    expect(grid.rowCount).toBe(3);
    expect(grid.attempts[grid.attempts.length - 1]).toMatchObject({ matches: 1, raw: 1 });
    expect(findContainerGrid(document).how).toBe('wording');
  });

  it('cannot be typed into, so Copy rows is the route, and the block is in its own order', () => {
    expect(gridAcceptsTyping(document)).toBe(false);
    const block = gridPasteBlock(samplePackage(), detectGrid(document));
    expect(block.fromGrid).toBe(true);
    expect(block.columns.map((column) => column.heading)).toEqual(['Container Number', 'Carrier Seal #', 'Shipper Seal #']);
    expect(block.tsv.split('\r\n')[0]).toBe('MSCU1234566\tSL-4471209\tSH-001');
  });

  it('identifies the screen as Copy Container Details, whatever the strip behind the modal says', () => {
    const page = detectInttraPage(document);
    expect(page.page).toBe('copyContainerDetails');
    expect(page.confidence).toBe('high');
    expect(page.evidence.some((line) => /found by the wording of its header row/.test(line))).toBe(true);
    expect(hasStructuralEvidence(document)).toBe(true);
  });

  it('is found inside an open shadow root too', () => {
    document.body.innerHTML = '<nav><a class="nav-link active">B/L Documents</a></nav><div id="host"></div>';
    const host = document.getElementById('host') as HTMLElement;
    host.attachShadow({ mode: 'open' }).innerHTML = html('inttra-div-grid');
    const grid = detectGrid(document);
    expect(grid.found).toBe(true);
    expect(grid.kind).toBe('divGrid');
    expect(grid.headers.map((header) => header.column)).toEqual(['ContainerNumber', 'CarrierSeal', 'ShipperSeal', 'HsCode']);
    expect(detectInttraPage(document).page).toBe('copyContainerDetails');
  });

  it('never takes a form row of labels over inputs for a header row', () => {
    // The Container & Cargo step: the same words, in a form. Its labels sit
    // over typed controls, which a grid's header row never does.
    document.body.innerHTML = [
      '<nav><a class="nav-link active">Container &amp; Cargo</a></nav><h2>Container &amp; Cargo</h2>',
      '<div class="form-row">',
      '<div class="col"><label>Container Number</label><input type="text" /></div>',
      '<div class="col"><label>Seal Number</label><input type="text" /></div>',
      '<div class="col"><label>HS Code</label><input type="text" /></div>',
      '</div>',
    ].join('');
    expect(findHeaderRowByText(document)).toMatchObject({ row: null, seeds: 1 });
    expect(detectGrid(document).found).toBe(false);
    expect(detectInttraPage(document).page).toBe('containerCargo');
  });

  it('needs more than the one heading: a lone Container Number label is no grid', () => {
    document.body.innerHTML = '<div class="summary"><span>Container Number</span><span>TLLU7564971</span></div>';
    expect(findHeaderRowByText(document).row).toBeNull();
    expect(detectGrid(document).found).toBe(false);
  });

  it('reads an editableGrid-style header, a table inside every heading cell, as one header row', () => {
    const heading = (inner: string): string => `<th><table><tr><td>${inner}</td></tr></table></th>`;
    document.body.innerHTML = [
      '<div id="editableGridWrapper"><table class="editableGrid"><thead><tr>',
      heading('Container Number'),
      heading('<select><option selected>Carrier Seal #</option><option>Shipper Seal #</option></select>'),
      heading('<select><option>Carrier Seal #</option><option selected>Shipper Seal #</option></select>'),
      heading('HS Code'),
      '</tr></thead><tbody>',
      '<tr><td></td><td></td><td></td><td></td></tr>'.repeat(2),
      '</tbody></table></div>',
    ].join('');
    const grid = detectGrid(document);
    expect(grid.kind).toBe('table');
    expect(grid.headers.map((header) => header.column)).toEqual(['ContainerNumber', 'CarrierSeal', 'ShipperSeal', 'HsCode']);
    expect(grid.rowCount).toBe(2);
  });

  it('describes, for the capture, what is around the words Container Number', () => {
    const probe = probeStructure(document, window);
    expect(probe.topFrame).toBe(true);
    expect(probe.frames).toEqual([]);
    expect(probe.markers).toContainEqual({ selector: '#siCopyContainerWrapperDiv', state: 'absent' });
    expect(probe.containerNumber).toHaveLength(1);
    const found = probe.containerNumber[0];
    expect(found).toMatchObject({ text: 'Container Number', visible: true });
    expect(found?.ancestors.slice(0, 3)).toEqual(['span.column-name', 'div.grid-header-column', 'div.grid-header-columns']);
    expect(found?.rows.map((row) => row.row)).toEqual(['div.grid-header-column', 'div.grid-header-columns', 'div#containerGridFifthRun.grid', 'div.modal']);
    expect(found?.rows[1]?.cells).toEqual(['Container Number', 'Carrier Seal #', 'Shipper Seal #', 'HS Code']);
  });

  it('says whether each captured marker is absent, hidden or visible, and names the frames', () => {
    document.body.innerHTML = [
      '<div id="siCopyContainerWrapperDiv" style="display: none"></div><div id="editableGridWrapper"></div>',
      '<iframe src="/siact/grid"></iframe><iframe></iframe>',
    ].join('');
    const probe = probeStructure(document, window);
    expect(probe.markers).toContainEqual({ selector: '#siCopyContainerWrapperDiv', state: 'hidden' });
    expect(probe.markers).toContainEqual({ selector: '#editableGridWrapper', state: 'visible' });
    expect(probe.frames).toHaveLength(2);
    expect(probe.frames[0]).toMatch(/localhost/);
    expect(probe.frames[1]).toBe('(no src)');
    expect(probe.containerNumber).toEqual([]);
  });
});

describe('dropdown headings', () => {
  const SEAL_TYPES = ['Carrier Seal #', 'Shipper Seal #', 'Customs Seal #'];
  const dropdown = (options: string[], selected: string): string =>
    `<select>${options.map((option) => `<option${option === selected ? ' selected' : ''}>${option}</option>`).join('')}</select>`;
  const grid = (first: string, second: string, options = SEAL_TYPES): string =>
    [
      '<table><thead><tr>',
      `<th>*Container Number</th><th>${dropdown(options, first)}</th><th>${dropdown(options, second)}</th><th>HS Code</th>`,
      '</tr></thead><tbody><tr><td></td><td></td><td></td><td></td></tr></tbody></table>',
    ].join('');
  const columnsOf = (): Array<string | null> => detectGrid(document).headers.map((header) => header.column);

  it('reads a dropdown heading as the option it shows, with Carrier Seal # listed first', () => {
    document.body.innerHTML = grid('Carrier Seal #', 'Shipper Seal #');
    const detection = detectGrid(document);
    expect(detection.found).toBe(true);
    expect(detection.headers.map((header) => header.column)).toEqual(['ContainerNumber', 'CarrierSeal', 'ShipperSeal', 'HsCode']);
    expect(detection.headers[1]?.text).toBe('Carrier Seal #');
    expect(detection.headers[2]?.text).toBe('Shipper Seal #');
    expect(detection.headers[1]?.options).toEqual(SEAL_TYPES);
  });

  it('reads it the same with Shipper Seal # listed first, so the carrier column is never claimed as the shipper\'s', () => {
    document.body.innerHTML = grid('Carrier Seal #', 'Shipper Seal #', ['Shipper Seal #', 'Carrier Seal #', 'Customs Seal #']);
    expect(columnsOf()).toEqual(['ContainerNumber', 'CarrierSeal', 'ShipperSeal', 'HsCode']);
  });

  it('leaves a dropdown still on its placeholder unidentified, and still identifies the other seal column', () => {
    document.body.innerHTML = grid('Select One', 'Shipper Seal #', ['Select One', ...SEAL_TYPES]);
    expect(columnsOf()).toEqual(['ContainerNumber', null, 'ShipperSeal', 'HsCode']);
    expect(detectGrid(document).missingColumns).toContain('CarrierSeal');
  });

  it('never reads the option list as the heading', () => {
    document.body.innerHTML = grid('Carrier Seal #', 'Shipper Seal #');
    const cell = document.querySelectorAll('th')[1] as Element;
    expect(cell.textContent).toBe(SEAL_TYPES.join(''));
    expect(readHeaderCell(cell)).toEqual({ text: 'Carrier Seal #', candidates: ['Carrier Seal #'], options: SEAL_TYPES });
  });

  it('reads the static text beside a dropdown when the option does not name the column', () => {
    document.body.innerHTML = '<table><tr><th>Container Number</th><th>Shipper Seal # <select><option selected>Bolt</option><option>Wire</option></select></th></tr><tr><td></td><td></td></tr></table>';
    expect(columnsOf()).toEqual(['ContainerNumber', 'ShipperSeal']);
  });

  it('lets a heading that matches exactly claim its column before a prefix can', () => {
    // "Seal Type" starts with the four-letter alias "seal"; read in cell
    // order it would take ShipperSeal before the real column is reached.
    document.body.innerHTML = '<table><tr><th>Container Number</th><th>Seal Type</th><th>Shipper Seal #</th><th>HS Code</th></tr><tr><td></td><td></td><td></td><td></td></tr></table>';
    expect(columnsOf()).toEqual(['ContainerNumber', null, 'ShipperSeal', 'HsCode']);
  });
});

/**
 * The block to paste: one cell per grid column, in the grid's own order. A
 * paste is positional, so a column left OUT of the row shifts every value
 * after it one column left; that is how the shipper's seal was pasted nowhere
 * on 2026-09-17.
 */
describe('the paste block', () => {
  const UNKNOWN_IN_THE_MIDDLE =
    '<table><tr><th>Container Number</th><th>Seal Type</th><th>Shipper Seal #</th><th>HS Code</th></tr><tr><td></td><td></td><td></td><td></td></tr></table>';

  it('pastes one cell per grid column, blank where the package has nothing for a column', () => {
    document.body.innerHTML = UNKNOWN_IN_THE_MIDDLE;
    const block = gridPasteBlock(samplePackage(), detectGrid(document));
    expect(block.fromGrid).toBe(true);
    expect(block.tsv.split('\r\n')).toEqual(['MSCU1234566\t\tSH-001', 'MSDU7654322\t\t', 'TGHU7654320\t\tSL-9']);
    expect(block.width).toBe(3);
    expect(block.columns.map((column) => column.column)).toEqual(['ContainerNumber', null, 'ShipperSeal']);
    expect(block.blank).toEqual(['Seal Type']);
  });

  it('cuts every row at the widest value in any row, and pads every row to that width', () => {
    document.body.innerHTML = UNKNOWN_IN_THE_MIDDLE;
    const block = gridPasteBlock(samplePackage(), detectGrid(document));
    expect(block.rows).toBe(3);
    expect(block.tsv.split('\r\n').every((row) => row.split('\t').length === block.width)).toBe(true);
    expect(block.tsv.endsWith('\r\n')).toBe(false);
  });

  it('starts at the Container Number column, which is the cell the operator pastes into', () => {
    document.body.innerHTML = '<table><tr><th><input type="checkbox" /></th><th>Container Number</th><th>Shipper Seal #</th></tr><tr><td></td><td></td><td></td></tr></table>';
    const block = gridPasteBlock(samplePackage(), detectGrid(document));
    expect(block.columns[0]?.column).toBe('ContainerNumber');
    expect(block.tsv.split('\r\n')[0]).toBe('MSCU1234566\tSH-001');
  });

  it('falls back to the GRID_COLUMNS order when no grid was detected', () => {
    const block = gridPasteBlock(samplePackage(), null);
    expect(block.fromGrid).toBe(false);
    expect(block.columns.map((column) => column.heading)).toEqual(['Container Number', 'Carrier Seal #', 'Shipper Seal #']);
    expect(block.tsv.split('\r\n')[0]).toBe('MSCU1234566\tSL-4471209\tSH-001');
  });

  it('keeps one container on one row when a value holds a line break', () => {
    document.body.innerHTML = html('inttra-container-grid-aria');
    const pkg = samplePackage();
    const first = pkg.containers[0];
    if (!first) throw new Error('no container');
    const broken: FilingPackage = { ...pkg, containers: [{ ...first, cargoDescription: { value: 'ALMOND\nKERNELS', source: 'manual', detail: 'typed' } }, ...pkg.containers.slice(1)] };
    const block = gridPasteBlock(broken, detectGrid(document));
    expect(block.rows).toBe(3);
    expect(block.tsv.split('\r\n')).toHaveLength(3);
    expect(block.tsv.split('\r\n')[0]).toBe('MSCU1234566\tSL-4471209\tSH-001\tALMOND KERNELS');
  });
});

describe('isInttraVisible', () => {
  it('is false inside a hidden ancestor, whether by attribute or by style', () => {
    document.body.innerHTML = [
      '<div hidden><table id="a"></table></div>',
      '<div style="display: none"><div><table id="b"></table></div></div>',
      '<div style="visibility: hidden"><table id="c"></table></div>',
      '<table id="d"></table>',
    ].join('');
    const visible = (id: string): boolean => isInttraVisible(document.getElementById(id) as Element);
    expect(visible('a')).toBe(false);
    expect(visible('b')).toBe(false);
    expect(visible('c')).toBe(false);
    expect(visible('d')).toBe(true);
  });

  it('is false for a detached element', () => {
    expect(isInttraVisible(document.createElement('table'))).toBe(false);
  });
});

describe('page detection', () => {
  it('identifies Copy Container Details by the grid itself, when the strip and heading behind the modal outscore a marker-less modal', () => {
    // The live portal, 2026-09-17, fourth run: a build that carried the
    // captured ids still said "B/L Documents" with the grid on screen, so the
    // ids cannot be the only thing that identifies the modal. The grid is.
    document.body.innerHTML = [
      '<nav><a class="nav-link active">B/L Documents</a></nav><h2>Parties</h2>',
      '<div role="dialog"><table><tr><th>*Container Number</th><th>Carrier Seal #</th><th>Shipper Seal #</th></tr><tr><td></td><td></td><td></td></tr></table></div>',
    ].join('');
    const page = detectInttraPage(document);
    expect(page.page).toBe('copyContainerDetails');
    expect(page.confidence).toBe('high');
    expect(page.scores.find((score) => score.page === 'blDocuments')?.score).toBe(EVIDENCE.tab + EVIDENCE.heading);
    expect(page.scores.find((score) => score.page === 'copyContainerDetails')?.score).toBe(EVIDENCE.grid);
    expect(page.evidence.some((line) => /container grid/.test(line))).toBe(true);
    expect(hasStructuralEvidence(document)).toBe(true);
  });

  it('ignores a marker that is in the DOM but hidden', () => {
    document.body.innerHTML = [
      '<nav><a class="nav-link active">B/L Documents</a></nav>',
      '<div id="siCopyContainerWrapperDiv" style="display: none"><div id="editableGridWrapper"><table><tr><th>Container Number</th></tr><tr><td></td></tr></table></div></div>',
    ].join('');
    expect(detectInttraPage(document).page).toBe('blDocuments');
    expect(detectGrid(document).found).toBe(false);
    expect(hasStructuralEvidence(document)).toBe(false);
  });

  it('scores structure above every wording hint combined', () => {
    const wording = EVIDENCE.tab + EVIDENCE.heading + EVIDENCE.url;
    expect(EVIDENCE.marker).toBeGreaterThan(wording);
    expect(EVIDENCE.grid).toBeGreaterThan(wording);
  });

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

  it('names what was captured from the live portal, id and wording apart, and ships the rest as placeholders', () => {
    // Two different facts, and they are worth different things.
    //
    // CAPTURED_IDS were copied out of the live Particulars DOM on 2026-09-20.
    // An id names a ROW, so these are the only container fields that can be
    // filled beyond block 1.
    //
    // CAPTURED_LABELS were READ OFF the live screens the same day - the
    // wording is known to be INTTRA's, the id is not. A label cannot name a
    // row, so these fill block 1 and nothing further, and none of them may
    // carry a verified id: writing `verified` against a guessed selector is
    // exactly the lie this test exists to catch.
    //
    // Both lists can only grow.
    const capturedIds = ['ContainerNumber', 'CarrierSeal', 'ShipperSeal'];
    const capturedLabels = ['BookingNumber', 'Carrier', 'ContainerNumber', 'CarrierSeal', 'ShipperSeal', 'CargoDescription', 'HsCode', 'PackageType', 'PackageCount', 'GrossWeight', 'MarksAndNumbers'];
    const captured = [...new Set([...capturedIds, ...capturedLabels])];
    expect(unverifiedInttraFieldKeys()).toEqual(ALL_INTTRA_MAPPINGS.map((mapping) => mapping.key).filter((key) => !captured.includes(key)));
    for (const mapping of ALL_INTTRA_MAPPINGS) {
      expect(mapping.devtoolsHint).toBeTruthy();
      if (!captured.includes(mapping.key)) {
        expect(mapping.verificationStatus, mapping.key).toBe('placeholder');
        expect(mapping.candidates.every((candidate) => candidate.verified === false), mapping.key).toBe(true);
        continue;
      }
      expect(mapping.verificationStatus, mapping.key).toBe('verified');
      if (capturedIds.includes(mapping.key)) {
        // The captured selector is the row-numbered id, not the class: the
        // class is identical on every container block.
        expect(mapping.candidates[0], mapping.key).toMatchObject({ strategy: 'id', verified: true });
        expect(mapping.candidates[0]?.selector, mapping.key).toContain('{n}');
      }
      if (capturedLabels.includes(mapping.key)) {
        const label = mapping.candidates.find((candidate) => candidate.verified && candidate.strategy === 'label');
        expect(label, mapping.key).toBeTruthy();
        // A wording read off the screen outranks every guess below it.
        expect(mapping.candidates.indexOf(label!), mapping.key).toBe(capturedIds.includes(mapping.key) ? 1 : 0);
      }
      // Nothing may claim a verified id it was not given.
      const fakeId = mapping.candidates.some(
        (candidate) => candidate.verified && candidate.strategy !== 'label' && !capturedIds.includes(mapping.key),
      );
      expect(fakeId, mapping.key).toBe(false);
    }
  });

  it('asks each captured wording on its own, so a screen carrying two of them is not ambiguous', () => {
    // The live Create Shipping Instruction screen answered the old four-in-one
    // Booking Number label query with TWO controls (2026-09-20). Every label
    // rung now carries exactly one wording, so "Carrier Booking Number" is
    // asked, and answered, before "Booking Number" is ever tried.
    for (const mapping of ALL_INTTRA_MAPPINGS) {
      for (const candidate of mapping.candidates) {
        if (candidate.strategy !== 'label') continue;
        expect(candidate.labelText?.length, `${mapping.key}: ${candidate.labelText?.join(' | ')}`).toBe(1);
      }
    }
  });

  it('derives a control kind from the field type, and only where the type implies one', () => {
    const kindOf = (key: string): string | undefined => ALL_INTTRA_MAPPINGS.find((mapping) => mapping.key === key)?.controlKind;
    // "Package Count/Type (Outermost)" is one label over two controls; the
    // declared kind is what tells them apart.
    expect(kindOf('PackageType')).toBe('select');
    expect(kindOf('PackageCount')).toBe('input');
    expect(kindOf('PortOfLoading')).toBe('input');
    // 'text' implies nothing: Cargo Description is a text area, HS Code a box.
    expect(kindOf('CargoDescription')).toBeUndefined();
    expect(kindOf('HsCode')).toBeUndefined();
  });

  it('keeps keys unique and scopes container fields to the Container & Cargo screen', () => {
    const keys = ALL_INTTRA_MAPPINGS.map((mapping) => mapping.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(inttraFieldsForPage('containerCargo').every((mapping) => mapping.scope === 'container')).toBe(true);
    // The live Create Shipping Instruction page carries both: General Details
    // and the Particulars blocks (2026-09-20), so it serves both scopes.
    expect(inttraFieldsForPage('generalDetails', 'shipment').every((mapping) => mapping.scope === 'shipment')).toBe(true);
    expect(inttraFieldsForPage('generalDetails', 'container').map((mapping) => mapping.key)).toEqual(
      inttraFieldsForPage('containerCargo').map((mapping) => mapping.key),
    );
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
    // Cut at the widest value: nothing right of Shipper Seal # holds one.
    expect(tsv.split('\r\n')[0]).toBe('MSCU1234566\tSL-4471209\tSH-001');
    expect(tsv.split('\r\n')).toHaveLength(3);
    expect(gridRowsAsTsv(pkg, null).split('\r\n')[0]?.split('\t')).toHaveLength(3);
    expect(GRID_COLUMNS.length).toBeGreaterThan(3);
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

/**
 * The Particulars blocks: one per container, numbered from 1 upward.
 *
 * Captured from the live DOM on 2026-09-20. Every draft carries a different
 * number of containers, so what matters is that container k is written into
 * row k and nowhere else, and that a row the screen does not have is reported
 * rather than written somewhere it would fit.
 */
describe('one container per row', () => {
  const value = (id: string): string => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '(missing)';

  beforeEach(() => {
    document.body.innerHTML = html('inttra-container-particulars');
  });

  it('writes each container into its own row, seals included', () => {
    const pkg = samplePackage();
    const first = fillInttraFields({ pkg, page: 'generalDetails', scope: 'container', containerIndex: 0 }, document);
    const second = fillInttraFields({ pkg, page: 'generalDetails', scope: 'container', containerIndex: 1 }, document);

    expect(value('cont-num-1')).toBe('MSCU1234566');
    expect(value('carr-seal-1')).toBe('SL-4471209');
    expect(value('ship-seal-1')).toBe('SH-001');
    expect(value('cont-num-2')).toBe('MSDU7654322');
    expect(value('carr-seal-2')).toBe('SL-4471210');
    // Container 2 carried no shipper seal in the document, so the box stays
    // empty: a seal is never moved from another row to fill a gap.
    expect(value('ship-seal-2')).toBe('');
    expect(first.errors + second.errors).toBe(0);
    expect(first.outcomes.find((outcome) => outcome.key === 'ContainerNumber')?.matchedWith).toContain('#cont-num-1');
    expect(second.outcomes.find((outcome) => outcome.key === 'ContainerNumber')?.matchedWith).toContain('#cont-num-2');
  });

  it('never lets one row overwrite another', () => {
    const pkg = samplePackage();
    fillInttraFields({ pkg, page: 'generalDetails', scope: 'container', containerIndex: 1 }, document);
    expect(value('cont-num-1')).toBe('');
    expect(value('carr-seal-1')).toBe('');
    expect(value('cont-num-2')).toBe('MSDU7654322');
  });

  it('reports the row number when the screen has fewer blocks than the package has containers', () => {
    const pkg = samplePackage();
    expect(pkg.containers.length).toBeGreaterThan(2);
    const report = fillInttraFields({ pkg, page: 'generalDetails', scope: 'container', containerIndex: 2 }, document);
    const outcome = report.outcomes.find((item) => item.key === 'ContainerNumber');
    expect(outcome?.status).toBe('warning');
    expect(outcome?.message).toContain('row 3');
    expect(outcome?.message).toContain('never presses Add Container');
    // Nothing was written into the rows that do exist.
    expect(value('cont-num-1')).toBe('');
    expect(value('cont-num-2')).toBe('');
  });

  it('never falls back to row 1 when the draft has fewer blocks than the package has containers', () => {
    // The trap this guards: every draft carries a different number of
    // containers, so filling container 2 on a one-block draft must write
    // nothing at all rather than land in container 1's boxes.
    document.getElementById('container-block-2')?.remove();
    const pkg = samplePackage();
    const report = fillInttraFields({ pkg, page: 'generalDetails', scope: 'container', containerIndex: 1 }, document);
    expect(value('cont-num-1')).toBe('');
    expect(value('carr-seal-1')).toBe('');
    expect(value('ship-seal-1')).toBe('');
    expect(report.filled).toBe(0);
    expect(report.outcomes.find((outcome) => outcome.key === 'ContainerNumber')?.message).toContain('row 2');
  });

  it('is probed on row 1 by diagnostics, because a literal row token matches nothing', () => {
    // What the live diagnostics reported before this: `#cont-num-{n}` -> 0
    // matches, which read as "the captured selector does not work" when the
    // truth was that nothing had substituted a row.
    const raw = inttraFieldsForPage('generalDetails', 'container').find((mapping) => mapping.key === 'ContainerNumber');
    expect(detectField(raw!, { root: document }).attempts[0]).toMatchObject({ query: '#cont-num-{n}', matches: 0 });

    const probed = mappingsForRow([raw!], 1)[0];
    const detection = detectField(probed!, { root: document });
    expect(detection.status).toBe('FOUND');
    expect(detection.matchedWith).toContain('#cont-num-1');
  });

  it('keeps a multi-seal value whole, because the live box takes 79 characters', () => {
    const seals = 'SL-4471209, SL-4471210, SL-4471211, SL-4471212';
    expect(seals.length).toBeGreaterThan(15);
    const pkg = setManualContainer(samplePackage(), 0, 'carrierSeal', seals);
    fillInttraFields({ pkg, page: 'generalDetails', scope: 'container', containerIndex: 0 }, document);
    expect(value('carr-seal-1')).toBe(seals);
  });

  it('substitutes the row token in a pasted override too', () => {
    document.body.innerHTML += '<input id="my-row-1" /><input id="my-row-2" />';
    const overrides = parseOverrides({ version: 1, fields: { ContainerNumber: [{ strategy: 'id', selector: '#my-row-{n}' }] } }, document);
    const pkg = samplePackage();
    fillInttraFields({ pkg, page: 'generalDetails', scope: 'container', containerIndex: 1, overrides }, document);
    expect(value('my-row-2')).toBe('MSDU7654322');
    expect(value('my-row-1')).toBe('');
    expect(value('cont-num-2')).toBe('');
  });
});

/**
 * The live create page, third live run (2026-09-20).
 *
 * The operator ran the build against a real draft and the header read "INTTRA
 * screen not identified", so Fill was blocked before any selector was tried.
 * The cause is in these tests: one page carries both "General Details" and
 * the container blocks, so two signatures match a heading and score equally,
 * and an equal score used to mean "unknown".
 */
describe('naming the live create page', () => {
  const atUrl = (path: string, run: () => void): void => {
    const before = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, '', path);
    try {
      run();
    } finally {
      window.history.replaceState({}, '', before);
    }
  };

  beforeEach(() => {
    document.body.innerHTML = html('inttra-create-si');
  });

  it('names it instead of reporting two screens', () => {
    atUrl('/siact/siworkspace#/create/1789899643548', () => {
      const detection = detectInttraPage(document);
      expect(detection.page).toBe('generalDetails');
      expect(detection.label).toBe('Create Shipping Instruction');
      expect(detection.confidence).toBe('medium');
      expect(detection.evidence.join(' ')).toContain('siworkspace#/create');
    });
  });

  it('still names it when only the headings match, which is the tie that blocked Fill', () => {
    atUrl('/siact/siworkspace#/elsewhere/42', () => {
      const detection = detectInttraPage(document);
      expect(detection.page).toBe('generalDetails');
      expect(detection.confidence).not.toBe('none');
      expect(detection.evidence.join(' ')).toContain('container blocks are on this page too');
    });
  });

  it('names it from the captured URL alone, when no heading matches at all', () => {
    document.body.innerHTML = '<div><div class="not-a-heading">Shipping Instructions</div></div>';
    atUrl('/siact/siworkspace#/create/1789899643548', () => {
      const detection = detectInttraPage(document);
      expect(detection.page).toBe('generalDetails');
      expect(detection.confidence).toBe('low');
    });
  });

  it('yields to the grid when Copy Container Details opens over it', () => {
    document.body.innerHTML += [
      '<div role="dialog"><table><tr>',
      '<th>Container Number</th><th>Carrier Seal #</th><th>Shipper Seal #</th><th>HS Code</th>',
      '</tr><tr><td><input /></td><td><input /></td><td><input /></td><td><input /></td></tr></table></div>',
    ].join('');
    atUrl('/siact/siworkspace#/create/1789899643548', () => {
      expect(detectInttraPage(document).page).toBe('copyContainerDetails');
    });
  });

  /**
   * The workspace list says "Shipping Instruction" in its own heading, so it
   * can be named the create page. That is an old behaviour, not a new one,
   * and it is harmless because naming a screen writes nothing: the fields are
   * not there, so every one of them is reported as not found. Capturing the
   * list page's heading is what would sharpen it, and it has not been
   * captured.
   */
  it('writes nothing on a page that only sounds like the create page', () => {
    document.body.innerHTML = '<h1>Shipping Instruction Workspace</h1><table><tr><th>Booking</th></tr></table>';
    atUrl('/siact/siworkspace#', () => {
      const pkg = samplePackage();
      const report = fillInttraFields({ pkg, page: detectInttraPage(document).page, scope: 'container', containerIndex: 0 }, document);
      expect(report.filled).toBe(0);
      expect(document.querySelectorAll('input')).toHaveLength(0);
    });
  });
});

/**
 * The live Create Shipping Instruction run of 2026-09-20, field by field.
 *
 * Seven header fields went in and two came out filled. Every other answer is
 * pinned here, because each one was a different kind of failure and each got a
 * different fix.
 */
describe('what the live Create Shipping Instruction screen answered', () => {
  const livePackage = (): FilingPackage => {
    const pkg = samplePackage();
    if (pkg.containers.length < 2) throw new Error('fixture needs at least two containers');
    return {
      ...pkg,
      header: {
        ...pkg.header,
        carrier: { value: 'MSCU', source: 'excel' as const, detail: 'carrier' },
        portOfLoading: { value: 'OAKLAND, CA, UNITED STATES (USOAK)', source: 'deckhand' as const, detail: 'POL' },
        portOfDischarge: { value: 'EVYAP PORT /KOCAELI, TURKEY (TREYP)', source: 'deckhand' as const, detail: 'POD' },
      },
      // The same cargo on every container, as the live package had it: one
      // invoice line across three boxes.
      containers: pkg.containers.map((item) => ({
        ...item,
        // Derived by the package as the first six digits of the Schedule B
        // number, dot and all.
        hsCode: { value: '0802.12', source: 'derived' as const, detail: 'first six digits of the Schedule B number' },
        cargoDescription: { value: 'SHELLED ALMONDS', source: 'excel' as const, detail: 'description' },
        packageCount: { value: '850', source: 'manual' as const, detail: 'typed by the operator' },
        packageType: { value: 'CT', source: 'manual' as const, detail: 'typed by the operator' },
        grossWeightKg: { value: '26500', source: 'manual' as const, detail: 'typed by the operator' },
      })),
    };
  };

  beforeEach(() => {
    document.body.innerHTML = html('inttra-live-shapes');
  });

  it('writes the HS code without its decimal point, because the box refuses one', () => {
    const report = fillInttraFields({ pkg: livePackage(), page: 'containerCargo', scope: 'container' }, document);
    expect((document.getElementById('hs-code-1') as HTMLInputElement).value).toBe('080212');
    const hs = report.outcomes.find((outcome) => outcome.key === 'HsCode');
    expect(hs?.status).toBe('transformed');
    expect(hs?.message).toContain('Separators removed');
    // The package keeps the canonical value; only the presentation changed.
    expect(livePackage().containers[0]?.hsCode.value).toBe('0802.12');
  });

  it('takes Booking Number from the wording the screen actually uses, not from all four at once', () => {
    // Both "Carrier Booking Number" and "Booking Number" are on this page, as
    // they were on the live one. The old single four-wording query matched two
    // controls and wrote neither.
    const report = fillInttraFields({ pkg: livePackage(), page: 'generalDetails', scope: 'shipment' }, document);
    expect((document.getElementById('carr-book-nbr') as HTMLInputElement).value).toBe('EBKG18531408');
    expect((document.getElementById('hbl-booking') as HTMLInputElement).value).toBe('');
    expect(report.outcomes.find((outcome) => outcome.key === 'BookingNumber')?.status).toBe('filled');
  });

  it('picks the carrier dropdown out of two controls whose id ends in "carrier"', () => {
    const report = fillInttraFields({ pkg: livePackage(), page: 'generalDetails', scope: 'shipment' }, document);
    expect((document.getElementById('si-carrier') as HTMLSelectElement).value).toBe('MSCU');
    expect((document.getElementById('nameOfCarrier') as HTMLInputElement).value).toBe('');
    expect(report.outcomes.find((outcome) => outcome.key === 'Carrier')?.status).toBe('filled');
  });

  it('tells the count box and the type dropdown apart under one shared label', () => {
    const report = fillInttraFields({ pkg: livePackage(), page: 'containerCargo', scope: 'container' }, document);
    expect((document.getElementById('pkg-count-1') as HTMLInputElement).value).toBe('850');
    expect((document.getElementById('pkg-type-1') as HTMLSelectElement).value).toBe('CT');
    const count = report.outcomes.find((outcome) => outcome.key === 'PackageCount');
    expect(count?.message).toContain('exactly one is a text box');
    expect(count?.matches?.length).toBe(2);
  });

  it('types into a port look-up without the events that empty it, and says to pick the match', () => {
    // The live portal took both ports and read back "" a moment later. A
    // type-ahead discards anything not chosen from its list, and `change` and
    // `blur` are what make it do so.
    const seen: string[] = [];
    const pol = document.getElementById('pol-box') as HTMLInputElement;
    for (const type of ['input', 'change', 'blur', 'focusout']) {
      pol.addEventListener(type, () => {
        seen.push(type);
        if (type === 'change' || type === 'blur') pol.value = '';
      });
    }
    const report = fillInttraFields({ pkg: livePackage(), page: 'generalDetails', scope: 'shipment' }, document);
    expect(seen).toEqual(['input']);
    expect(pol.value).toBe('OAKLAND, CA, UNITED STATES (USOAK)');
    const outcome = report.outcomes.find((item) => item.key === 'PortOfLoading');
    expect(outcome?.status).toBe('warning');
    expect(outcome?.message).toContain('pick it from the suggestions');
    // The UN/LOCODE is offered as the search term: five characters, not thirty.
    expect(outcome?.message).toContain('USOAK');
  });

  it('says a container field has no row-numbered selector, rather than blaming INTTRA for row 2', () => {
    const pkg = livePackage();
    const report = fillInttraFields({ pkg, page: 'containerCargo', scope: 'container', containerIndex: 1 }, document);
    const hs = report.outcomes.find((outcome) => outcome.key === 'HsCode');
    expect(hs?.status).toBe('warning');
    expect(hs?.message).toContain('no row-numbered selector yet');
    // And nothing was written into container 1's boxes.
    expect((document.getElementById('hs-code-1') as HTMLInputElement).value).toBe('');
  });
});
