/**
 * The playground: the four AESDirect steps as pages that open from disk, the
 * example workbook, and a README, written into the playground build of the
 * Quickfill Helper (scripts/build-quickfill.mjs --playground) or of the ACE
 * Helper (scripts/build.mjs --playground).
 *
 * The pages are the same four either way, because they are mocks of ACE, not
 * of a helper. What differs is who fills them: Quickfill pastes into one box,
 * the ACE Helper imports the workbook in its side panel and previews before it
 * fills. HELPERS below is that difference, and the only difference.
 *
 * The pages are the test fixtures in tests/fixtures/ace-*.html, wrapped at
 * build time: the real labels and the six captured ids stay the single copy
 * that the tests also run against, so a mock step cannot drift from the one
 * the detector and the filler are proven on. The wrapper adds a document
 * around the fragment, a stylesheet, tabs that link the four files to each
 * other, and mock behaviour for the buttons ACE has (Save shows a note, Add
 * New Line opens an empty line), so an operator can walk the four steps the
 * way they would on the portal, and see what a fill lands.
 *
 * Nothing here is sent anywhere, and the playground build cannot open a
 * portal page at all: its manifest matches files and localhost only.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

import { COLUMNS, EXAMPLE_ROWS } from './templateData.mjs';

export const ACE_STEPS = [
  { step: 1, fixture: 'ace-shipment.html', file: 'step1-shipment.html', title: 'Step 1: Shipment' },
  { step: 2, fixture: 'ace-parties.html', file: 'step2-parties.html', title: 'Step 2: Parties' },
  { step: 3, fixture: 'ace-commodities.html', file: 'step3-commodities.html', title: 'Step 3: Commodities' },
  { step: 4, fixture: 'ace-transportation.html', file: 'step4-transportation.html', title: 'Step 4: Transportation' },
];

export const WORKBOOK_FILE = 'ACE_Import_Example.xlsx';

/** The content-script matches of the playground manifest: pages from disk and from a local server, never a portal. */
export const PLAYGROUND_MATCHES = ['file:///*', 'http://127.0.0.1/*', 'http://localhost/*'];

/**
 * Which helper a playground folder is built for.
 *
 * `hostPermissions` is the one real asymmetry. Quickfill asks the content
 * script where it is, so it needs no URL access and declares no host
 * permission at all. The ACE Helper's side panel finds its tab BY URL
 * (`resolveAceTab` in src/ui/tabs.ts), and Chrome hands an extension a tab's
 * url only for hosts it has permission for - so the ACE playground declares
 * the same three local patterns it injects into, and nothing else. Neither
 * build can name a portal host.
 */
export const HELPERS = {
  quickfill: {
    id: 'quickfill',
    card: 'Quickfill Helper (playground)',
    banner: 'Quickfill playground',
    bannerHow: 'Paste the example rows into Quickfill and press Fill this page.',
    description:
      'Practice build: runs only on pages opened from disk or from localhost, never on ACE or INTTRA. Paste the example rows and fill the four mock steps in playground/.',
    hostPermissions: null,
  },
  ace: {
    id: 'ace',
    card: 'ACE Helper (playground)',
    banner: 'ACE Helper playground',
    bannerHow: 'Import the example workbook in the side panel, read the Preview, then press Fill Current Page.',
    description:
      'Practice build: runs only on pages opened from disk or from localhost, never on ACE. Import the example workbook and fill the four mock steps in playground/.',
    hostPermissions: PLAYGROUND_MATCHES,
  },
};

/**
 * The shipping manifest, rewritten for a playground build: a card name that
 * cannot be mistaken for the real extension, local pages instead of portal
 * hosts, everything else untouched. The permissions list and the CSP are not
 * this function's to widen.
 */
export function playgroundManifest(manifest, helper) {
  const next = { ...manifest, name: helper.card, description: helper.description };
  if (next.action) next.action = { ...next.action, default_title: helper.card };
  if (helper.hostPermissions) next.host_permissions = [...helper.hostPermissions];
  else delete next.host_permissions;
  next.content_scripts = (next.content_scripts ?? []).map((script) => ({ ...script, matches: [...PLAYGROUND_MATCHES] }));
  return next;
}

const STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2937; background: #f3f4f6; }
  .playground-banner { background: #fff7e6; border-bottom: 1px solid #f0c36d; padding: 10px 24px; font-size: 13px; color: #5c3d00; }
  .playground-banner strong { color: #8a5a00; }
  #filing { max-width: 760px; margin: 24px auto 48px; background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 20px 28px 32px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 20px 0 8px; }
  h4 { margin: 0; font-size: 14px; }
  .small { color: #6b7280; font-size: 12px; }
  .nav-tabs, .nav-pills { list-style: none; display: flex; flex-wrap: wrap; gap: 4px; padding: 0; margin: 12px 0 20px; border-bottom: 1px solid #d1d5db; }
  .nav-tabs li a, .nav-pills li a { display: block; padding: 8px 12px; text-decoration: none; color: #1d4ed8; border: 1px solid transparent; border-bottom: none; border-radius: 4px 4px 0 0; }
  .nav-tabs li.active a, .nav-pills li.active a { color: #111827; font-weight: 600; background: #fff; border-color: #d1d5db; margin-bottom: -1px; }
  label { display: block; margin: 12px 0 4px; font-weight: 600; }
  legend { font-weight: 600; }
  input[type="text"], input[type="search"], select { width: 100%; max-width: 440px; padding: 6px 8px; border: 1px solid #9ca3af; border-radius: 4px; font: inherit; box-sizing: border-box; background: #fff; }
  input[readonly], input[disabled], select[disabled] { background: #f3f4f6; color: #6b7280; }
  .required { color: #b91c1c; }
  .conditional { color: #b45309; font-size: 11px; }
  .fa-info-circle::before { content: "i"; display: inline-block; width: 14px; height: 14px; border-radius: 50%; border: 1px solid #9ca3af; color: #6b7280; font-size: 10px; line-height: 14px; text-align: center; font-style: normal; margin-left: 4px; }
  .input-group { display: flex; gap: 6px; align-items: center; max-width: 440px; }
  .input-group input { flex: 1; }
  button { font: inherit; padding: 6px 12px; border: 1px solid #1d4ed8; background: #1d4ed8; color: #fff; border-radius: 4px; cursor: pointer; margin: 12px 8px 0 0; }
  button.calendar { width: 30px; height: 30px; margin: 0; border: 1px solid #9ca3af; background: #fff; }
  .panel { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; margin: 16px 0; }
  .panel-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .pull-right { margin-left: auto; }
  fieldset.radio-group { border: 1px solid #e5e7eb; border-radius: 4px; margin: 12px 0; }
  fieldset.radio-group label { display: inline-block; font-weight: 400; margin: 0 12px 0 0; }
  table.line-summary { border-collapse: collapse; width: 100%; margin: 8px 0; }
  table.line-summary th, table.line-summary td { border: 1px solid #e5e7eb; padding: 4px 6px; text-align: left; font-size: 12px; }
  [hidden] { display: none !important; }
  .mock-note { display: inline-block; margin: 12px 0 0 4px; color: #065f46; font-size: 12px; }
`;

/**
 * Mock behaviour for the buttons the fixtures carry. The helper never presses
 * any of them; the operator does, and here they only say so. Add New Line
 * empties the open line so "Fill line" can be practised for the next one.
 */
const SCRIPT = `
  (function () {
    function note(button, text) {
      var holder = button.parentElement;
      var el = holder.querySelector('.mock-note');
      if (!el) { el = document.createElement('span'); el.className = 'mock-note'; holder.appendChild(el); }
      el.textContent = text;
    }
    document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('button') : null;
      if (!button || button.classList.contains('calendar')) return;
      var id = button.id || '';
      if (/^addNewLine/.test(id)) {
        var panel = document.querySelector('[data-section="commodityLine"]');
        if (!panel) return;
        var controls = panel.querySelectorAll('input, select');
        for (var i = 0; i < controls.length; i += 1) {
          var control = controls[i];
          if (control.type === 'radio' || control.type === 'checkbox' || control.readOnly || control.disabled) continue;
          if (control.tagName === 'SELECT') control.selectedIndex = 0; else control.value = '';
        }
        var heading = panel.querySelector('h2');
        var match = heading && /Line (\\d+) Details/.exec(heading.textContent || '');
        if (heading && match) heading.textContent = 'Line ' + (Number(match[1]) + 1) + ' Details';
        note(button, 'A new empty line, here only. Pick the next line in the helper and fill it.');
        return;
      }
      if (/^delete/i.test(id)) { note(button, 'A mock: there is nothing to delete.'); return; }
      note(button, 'Saved here only. Nothing was sent anywhere.');
    });
  })();
`;

/** A fixture fragment as a page of its own: a document, a stylesheet, tabs that link the four files, and the mock buttons. */
export function wrapAceScreen(fragment, step, helper) {
  let body = fragment.replace(/^\s*<!--[\s\S]*?-->\s*/, '');
  for (const other of ACE_STEPS) body = body.replaceAll(`href="#step${other.step}"`, `href="${other.file}"`);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>ACE playground: ${step.title}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    `<div class="playground-banner"><strong>${helper.banner}.</strong> A mock of AESDirect ${step.title}, opened from your disk. ${helper.bannerHow} Nothing here is sent anywhere.</div>`,
    body.trim(),
    `<script>${SCRIPT}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** The example workbook: one sheet, the header row and the two example rows, so select-all and copy is exactly the paste. */
export function exampleWorkbook() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(EXAMPLE_ROWS, { header: COLUMNS });
  sheet['!cols'] = COLUMNS.map((column) => {
    const longest = EXAMPLE_ROWS.reduce((max, row) => Math.max(max, String(row[column] ?? '').length), column.length);
    return { wch: Math.min(Math.max(longest + 2, 10), 34) };
  });
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, sheet, 'Shipment');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

export function playgroundReadme(stamp, helper) {
  return helper.id === 'ace' ? aceReadme(stamp) : quickfillReadme(stamp);
}

function quickfillReadme(stamp) {
  return `# Quickfill playground

Four mock AESDirect steps and an example workbook, to practise the Quickfill
Helper without a portal. Nothing on these pages is sent anywhere, and this
build of the helper cannot open a portal page at all: it runs only on pages
opened from disk or from localhost.

Build: ${stamp}

## Set up, once

1. \`chrome://extensions\`, Developer mode on, **Load unpacked**, and pick the
   folder that holds \`manifest.json\` (the parent of this \`playground\`
   folder). The card reads "Quickfill Helper (playground)".
2. On that card, **Details**, and turn on **Allow access to file URLs**.
   Without it the helper cannot see a page opened from disk.
3. Pin the amber Q to the toolbar.

## Practise

1. Open \`${WORKBOOK_FILE}\`, select the header row and the two rows below it,
   copy.
2. Open \`${ACE_STEPS[0].file}\` (double-click it). Click the Q: the side panel
   opens beside the page and stays there while you work. Paste into the box.
   The line under the box reads \`Read as: spreadsheet rows · BKG-5541220 ·
   1 container · 1 with a seal · 2 lines\`.
3. Press **Fill this page** and read what landed: the reference number, the
   departure date as MM/DD/YYYY, the origin state, the destination.
4. Use the step tabs to open steps 2, 3 and 4 and press **Fill this page** on
   each. On Step 3 press **Fill line** for line 1; then **Add New Line** on the
   page, pick Line 2 in the side panel, and **Fill line** again.
5. The Save buttons only show a note. Reload a page to start it over.

## What this proves, and what it does not

It proves the mechanics: the paste is read as spreadsheet rows, the mapping
tables find the fields by the labels and the six ids captured from the live
portal, and the values are transformed on the way (the date to MM/DD/YYYY,
pounds to whole kilograms, codes upper-cased).

It does not prove the live portal. The dropdowns here are plain selects; on
AESDirect every dropdown is a Select2 widget that no build has written to yet.
Twenty of the twenty-six fields still match by label wording only. ACE's own
validation is not here. Never file from this build; it cannot reach a portal.
`;
}

function aceReadme(stamp) {
  return `# ACE Helper playground

Four mock AESDirect steps and the example workbook, to practise the ACE Helper
without a portal. Nothing on these pages is sent anywhere, and this build of
the helper cannot open a portal page at all: it runs only on pages opened from
disk or from localhost.

Build: ${stamp}

## Set up, once

1. \`chrome://extensions\`, Developer mode on, **Load unpacked**, and pick the
   folder that holds \`manifest.json\` (the parent of this \`playground\`
   folder). The card reads "ACE Helper (playground)".
2. On that card, **Details**, and turn on **Allow access to file URLs**.
   Without it the side panel cannot see a page opened from disk and will keep
   saying "No ACE tab detected".
3. Pin the helper to the toolbar.

## Practise

1. Open \`${ACE_STEPS[0].file}\` (double-click it). Click the toolbar icon: the
   side panel opens beside the page, and the pill in its header should now name
   the step instead of "No ACE tab detected". It stays open while you click
   into the form - that is the point of it.
2. On **Overview**, type \`4088\` under Shipment Reference Number and press
   **Set starting number**. Skip this and ACE Step 1 gets the invoice number
   instead, which is also worth seeing once.
3. **Import**, and choose \`${WORKBOOK_FILE}\` from this folder. The panel says
   which kind of file it opened and how many commodity lines it read. The file
   picker does not close the panel: it is not an action popup.
4. **Preview**: every field with its traffic light, and the original beside the
   ACE value wherever something was transformed. This is the review gate; read
   the yellows.
5. **Fill Current Page**. It writes into the most recently used playground tab,
   so it lands on step 1 even while you are looking at the panel. Read what
   arrived: the reference number, the departure date as MM/DD/YYYY, the origin
   state, the country of destination.
6. Steps 2 and 4 through the page tabs, **Fill Current Page** on each. On
   step 3 use **Fill Current Line** for line 1, then press **Add New Line** on
   the page, pick line 2 in the side panel, and fill again.
7. If you set a starting number: **Mark 4088 as filed** on Overview retires it
   and the next fill hands out 4089. Nothing else advances the sequence, so an
   abandoned draft leaves no gap.
8. The Save buttons only show a note. The helper never presses one, here or on
   the portal. Reload a page to start it over.

## What this proves, and what it does not

It proves the mechanics: the workbook is read, the mapping tables find the
fields by the labels and the six ids captured from the live portal, the values
are transformed on the way (the date to MM/DD/YYYY, pounds to whole kilograms,
codes upper-cased), the preview and the data quality checks run, and the
reference counter hands out and retires a number.

It does not prove the live portal. The dropdowns here are plain selects; on
AESDirect every dropdown is a Select2 widget that no build has written to yet.
Twenty of the twenty-six fields still match by label wording only. ACE's own
validation is not here. Never file from this build; it cannot reach a portal.
`;
}

/** Write the whole playground folder: the four pages, the workbook, the README. */
export function writePlayground(dir, { fixtures, stamp, helper }) {
  mkdirSync(dir, { recursive: true });
  for (const step of ACE_STEPS) {
    writeFileSync(join(dir, step.file), wrapAceScreen(readFileSync(join(fixtures, step.fixture), 'utf8'), step, helper));
  }
  writeFileSync(join(dir, WORKBOOK_FILE), exampleWorkbook());
  writeFileSync(join(dir, 'README.md'), playgroundReadme(stamp, helper));
  return [...ACE_STEPS.map((step) => step.file), WORKBOOK_FILE, 'README.md'];
}
