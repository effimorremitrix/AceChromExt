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
"permissions": ["storage", "sidePanel"],
"host_permissions": ["https://*.inttra.com/*", "https://*.e2open.com/*"]
```

`sidePanel` buys a surface and nothing else, and it replaced the action popup
rather than adding to it: the manifest has no `default_popup`, and the toolbar
icon opens `sidepanel.html` docked beside the portal. Chrome destroys a popup
on its first loss of focus, which on Create Shipping Instruction is the first
click into the form. `docs/ARCHITECTURE.md`, "The one UI surface".

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
  ui/                          the side panel: every screen, one surface
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

- finds the grid root through `GRID_ROOT_CANDIDATES` (the two captured ids,
  then placeholders and structural fallbacks: any ARIA grid, a table that
  calls itself a grid, the only table on the page); failing every rung, the
  grid-shaped element whose headings say it is a container grid
  (`findGridByHeadings`); and failing that, the header row found by its
  **wording alone**, whatever it is built from (`findHeaderRowByText`): from
  the words "Container Number" wherever they appear as visible text, climbing
  to the smallest row of cells that identifies that column and at least one
  more. The live grid is neither a table nor an ARIA grid (section 5a, fifth
  run), so that last rung is the one that finds it. A grid found that way is
  read as a `divGrid`: its rows are the visible elements under the header
  row's ancestors with exactly as many cells as the header has. Open shadow
  roots are searched; a form row of labels over inputs never counts;
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
grid's or the default. The Containers screen shows that beside the paste
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
2. Open the side panel (toolbar icon). **Import** a
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
| Its grid headings | guessed | `Container Number`, `Carrier Seal #`, `Shipper Seal #`, ..., `HS Code`, read off the screen and matched by `GRID_COLUMNS` header aliases. The two seal headings are **dropdowns** of seal types (confirmed by the operator on the fourth run, below); their outerHTML is still uncaptured. The grid itself is **neither a `<table>` nor an ARIA grid** (fifth run, below), so it is found by the wording of its header row |
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

**A fifth run, same day, with the fourth run's fix in the build** (`build
0.1.0+bd7334c`, confirmed in the header). Modal open, rows added, grid empty.
The INTTRA Helper's pill read "INTTRA screen not identified"; its Copy rows
fell back to the default column order and said so; the paste still lined up,
because the default order (Container Number, Carrier Seal #, Shipper Seal #)
is the live grid's first three columns. Quickfill, on the same screen, read
the paste and then offered **nothing**: "This INTTRA page is not one of the
Shipping Instructions screens." The difference between the two helpers was
the fallback, not the detection: neither had found the grid.

Diagnostics said why, rung by rung: every selector rung 0, `table` **2**,
"with a Container Number heading" **0**. Two tables were visible to the
helper and neither was the grid, and neither captured id held a table. The
merged bundle was then run in a real Chromium against three mocks of the
modal (a plain table with the seal dropdowns; an `editableGrid`-style header
with a table inside every heading cell; a header table over a body table): it
found all three, so the code was not the cause, and neither was visibility
(`checkVisibility` answered true). What remains is the markup: the grid the
operator pastes into is **not a `<table>` and not an ARIA grid**, so nothing
that looked for one ever looked at it. The third run's "grid found" was most
likely another table, one this shipment does not have. Whether the captured
ids hold the grid, or hold nothing on this modal, the screenshot could not
say.

Three changes:

- the grid is found by the **wording of its header row**, whatever it is
  built from (`findHeaderRowByText`, section 3): from the words "Container
  Number" wherever they appear as visible text, the smallest row of cells
  around them that identifies that column and at least one more is the
  header row, and a grid found that way is read as a `divGrid`. Open shadow
  roots are searched too. A form row of labels over inputs (the Container &
  Cargo step) is never taken for one. The detector, both content scripts and
  the grid writer go through `findContainerGrid`, so the pill, the buttons
  and the paste block still agree;
- Quickfill offers **Copy rows alone** on an INTTRA page it cannot name, in
  the default column order, and its result line says so; the INTTRA Helper
  already did. Nothing else is offered there, because nothing else can be
  filled without a screen;
- Diagnostics carries a **Page structure** block (`structureProbe.ts`): which
  frame answered and the frames inside it, whether each captured id is
  absent, hidden or visible, and for the words "Container Number" wherever
  they appear as text, the chain of elements above them and the cells beside
  them at each level, read as headings would be. Every grid rung now also
  says how many elements it matched before the visibility filter. Together
  these are the capture that section 6 asks for, without DevTools, which the
  operator's browser refuses to paste into.

If the wording rung takes on the live grid, both helpers name it Copy
Container Details and paste in its order; if it does not, Copy rows still
works in the default order, and the Page structure block says what the grid
is made of, which is the next thing to read. The rung has run against mocks
of that shape only.

## 5b. Second live contact, 2026-09-20: the container blocks

The operator captured the container controls from the live DOM. This is the
first time any INTTRA FIELD selector has been read off the real portal, and it
changed three things.

**One page, not six screens.** Create Shipping Instruction
(`#/create/<draft id>`) is a single long page: General Details, the routing
(Vessel, Voyage, IMO, Origin, Port of Load, Port of Discharge, Destination,
Move Type, Shipment Type), Customs Compliance, House B/L, Cargo
Identification Numbers, and then **Particulars**, which repeats a block per
container: Container N (number, type, seals, tare weight) beside Cargo N and
its Cargo Gross Weight and Volume. There is no separate Container & Cargo
screen, so `INTTRA_MAPPINGS_BY_PAGE` serves both the shipment scope and the
container scope on `generalDetails`; `containerCargo` stays as the workflow's
own name for the block.

