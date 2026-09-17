# INTTRA Helper

> **Status: built against mock screens; two structural selectors captured
> from the live portal, no field selector.** Every field selector in
> `inttra-extension/src/mappings/` is a placeholder and every page signature
> but one is guessed wording. What is real, from 2026-09-17 (section 5a): the
> hostname `ship.inttra.e2open.com`, the Copy Container Details modal root
> `#siCopyContainerWrapperDiv`, and the grid container `#editableGridWrapper`.
> The mechanics (page detection, field detection, the writer with read-back,
> the grid writer, the refusal to guess or click) are tested against
> `tests/fixtures/inttra-*.html`. Section 6 is the procedure for the rest.

The INTTRA Helper is a second Chrome MV3 extension, in `inttra-extension/`,
built to `dist-inttra/`. It is separate from the ACE Helper so that ACE keeps
its CBP-only host permissions and INTTRA keeps its own; neither bundle names
the other's hosts, and `scripts/check-bundle.mjs` checks each against its own
allowlist.

## 1. What it does, and never does

It is an **attended form-filling assistant**. The operator:

1. logs into INTTRA as usual;
2. opens the Shipping Instructions workflow;
3. loads a filing package into the helper (or builds one from an email in the
   Deckhand tab);
4. navigates INTTRA normally;
5. presses **Fill Current Page** on a form screen, or **Fill Container Grid**
   on Copy Container Details;
6. reviews every populated field;
7. saves, continues and submits in INTTRA, personally.

It never stores a credential, never performs a login, never touches MFA,
never presses Save, Continue, Add Row or Submit, never accepts a declaration,
and cannot run without a person in front of the screen. `automationPolicy.ts`
names each of those switches and freezes them off; `tests/inttraInvariants.test.ts`
asserts that and that no content-script file calls `.click()` at all.

## 2. Permissions

```json
"permissions": ["storage"],
"host_permissions": ["https://*.inttra.com/*", "https://*.e2open.com/*"]
```

No `<all_urls>`, no `tabs`, no `scripting`, no network permission; the
extension-page CSP pins `connect-src` to `'none'`. **Confirm the hostname of
the Shipping Instructions screens from the address bar during the first live
session.** If it is under neither domain, add the exact host to both
`host_permissions` and `content_scripts.matches` in
`inttra-extension/manifest.json` and to `INTTRA_URL_PATTERNS` in
`inttra-extension/src/ui/tabs.ts`, and rebuild. Never widen to `<all_urls>`.

## 3. Architecture

```
inttra-extension/src/
  pages.ts                     screen signatures: General Details, Container & Cargo,
                               Copy Container Details, Print Instructions,
                               B/L Documents, Notification Emails
  models/InttraField.ts        the mapping type (same candidate type as ACE)
  mappings/
    generalDetails.ts          booking, shipper's reference, carrier, vessel, voyage, POL, POD
    containerCargo.ts          the single-container form
    containerGrid.ts           the Copy Container Details grid: columns and root candidates
    printInstructions.ts       freight terms
    blDocuments.ts             the consignee, scoped to the Consignee panel
    notificationEmails.ts      nothing to fill; the page is detected so Fill can say so
    index.ts                   the registry, with operator overrides applied first
  content/
    inttraContent.ts           message handling; never navigates, never clicks
    pageDetector.ts            which screen is open, with a confidence
    fieldWriter.ts             setInttraFieldValue: THE ONLY WRITE PATH
    gridWriter.ts              InttraGridWriter
    filler.ts                  Fill Current Page for the form screens
    automationPolicy.ts        what is never pressed
  core/                        settings, session store, messages, overrides store
  ui/                          the popup and the panel
```

Shared with the ACE Helper, by import rather than by copy: the selector
candidate constructors and the field detector (`src/content/fieldDetector.ts`,
generic over any mapping with candidates), the highlight helper, the
transformer registry, the selector-override parser, the session log, the
Deckhand and Package tab renderers, and the filing package itself.

### The writer

`setInttraFieldValue(element, value)`:

1. resolves the control behind the element: a native `<input>`, `<textarea>`
   or `<select>`, the single control inside a grid cell, or a contenteditable
   element;