**The row number is in every id.** Container N's controls all carry the same
`-N` suffix, numbered from 1 upward, and `id` and `name` hold the same string:

```html
<input class="form-control input-sm cont-num-1"  id="cont-num-1"  name="cont-num-1"  maxlength="11" placeholder="Enter Number...">
<input class="form-control input-sm carr-seal-1" id="carr-seal-1" name="carr-seal-1" maxlength="79" placeholder="Enter Number(s)...">
<input class="form-control input-sm ship-seal-1" id="ship-seal-1" name="ship-seal-1" maxlength="79" placeholder="Enter Number(s)...">
<label for="carr-seal-1" id="carr-seallbl-1" class="carr-seal-numlbl">Carrier Seal Number(s)</label>
<label for="ship-seal-1" id="ship-seallbl-1" class="ship-seal-NumLbl">Shipper Seal Number(s)</label>
```

So a container-scoped selector is written ONCE with `{n}`, the row token
(`src/ace/selectors/overrides.ts`), and `mappingsForRow`
(`inttra-extension/src/content/filler.ts`) substitutes the row before the
detector runs. Pasted overrides may use it too; the paste-time CSS syntax
check runs on the substituted form, because `{n}` is not valid CSS.

Three consequences, and each one is a rule rather than a detail:

- **The class is never the selector.** `class="... cont-num-1"` is identical on
  every row, so it matches them all and the detector refuses the write as
  ambiguous. The id carries the row; the class does not.
- **Beyond row 1, a candidate with no row number is dropped, not tried.**
  Every draft carries a different number of containers. Filling container 2 on
  a draft that has one block would otherwise fall through the ladder to the
  label "Container Number", match the one control on the screen, and write
  container 2 into container 1's box. A selector that cannot name a row cannot
  be aimed at one.
- **A row the draft does not have is reported by its number.** The helper never
  presses Add Container (`automationPolicy.ts`), so the report says which row
  is missing and the operator adds the block in INTTRA.

**Seals take 79 characters, and the label says "Number(s)".** INTTRA accepts
several seal numbers in one box, so nothing truncates a seal at 15 any more,
on the form or in the grid paste block.

Both helpers therefore fill container rows in one press: **Fill all
containers** in the panel, and the single container button in Quickfill, which
walks every block because the count differs per draft. The single-container
fill stays for a correction.

**The grid, seen properly at last.** Copy Container Details is opened by the
link **"Copy container details from spreadsheet"** at the top right of
Particulars. The modal carries two controls ABOVE the grid that apply to every
row: Container Type, and Unit of Measure (Weight, Volume). The header row
reads Container Number | Carrier Seal # | Shipper Seal # | Cargo Description |
Marks & Numbers | HS Code, with more columns behind a horizontal scrollbar,
which is the order `GRID_COLUMNS` already had. Its buttons are Reset, Create
Containers and Cancel, and the grid renders after a spinner, so press refresh
in the helper once it is on screen. A weight cell is therefore a bare number
in the unit chosen above the grid, and the unit is the operator's to set.

What is still NOT captured on the container block: Container Type, Package
Count and Type, Cargo Gross Weight and its unit, Cargo Gross Volume, tare
weight, and everything on the other screens.

## 5c. Third live contact, 2026-09-20: the screen had no name

The operator loaded the build with the captured container selectors, opened a
real draft, and the panel header read **"INTTRA screen not identified"**. Fill
was blocked before a single selector was tried: the detector returns `unknown`
and the UI refuses to fill on an unnamed screen, which is the designed
behaviour and was, here, the wrong answer.

Reproduced against a page shaped like that draft: **two signatures matched a
heading and scored equally**, and an equal score read as ambiguity.

```
generalDetails  score 3  Heading reads "general details"
containerCargo  score 3  Heading reads "container details"
-> Ambiguous page, confidence none, Fill blocked
```

Which is the same fact as section 5b seen from the other side: it is ONE page.
"General Details" and the container blocks are sections of the create page, so
both signatures matching is not a contradiction to be reported, it is the
create page being itself. Two changes, and either one alone would have named
the screen:

- **The create URL is now captured.** `siworkspace#/create` was copied from the
  live address bar (`ship.inttra.e2open.com/siact/siworkspace#/create/<draft
  id>`), so the page scores the URL rung as well and no longer ties. The edit
  and amend URLs are still uncaptured.
- **A tie between `generalDetails` and `containerCargo` resolves to the create
  page** rather than to `unknown`, because the mappings serve both scopes
  there, so naming it loses nothing. Every other tie is still reported as
  unidentified.

The signature's label is now **Create Shipping Instruction**, which is what the
portal calls the page; the page id stays `generalDetails`, because stored
packages, the dashboard and override files already speak it.

What is still not known: WHICH of the two causes produced the live message.
The panel's Diagnostics has the answer (**Run detection on the INTTRA tab**,
then the "Page detection evidence" block, or **Export diagnostics**), and it
was not captured on that run. Both causes are handled, and the evidence block
is worth reading on the next live run anyway, because it also says whether the
page's section titles are real headings or styled `<div>`s: the detector reads
`h1`-`h6`, `legend` and `role="heading"` only.

One known rough edge, unchanged by this: a page whose heading merely says
"Shipping Instruction", such as the workspace list, can be named the create
page. Naming a screen writes nothing, so every field is simply reported as not
found; sharpening it needs the list page's own heading, which is uncaptured.

## 5d. Fourth live contact, 2026-09-20: the first real diagnostics

An operator exported Diagnostics from the live draft
(`siworkspace#/create/1789899643548`). It is the first field-by-field answer
from the real portal, and it corrects one thing this document said.

**Detection, and what really fixed it.** The create page now scores **15**:

```
Heading reads "general details"          3
URL contains "siworkspace#/create"       2
Marker #generalDetails present and visible  10
```

So `#generalDetails`, shipped as a guessed marker, is **real on the live
page**, and the marker alone outscores every other signature. A tie could not
have happened on this document, which means section 5c's fix is not what
unblocked it: the tie-break and the URL are sound and stay, but the "screen
not identified" of the third run was most likely a **timing or frame** answer,
the page not yet drawn when the panel asked. The structure probe shows three
frames on the page (`(no src)`, `(no src)`, `about:blank`). If it returns,
press refresh in the header and note whether it clears on its own.

**Which fields resolve, live.** From the same export:

| Field | Live result |
| --- | --- |
| Vessel | FOUND by `#vessel` |
| Voyage | FOUND by `#voyage` |
| Port of Loading, Port of Discharge | FOUND by label |
| Cargo Description, HS Code, Gross Weight, Marks & Numbers | FOUND by label, inside the container block |
| Carrier Seal, Shipper Seal | FOUND by the captured label "Carrier/Shipper Seal Number(s)" |
| Booking Number | AMBIGUOUS: the label matches 2 controls |
| Carrier | AMBIGUOUS: `[id$='carrier']` matches 2 |
| Shipper's Reference, Package Type, Number of Packages | NOT_FOUND |

Two guessed ids, `#vessel` and `#voyage`, turn out to be real. They are still
carried as placeholders here, because a guess that happens to match is not a
capture: copy them from the live DOM and they can be marked verified.

**A diagnostics gap the export exposed.** The three captured container
selectors reported `#cont-num-{n}` -> 0 matches, which reads as "the capture
does not work". It was diagnostics asking the wrong question: nothing
substituted a row, so the token was probed literally. Diagnostics now probes
**row 1** and says so on each container field; the fill path already
substituted the row of the container being filled.

**The live container block, from the structure probe.** Worth having when the
next selectors are captured:

```
div#containersListView-1.containersListView.ng-scope
  div#container-row-1.row
    div.well.col-sm-3.infin-well-create-si      "Container 1"
      span#cont-num-1Lbl  "Container Number"
      ... Container Type, Reefer Settings, Container Supplier,
          Container Tare Weight (Kgs), Wood Declaration,
          "Carrier Seal Number(s) (Up to 5, comma-separated)",
          "Shipper Seal Number(s) (Up to 5, comma-separated)"
```

`#container-row-{n}` and `#containersListView-{n}` are row-numbered too, so
either is a scoping root if one is ever needed.

**Two rules INTTRA states itself**, read off the Copy Container Details
instructions in the same export:

- "A maximum of **15 characters** will be allowed per entry of Container
  Number and Seal Number" - in the GRID. The form's seal box takes 79 and
  says "Up to 5, comma-separated", so the two screens do not agree, and the
  paste block still carries the whole value rather than cutting it: a cell cut
  at 15 would silently drop the second seal of a pair, which is worse than a
  value INTTRA rejects in front of the operator.
- "Space and dash (-) in the Container Numbers will be removed when you click
  Create Containers", which is INTTRA doing what `normalizeContainerNumber`
  already does.

## 5e. Fifth live contact, 2026-09-20: a whole fill, recorded

A full attended run on the live draft `siworkspace#/create/1789904042068`,
with a three-container package whose first container was the only one INTTRA
had a block for. It is the first end-to-end recording, and it answered five
things no fixture could.

### The seven header fields

| Field | Live result | What it was |
| --- | --- | --- |
| Vessel, Voyage | filled | fine |
| Port of Loading, Port of Discharge | written, then `the control now reads ""` | a **type-ahead** |
| Booking Number | 2 controls matched the label ladder | the ladder asked four wordings at once |
| Carrier | 2 controls matched `[id$='carrier' i]` | the suffix is too loose |
| Shipper's Reference | nothing matched | still uncaptured |

**The ports are look-ups.** INTTRA validates the typed text against its own
location list and empties the box for anything not chosen from the
suggestions. Two events make it do that: `change`, and the `blur` that comes
from focusing the next field. `PortOfLoading` and `PortOfDischarge` are now
`type: 'lookup'`, which means the helper writes the text and raises
**neither** - and does not focus the box either, because focusing the field
after it is what blurs this one. The value stays visible in the box, the
outcome is a warning that says to pick the match, and it names the UN/LOCODE
(`USOAK`) as the quickest search. The helper still presses nothing.

**Booking Number was our own ladder.** The live label reads **"Carrier
Booking Number"**, in the Carrier panel, above `References (multiples allowed
ex. 371, 425)`. The screen also carries a plain "Booking Number" elsewhere, so
`byLabel(['Booking Number', 'Booking No', 'Carrier Booking Number', ...])` -
one query, four acceptable answers - matched both. Every label rung now
carries **exactly one wording** (`labelLadder`, `mappings/types.ts`), tried
most specific first, and `tests/inttra.test.ts` pins it. Nothing is chosen
between: a rung whose own wording matches two controls is still refused.

**Carrier, and every other ambiguity, now names its matches.** "2 controls
matched" is a dead end: it names neither control, so the operator cannot write
an override. The detection result carries `ambiguousMatches` - tag, id, name,
label, placeholder, one line per control - and the fill report prints them
under the outcome, ready to paste into Diagnostics -> selector overrides.

### One label over two controls

The live Cargo block heads a count box **and** a type dropdown with the single
label **"Package Count/Type (Outermost)"**. No label match there can ever be
one control, which is why Package Type and Number of Packages had never
resolved. The detector now keeps the match of the kind the mapping declares
(`controlKind`, derived from the field type): a `select` field takes the
dropdown, a `number` field takes the box. This is the one narrowing allowed
among several matches, it is a fact about the control rather than its
position, the confidence is degraded, and the outcome says so. Anything else
is still AMBIGUOUS and still refused.

### "Field cannot contain decimal points."

INTTRA's own message, under the HS Code box, against the package's derived
`0802.12`. The canonical value keeps its dot - it is how a tariff code is
written - and the separators come off at fill time (`hsCode` transformer,
`src/ace/transformers/codes.ts`), on the form field and in the grid paste
block alike. Beside it the live screen carries a separate **Schedule B
Number** box, which nothing in the filing package feeds yet.

### What the live Particulars block is called

Every wording below was read off the screen and is now in the ladders. None of
these is a capture of an **id**, so each one only ever resolves **row 1**:
beyond it `mappingsForRow` drops any candidate that cannot name a row, and the
outcome now says exactly that instead of blaming INTTRA for a missing block.

```
Container N   Container Number, Container Type, Add Reefer Settings,
              Container Supplier, Container Tare Weight (Kgs),
              Wood Declaration,
              Carrier Seal Number(s)   (Up to 5, comma-separated)
              Shipper Seal Number(s)   (Up to 5, comma-separated)
              [Add Container Details]