2. sets the value the way that kind needs: the native prototype setter for
   inputs (so a framework's patched setter cannot swallow it), `textContent`
   for contenteditable;
3. dispatches `input`, `keyup`, `change`, then `blur` and `focusout`;
4. reads the value back;
5. verifies it against what was asked for (exact, or equal after punctuation
   is stripped, which is reported as "reformatted");
6. returns `{ ok, control, readBack, reason? }`. It never throws.

A control kind it does not recognise (a click-to-edit widget, for instance)
is reported as `control: 'none'` with a reason. It is never clicked and no
mouse event is ever simulated. For such a grid, the **Copy rows** button
puts the container rows on the clipboard as one cell per grid column, in the
grid's own order, so one paste fills them ("The paste block", below).

### The grid writer

`fillContainerGrid(package)`:

- finds the grid root through `GRID_ROOT_CANDIDATES` (placeholders, then
  structural fallbacks: any ARIA grid, a table that calls itself a grid, the
  only table on the page);
- reads the **header row** and identifies each column by its heading text
  against the aliases in `GRID_COLUMNS`. A heading that is a dropdown (the
  two seal headings on the live portal are `<select>`s of seal types) is read
  as the option it shows, never as its option list (`readHeaderCell`); exact
  matches claim their columns before any prefix match can, so a "Seal Type"
  column cannot take Shipper Seal # away from the heading that says so. A
  column is never identified by position; one it cannot identify is reported
  and its cells are left alone;
- reads the existing data rows (`<tbody> <tr>`, or `[role=row]`);
- writes package container *i* into row *i*: container number, carrier seal,
  shipper seal, cargo description, marks, HS code, package type, package
  count, gross weight, each through `setInttraFieldValue`, each read back;
- reports per cell: `verified`, `filled` (reformatted), `failed` (read-back
  disagrees), `skipped` (no value in the package), `unresolved` (no writable
  control), `warning` (an existing different value, left alone unless
  overwrite is on);
- never presses Add Row. With fewer rows than containers it fills the rows
  that exist and says how many to add.

The summary the panel shows:

```
Containers filled: 3 / 3   Verified cells: 13   Warnings: 0   Failed: 0   Unresolved: 0
```

### The paste block

`gridPasteBlock(package, detection)` is what **Copy rows** puts on the
clipboard, in both helpers, and on the live portal it is the route:

1. one cell per grid column, in the grid's own order when a grid was detected
   and in `GRID_COLUMNS` order otherwise; blank where the package has nothing
   for a column, and blank where the column could not be identified. A paste
   is positional, so a column left OUT of the row would shift every value
   after it one column to the left;
2. starting at the Container Number column, which is the cell the operator
   pastes into; anything left of it is not in the block;
3. a line break or tab inside a value becomes a space, so one container stays
   one row;
4. every row cut at the right-most column that holds a value in ANY row, and
   padded to that width, so nothing right of the last value is overwritten
   with blanks. Columns inside the width that are empty ARE pasted blank,
   which is why the paste goes into the first empty row;
5. `\t` between cells, `\r\n` between rows, no trailing newline.

It also says what it did: the headings pasted in order, which of them are
blank because no package column feeds them, and whether the order is the
grid's or the default. The panel and the popup show that beside the paste
instruction. For the manifest of 2026-09-17 against the live header row the
first two rows are:

```
TLLU7564971<TAB><TAB>UL-8546727
TGBU7182073<TAB><TAB>UL-8546730
```

Carrier Seal # is blank because an unattributed seal is the shipper's
(`docs/DECKHAND.md`), and the block stops at Shipper Seal # because nothing
to its right holds a value.

## 4. Data ownership on the INTTRA screens

| INTTRA field | Source in the package |
| --- | --- |
| Booking Number | Deckhand, confirmed by QuickBooks when both carry it |
| Shipper's Reference | Deckhand shipment reference, else the invoice number |
| Carrier | QuickBooks |
| Vessel, Voyage, POL, POD | Deckhand |
| Container Number, Carrier Seal #, Shipper Seal # | Deckhand, one row per container |
| Cargo Description, HS Code | QuickBooks, attributed per container only when that needs no guess (one line, or one container) |
| Gross Weight | QuickBooks total, only for a single container; otherwise left for the operator |
| Package Type, Number of Packages, Marks & Numbers | manual: no source holds them |
| Consignee name and address | QuickBooks bill-to |
| Freight Terms | QuickBooks |
| Notification emails, shipper and notify parties, print options | never filled |

Nothing is invented. A missing value is shown as missing and typed by hand,
in the Package tab (where it is recorded as manual) or in INTTRA.

## 5. Operating it

1. `npm run build:inttra`, then `chrome://extensions` -> Developer mode ->
   Load unpacked -> `dist-inttra/`.
2. Open the panel (toolbar icon -> Open full panel). **Import** a
   `filing-package.json` from the ACE Helper's Package tab or from
   `ace-export package`; or paste the carrier's email into **Deckhand**,
   approve it, and **Build filing package**.
3. The Package tab shows every value with its source. Resolve any conflict.
   The header says "Ready" when the Deckhand half is approved and no material
   conflict is open; until then Fill is disabled.
4. In INTTRA, open General Details. In the helper, **Fill INTTRA -> Fill
   Current Page**. Review, then continue in INTTRA yourself.
5. On Container & Cargo, pick the container in the helper and fill; repeat per
   container. Or, on Copy Container Details, add the rows in INTTRA and press
   **Containers -> Copy rows** and paste, or **Fill Container Grid** when the
   cells can be typed into.
6. Print Instructions and B/L Documents: Fill Current Page fills the freight
   terms and the consignee. Notification Emails: nothing is filled.
7. Read every field. Save, continue and submit in INTTRA.

Diagnostics -> **Run detection on the INTTRA tab** shows which screen was
detected, which fields resolved, and what the grid looks like, and it lists
what to capture.

## 5a. First live contact, 2026-09-17

An operator opened the Quickfill Helper on the real portal. Nothing here is a
DOM capture - it is what was **read off the screen** - so no candidate below is
marked `verified(...)`. What it settles:

| Fact | Was | Now |
| --- | --- | --- |
| Hostname | unconfirmed | **`ship.inttra.e2open.com`** - already covered by the manifest's `https://*.e2open.com/*`, which is why the content script loaded at all |
| URL shape | unknown | `/siact/siworkspace#/create/<numeric id>`. Note it carries **no screen name**, so `urlHints` can contribute nothing on this portal |
| Copy Container Details | assumed to be a step | a **MODAL** over whichever step the operator was on |
| Its grid headings | guessed | `Container Number`, `Carrier Seal #`, `Shipper Seal #`, ..., `HS Code`, read off the screen and matched by `GRID_COLUMNS` header aliases. The two seal headings are **dropdowns** of seal types (confirmed by the operator on the fourth run, below); their outerHTML is still uncaptured |
| Its buttons | unknown | `Create Containers`, `Reset`, `Cancel`. The helper presses none of them |

**The consequence, and the fix already made.** Because the grid is a modal, the
step strip *behind* it still reports the underlying step: on the first run the
popup said "B/L Documents" while a container grid filled the screen. Page
detection by tab wording therefore cannot identify this screen. Quickfill's
content layer was the first to stop asking it, by calling `detectGrid(document)`
and letting the presence of a grid settle the matter; since the fourth run
(below) `detectInttraPage` itself scores the grid, so the INTTRA Helper's panel
and the popup answer alike.

**A second run, same day, found the next layer.** With the paste fixed, the
popup still offered "Fill this screen" for the step behind the modal: the grid
was never found. `GRID_ROOT_CANDIDATES` asks "is there exactly one element
matching this guess?", and on this workspace every rung fails - the guessed ids
and attributes are not there, and the last-resort `table` matches several,
because the modal is drawn over a workspace that has tables of its own.
Requiring exactly one match therefore rejected the page's only real grid.

`findGridByHeadings` is the fallback: every grid-shaped element on the page is
scored by how many `GRID_COLUMNS` its header row identifies, and the best one
wins provided it has a Container Number column. A container grid is the thing
whose headings say so, which is true whatever the ids are, however many other
tables are on the page, and whether it is a modal or a step. Ties go to the
innermost candidate so a grid nested in a layout table is not beaten by its
wrapper. Both extensions get this, because they share `gridWriter.ts`.

**A third run settled the cells: they cannot be typed into.** With the grid
found, `Fill container grid` reported `Filled 0 of 9`, every cell unresolved -
`resolveInttraControl` found no writable control in any of them. The grid holds
no input until a cell is clicked; it opens an editor then. No selector fixes
that, because until the click there is nothing in the DOM to select.

The way in is the one the screen is named after. **Copy Container Details
exists to have a block of rows pasted into it**, and `gridRowsAsTsv` already
produces exactly that block - now in the grid's own column order, because the
grid is detected. So Quickfill offers **Copy rows** beside Fill container grid,
and says to use it when every cell comes back unresolved. The INTTRA Helper has
had the same button since before any of this; Quickfill was the one missing it.

This is the screen used as intended rather than a workaround, and it keeps the
policy intact: the helper puts rows on the clipboard, the operator clicks the
cell and presses paste. Nothing is pressed on their behalf.

And because Fill can never write one cell of such a grid, Quickfill asks first
(`gridAcceptsTyping`) and offers **Copy rows first** when the answer is no.
Leading with a button that cannot work costs a click and a sentence every time.
Fill stays on the screen: a grid that answers wrongly must not become a grid the
operator cannot fill.

**The first captured INTTRA selectors, 2026-09-17.** Read off the DevTools
Elements panel on the live Copy Container Details modal, so these are
`verified(...)` rather than wording:

```html
<div id="siCopyContainerWrapperDiv" class="preLoaderWrapper">
  <div class="preLoaderMask" id="preLoaderMaskSiCopyContainer" style="display: none;"></div>
  <div class="preLoader" id="preLoaderSiCopyContainer" style="display: none;"></div>
  <div class="row"> ... bootstrap columns ... </div>
  <div id="editableGridWrapper" class="col-sm-12 pushdown10"> [the grid] </div>
  <div class="modal-footer"> ... </div>
</div>
```

| Captured | Used as |
| --- | --- |
| `#siCopyContainerWrapperDiv` | the modal root: a page-signature marker, and a grid-root scope |
| `#editableGridWrapper` | the grid container: the first `GRID_ROOT_CANDIDATES` rung |

Two consequences. The screen is now identified by its own id rather than by a
tab strip that names the step the modal covers - and because a captured marker
and a guessed tab reading both scored 4, the two tied and a tie is reported as
`unknown`, which is how a screen with the grid on it came back "not one of the
Shipping Instructions screens". Structure now scores 10 (`EVIDENCE` in
`pageDetector.ts`): a captured marker, provided it is visible, or the container
grid itself found by its headings. Tab, heading and URL hints are guessed
wording worth 4, 3 and 2, so all three together cannot beat one structural
fact, and on this screen that wording is not weaker but wrong. A marker that is
in the DOM but hidden counts for nothing, so a modal the portal keeps hidden
while closed cannot identify every screen as itself.

The name is also the answer to the cells. `editableGrid` renders text and swaps
in an editor when a cell is clicked, which is exactly the `Filled 0 of 9, all
unresolved` result, and confirms Copy rows as the route rather than a fallback.

**A fourth run, same day, with the captured ids in the build.** The INTTRA
Helper loaded from the CI artifact of the merge that carried the two captured
ids, and with the modal open its panel still read "B/L Documents (low
confidence)" and refused the grid; Quickfill, in the same browser, found the
grid and offered Copy rows. So the ids alone did not identify the modal in the
document that answered the panel. Whether that is because they do not resolve
as captured, or because the panel was answered by another tab or frame, the
screenshot could not say. Three changes, so that it cannot happen the same way
again:

- the grid is the evidence. `detectInttraPage` scores a visible container grid
  found by its headings as structure, the same 10 as a marker, so the modal is
  identified by the thing that is demonstrably on it. Both helpers call the
  same detector, so they answer alike;
- the panel says which tab it addressed (its title, in the header), prefers
  an INTTRA tab in its own window, and every build says which build it is
  (`build <version>+<commit>.<time>` in the header, from `version_name` in the
  dist manifest, written by `scripts/buildStamp.mjs`);
- the content script answers the panel at once from a frame that holds the
  grid or a visible marker, and after a moment from a frame that holds
  neither, so with the helper in every frame of the tab the frame with the
  screen is the one whose answer the panel keeps.