Cargo N       Package Count/Type (Outermost), Print on B/L as, HS Code,
              Schedule B Number, Cargo Description, NCM Code(s),
              Marks & Numbers, CUS Code
Cargo Gross   Cargo Gross Weight (Cargo + Packaging) [Kgs],
  Weight &    Cargo Gross Volume (Cargo + Packaging) [Cbm],
  Volume      Cargo Actions, Container Actions
```

The Carrier panel, in General Details: `Carrier` (a dropdown reading "Select
One"), `Carrier Booking Number`, `References`. Around them: Shipper,
Forwarder, Consignee, Notify Party, then Cargo Identification Numbers (PCIN,
CSN, ACID Number/MCIN), Customs Compliance (Government Tax IDs, EORI) and the
ICS2 Entry Summary Declaration.

### The grid: found, and then a dead end

Copy Container Details opened, the grid drew, and detection got it right -
the panel read **"This is the Copy Container Details grid: use the Containers
tab."** Then nothing happened, because that sentence was small grey text under
four disabled buttons. Detection was never the problem; the route was.

The Fill tab now leads instead of explaining: on the grid page it shows a
notice saying the cells hold no control until they are clicked, and a primary
**Go to Containers** button. The Containers tab spells the route out in five
numbered steps, ending at Create Containers, which the operator presses.

The live header row, for the record:

```
*Container Number | Carrier Seal # (dropdown) | Shipper Seal # (dropdown)
| Cargo Description | Marks & Numbers | HS Code | ... (horizontal scroll)
```

Above it: `Container Type`, and `Unit of Measure` (Weight `Kgs`, Volume
`Cbm`). Below it: `Reset`, `Create Containers`, `Cancel`.

### Still open after this run

- No **id** was captured on this run, so every field above that resolves by
  wording resolves row 1 only. The five cargo fields need ids in the shape the
  seals have (`-{n}`) before containers 2 and 3 can be filled from the form.
- Shipper's Reference is still unmapped. It is probably the Carrier panel's
  `References` block, which is a repeating type-and-value pair, not a box;
  capture the whole block before mapping it.
- Cargo Gross Weight came back FOUND in diagnostics and empty on the screen
  after the fill. The captured wording `Cargo Gross Weight (Cargo + Packaging)`
  is now first in its ladder; watch it on the next run.
- The paste into the grid was never performed, so the paste block has still
  never met the live grid.

## 5f. The Errors panel, 2026-09-20: a font that is not ours

After the section 5e build was loaded, `chrome://extensions` showed a red
**Errors** button on the INTTRA Helper. The entry is a warning, not an error,
and it reads:

```
⚠ Failed to decode downloaded font:
  https://ship.inttra.e2open.com/siact/css/fonts/opensans/OpenSans_600.woff
Context:     https://ship.inttra.e2open.com/siact/siworkspace#/create/...
Stack trace: inttraContent.js
```

**The font is INTTRA's**, served from INTTRA's own host, and the helper has
never asked for it: nothing in this repository references a `.woff`, an
`@font-face` or a remote font, and the manifest's CSP is `connect-src 'none'`.
The file itself is what is broken; the page falls back to another face and
carries on.

**Why our name was on it.** Two things of ours met:

1. `src/content/highlight.ts` appended a `<style>` element to the page for a
   transition and a pulse keyframe. A stylesheet added to a document
   invalidates that document's style.
2. The detector forces that work to run **synchronously** a moment later:
   `isVisible` calls `getClientRects()` and `getComputedStyle()` on every
   candidate it tries, and `isInttraVisible` calls `checkVisibility()`. Each
   is a forced style flush, and a fill does hundreds of them.

So the page's own pending style and font work was processed inside our call
stack, and Chrome attributed the console warning to the script on top of it.

**What changed.** The stylesheet is gone. The transition is an inline style
like the rest of the highlight's snapshot, and the pulse is an
`Element.animate` call on the one element, which needs no `@keyframes` rule
and so no stylesheet. The content layer now adds nothing to the page's
stylesheets at all, and `tests/invariants.test.ts` fails the build if that
changes. The calculator keeps CSS of its own and always did the right thing
with it - it lives in a shadow root.

**What this does not fix.** The forced style reads stay, because knowing
whether a control is visible before writing to it is the point of them. A
page whose own CSS is still loading can therefore still surface its own
warnings through our stack. What is fixed is that we no longer hand it
anything of ours to process, and the font itself is INTTRA's to repair.

## 6. The live procedure: capturing the real selectors

Do this once, on the first attended session, with a Shipping Instruction open
for a shipment that is going to be filed anyway.

**The template asks for what is left.** Diagnostics -> INTTRA selectors starts
you off with a JSON stub per field, and since 2026-09-21 it leaves OUT any
field whose selector was already captured and built in: on that day it printed
`#REPLACE_WITH_THE_ID_FROM_INTTRA_FOR_ShipperSeal` over a build that ships
`#ship-seal-{n}`, captured from the live DOM the day before, with the operator
looking at that exact box. Asking again for work that is done reads as the
capture never landed. The line above the box names what is already in, and the
count beside the heading is the number of fields that **still need an id**.

That count is larger than the "placeholders" number quoted elsewhere, and the
difference is the point: a captured LABEL wording is not a captured selector.
A label was read off the live screen and is worth keeping, but it cannot name a
container row, so those fields resolve container block 1 only and are still in
the template. `hasCapturedSelector` in `src/ace/selectors/overrides.ts` is the
one definition of "already captured", shared by the template and by
`fieldsWithoutCapturedSelector`.

Once a field IS captured and then stops resolving, press **Run detection on the
INTTRA tab** first. The template then asks for exactly what did not resolve,
captured or not, because a capture that stopped working is the one worth making
again.

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

1. the grid root element. It is not a `<table>` and not an element with
   `role="grid"` (section 5a, fifth run): run **Diagnostics** first and read
   its **Page structure** block, which names the chain of elements above the
   words "Container Number" and the cells beside them at each level; the
   level whose cells read Container Number, Carrier Seal #, Shipper Seal #
   is the header row, and the element two levels above it is a good root to
   copy. **Copy diagnostics** puts the whole block on the clipboard;
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
- Every page signature: tab wording, headings, URL fragments. Note that the
  create page carries General Details and the container blocks together
  (section 5b), so "which screen" is really "which section is on screen".
- Every field selector except the three container ones captured on 2026-09-20
  (section 5b). Those three have run against the mock of the captured markup,
  not yet against the live page: what is proven is the shape of the id, not a
  live write.
- What a chosen port suggestion leaves in the DOM. The ports ARE type-aheads:
  the live run wrote both and INTTRA emptied both (section 5e), so they are
  now written without `change`, `blur` or focus and reported as "pick the
  match". What has never been observed is INTTRA's own stored value after a
  suggestion is picked - capture it, and the helper could one day pre-select
  by UN/LOCODE instead of asking.
- Whether dropdowns are native `<select>`s or widgets. The Carrier control
  reads "Select One" like a native one, but no dropdown write has been seen
  to take on the live portal.
- The grid: what it is built from (not a table and not an ARIA grid, and the
  wording rung that finds such a grid has run only against mocks), its header
  row's outerHTML (the seal headings are dropdowns), its cell editors, row
  addition, and paste behaviour beyond the one paste that took. Also a
  trade-off in detection: any visible row of headings that says Container
  Number beside another known column now reads as Copy Container Details,
  table or not, so a Container & Cargo screen that listed containers that way
  would too; nothing is lost while its field selectors are placeholders, but
  it wants checking on the live screen.
- Whether INTTRA's own validation accepts a value written through the native
  setter plus `input`/`change`, or wants a key event sequence; the writer
  dispatches `keyup` as well, and the read-back will say if a value was
  reverted.
- The unit of Gross Weight. (The HS Code format is settled: INTTRA answered
  "Field cannot contain decimal points", so six digits unseparated -
  section 5e.)
- Whether the two ambiguous header fields resolve once their real ids are
  pasted into the selector overrides. The fill report now names both matching
  controls, so the capture is a copy away.
- Whether the five cargo fields in a container block carry a row-numbered id
  like the seals do. Until they do, they fill block 1 only, and the helper
  says so rather than writing into another row.

Until these are done the helper will report most fields as "not found" on a
real screen, which is the designed behaviour: a field that does not resolve
is never written.