The same run settled the seals. Copy rows, pasted into the first Container
Number cell, filled the container numbers and left both seal columns empty.
Carrier Seal # empty is right: an unattributed `SEAL#` column is the
shipper's. Shipper Seal # empty had two causes, both in code shared by the
two helpers. The two seal headings are **dropdowns** of seal types, and a
`<select>` read as `textContent` is every option run together, so the second
seal column matched nothing; and a column that matched nothing was left OUT of
the pasted row rather than pasted blank, so every value after it shifted one
column to the left. `readHeaderCell` now reads a dropdown heading as the option
it shows, and `gridPasteBlock` pastes one cell per grid column (section 3, "The
paste block"). Neither helper's Copy rows had a test with an unidentified
column in the middle of the row; both have one now.

Still not captured, and still placeholders: every field selector on the other
screens, the grid's header row (the seal dropdowns with their options), and the
grid's cell editors. Section 6 remains the procedure. Capturing a cell *while
it is being edited* is what would make typing into the grid possible; until
then, pasting is not a fallback but the route.

## 6. The live procedure: capturing the real selectors

Do this once, on the first attended session, with a Shipping Instruction open
for a shipment that is going to be filed anyway.

**For every screen** (General Details, Container & Cargo, Copy Container
Details, Print Instructions, B/L Documents, Notification Emails):

1. Note the exact hostname in the address bar.
2. Right-click the highlighted step in the step strip -> Inspect -> right-click
   the element -> Copy -> **Copy outerHTML**. Paste into a text file named
   after the screen.
3. The same for the screen's heading.
4. For every box the helper fills on that screen (section 4): the control's
   outerHTML and its `<label>`. For a dropdown, also two `<option>` tags. For
   a type-ahead (ports, carrier), the box plus one selected value.
5. For B/L Documents, also the Consignee panel's heading, so writes can be
   scoped to it and not to the shipper or notify party.

**For Copy Container Details**, in this order:

1. the grid root element (the outermost `<table>`, or the element with
   `role="grid"`);
2. the header row, with every column heading, including the two seal-type
   dropdowns: the whole `<select>` with all its `<option>`s and which one is
   selected;
3. one empty data row;
4. one populated data row;
5. a cell while it is being edited (click into it, then Inspect);
6. the Container Number cell;
7. the Carrier Seal # cell;
8. the Shipper Seal # cell;
9. the Cargo Description cell;
10. the HS Code cell;
11. the Package Type cell (and, if it is a dropdown, two of its options).

Also note: a paste of tab-separated rows into the first Container Number cell
of an existing row took on 2026-09-17 (the container numbers landed). Still
open: does it add rows on paste, or must rows exist first, and does a value
pasted under a heading that is a dropdown land under the option shown?

**Installing what was captured**, without a rebuild: Diagnostics -> INTTRA
selectors -> paste JSON in the shared override format and Save:

```json
{
  "version": 1,
  "capturedAt": "2026-10-02",
  "fields": {
    "BookingNumber": [{ "strategy": "id", "selector": "#siBookingNo" }],
    "Vessel": [{ "strategy": "name", "selector": "input[name='vesselName']" }]
  }
}
```

Overrides are tried first; the placeholders stay behind them. **Making them
permanent** means replacing the `placeholder(...)` candidates in
`inttra-extension/src/mappings/*.ts` with `verified(...)` ones and the
guessed `byLabel([...])` wording with what the screen shows. Never mark a
candidate verified that was not read off the live DOM.

For the grid, the captured root goes into `GRID_ROOT_CANDIDATES` and the real
headings into `GRID_COLUMNS[].headerAliases` (normalized: lower-case, letters
and digits only). If a cell turns out to be a click-to-edit widget, that is
the point at which to decide, in a conversation rather than a pull request,
whether `setInttraFieldValue` should learn to open it or the TSV paste path is
the way that grid gets filled.

## 7. What still needs live testing

- The hostname of the SI screens, against the two manifest patterns.
- Every page signature: tab wording, headings, URL fragments.
- Every field selector on every screen.
- Whether dropdowns are native `<select>`s or widgets; whether ports are
  type-ahead controls and what a typed value does to them.
- The grid: its header row's outerHTML (the seal headings are dropdowns), its
  cell editors, row addition, and paste behaviour beyond the one paste that
  took. Also a trade-off in detection: any visible table headed Container
  Number now reads as Copy Container Details, so a Container & Cargo screen
  that listed containers in a table would too; nothing is lost while its field
  selectors are placeholders, but it wants checking on the live screen.
- Whether INTTRA's own validation accepts a value written through the native
  setter plus `input`/`change`, or wants a key event sequence; the writer
  dispatches `keyup` as well, and the read-back will say if a value was
  reverted.
- The unit of Gross Weight and the format of HS Code (six digits with or
  without the dot).

Until these are done the helper will report most fields as "not found" on a
real screen, which is the designed behaviour: a field that does not resolve
is never written.
