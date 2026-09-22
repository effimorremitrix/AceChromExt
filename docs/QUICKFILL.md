# Quickfill Helper (quickfill-extension/)

> **Status:** built, typechecked and tested against this repository's fixtures.
> It inherits the repository's verification state exactly and improves none of
> it: the ACE selectors are still mostly label matches, every INTTRA field
> selector is still a placeholder, and no dropdown write has ever run against
> a live portal. A simpler interface verifies nothing. See section 6.

A third Chrome extension. One popup, one paste box, two buttons.

```
  carrier email            ┐
  filing-package.json      ├──▶  [ paste box ]  ──▶  ACE     (you submit)
  spreadsheet rows         ┘                     └─▶  INTTRA  (you submit)
```

The ACE Helper and the INTTRA Helper are careful: they preview every value,
run ten data quality checks, show the Deckhand review, take an Approve click,
surface every conflict, and refuse to fill until a gate opens. That machinery
exists because an export filing is a legal declaration and this repository
chose to make every value's origin answerable.

Quickfill is the other trade. It assumes the operator reads the form. It has no
preview, no checks, no review, no approval, no conflict screen, no readiness
tab and no per-field report. Paste, click, look at the form, submit.

## Contents

1. [What it does, and what it still never does](#1-what-it-does-and-what-it-still-never-does)
2. [The one box](#2-the-one-box)
2a. [The two INTTRA page types, and the portal toggle](#2a-the-two-inttra-page-types-and-the-portal-toggle)
3. [What it drops, and what that costs](#3-what-it-drops-and-what-that-costs)
4. [How it shares code with the other two](#4-how-it-shares-code-with-the-other-two)
5. [Build, check, install](#5-build-check-install)
5a. [Practising without the portal: the playground](#5a-practising-without-the-portal-the-playground)
5b. [The tab that was already open](#5b-the-tab-that-was-already-open)
5c. [Pop out: the popup that stays open](#5c-pop-out-the-popup-that-stays-open)
6. [What is not verified](#6-what-is-not-verified)
7. [The dashboard, and why nothing was added to it](#7-the-dashboard-and-why-nothing-was-added-to-it)

---

## 1. What it does, and what it still never does

| Does | Never does |
| --- | --- |
| Reads a pasted email, package, extraction or rows, format detected by shape | Asks what the paste is |
| Fills the ACE step or INTTRA screen already open in the tab | Navigates, opens a tab, or changes a step |
| Overwrites a field that already holds something else | Asks first |
| Fills a container number that fails its check digit | Validates anything |
| Says "Filled 11 of 14" | Shows a report, a preview, a provenance row, or a colour-coded mark |
| Holds the paste in `chrome.storage.session` for the browsing session | Writes a shipment to disk, `localStorage`, a cookie, or a server |
| Highlights each field it wrote, so the eye finds them | Anything else |
| Offers every route the page has: the fields, the grid, the clipboard block | Hides one because the detector named the screen something else |
| Lets the operator pin the portal (Auto / ACE / INTTRA) | Lets a pin write anything the selectors do not resolve |
| — | **Presses Save, Save Line, Add Line, Add Row, Continue, Submit or Certify** |

That last row is the one thing being fast does not buy. Quickfill fills through
the ACE Helper's and the INTTRA Helper's own fillers, and both carry an
`automationPolicy.ts` whose switches are frozen `false`. The last click on a
filing is the filer's, because the filing is the filer's legal declaration.
`tests/quickfillInvariants.test.ts` asserts it of this extension's own content
layer too, and that the extension declares no third policy file of its own.

Permissions: `["storage", "scripting"]`, and nothing else. CSP:
`connect-src 'none'`. No network API of any kind, asserted against the source
and again against the built bundle. `scripting` is the popup starting this
extension's own content script in a tab that has none, on the five hosts the
manifest already asks for; what it may inject is pinned field by field in
`tests/quickfillInvariants.test.ts` and explained in section 5b.

## 2. The one box

Detection order, first match wins, no picker:

| The paste looks like | Read as | Via |
| --- | --- | --- |
| JSON that declares a filing package | the package, as it is | `parseFilingPackageJson` |
| any other JSON object | a saved Deckhand extraction | `parseDeckhandJson` |
| two or more lines, first line with tabs or two commas | spreadsheet rows | `mapSheetToCanonical` |
| ...and if those rows are not an invoice | a container table | `extractShipment` |
| anything else | the carrier's email | `extractShipment` |

The fourth rung is the lesson of the first live paste: the office's container
manifest (`GALCO / Container # / LOT#: / SEAL# / BOOKING# / ...`) is tabular but
is not an invoice, and a ladder that stopped on the rung it could not climb
threw the whole paste away. Deckhand reads that shape and returns every
container beside its own seal, so the ladder keeps descending.

Every branch produces the same two things: a `FilingPackage` for the INTTRA
side and a `CanonicalShipment` for the ACE side. The single line under the box
says which branch ran and what came out of it, for example

```
Read as: carrier email · EBKG18531408 · 3 containers · 3 with a seal
```

The seal count is a count, not a check: nothing is gated on it. It is there
because a manifest read as eleven containers and no seals would otherwise
look, in this line, exactly like one that parsed whole.

Which buttons appear is section 2a.

`quickfill-extension/src/paste.ts` is pure - no DOM, no `chrome.*` - so the
whole input path is unit-testable without a browser, and
`tests/quickfill.test.ts` exercises all four branches.

## 2a. The two INTTRA page types, and the portal toggle

The live portal has two things to fill, and the operator meets both on the
same page: the **per-container Particulars blocks** on Create Shipping
Instruction, and the **Copy Container Details grid**, which is a modal drawn
over it. The INTTRA Helper reaches both because it has two tabs that are
always there (Fill INTTRA, Containers). Quickfill has one row of buttons, so
it has to reach both from that row.

### The mistake this replaced

`detectInttraPage` returns ONE screen. On the live create page with the modal
open it returns the **create page**: `#generalDetails` is a real, visible
marker worth 10, plus its heading (3) and its URL (2), against the grid's 10.
A popup that asked that one answer "is this the grid screen?" therefore said
no, and offered no grid route at all while the grid filled the screen.

So the routes are asked about separately, and whichever exists is offered:

| Question | Answered by | Buttons |
| --- | --- | --- |
| Does the named screen have fields? | `inttraFieldsForPage(page).length` - `copyContainerDetails` has none, because the grid is written from `GRID_COLUMNS`, not field by field | **Fill this screen**, **Fill all N containers** |
| Is a container grid on the page? | `detectGrid`, the grid writer's own reading, whatever the screen was named | **Fill container grid** |
| Does the paste have containers? | the package alone | **Copy rows** |

Both of the first two can be true at once, and on the live create page with
the modal open both are.

### Which one leads

Exactly one button in the row is blue, and it is the one that works:

| The page | Order | Blue |
| --- | --- | --- |
| A grid that cannot be typed into (the live portal's) | Copy rows, Fill container grid, then the form pair | Copy rows |
| A grid that can be typed into | Fill container grid, Copy rows, then the form pair | Fill container grid |
| No grid | Fill this screen, Fill all N containers, Copy rows | Fill this screen |
| No fields and no grid | Copy rows alone | Copy rows |

A grid the cells of which hold no control until they are clicked also carries a
line under the pair saying so **before** either button is pressed: the live
portal, 2026-09-17, where two equal blue buttons read as two equal routes, Fill
was pressed first, wrote nothing, and only then explained itself. Fill stays
available anyway: a grid that answers the question wrongly must not become a
grid the operator cannot fill. After Copy rows the result line names the
columns pasted, in the grid's own order, and any left blank because no package
column matches the heading, so the operator can see the seal is in the block
before pasting it. Where no grid was found the order is the default one
(Container Number, Carrier Seal #, Shipper Seal #, ...) and the line says so -
the fifth live run (2026-09-17), where the grid was of a shape the detector had
never been shown and a popup that offered nothing there left the operator with
the one helper that had the fallback.

### The toggle: Auto | ACE | INTTRA

A segmented control above the box, held in `chrome.storage.session` for the
browsing session, under its own key so **Clear empties the box without
un-pinning the portal**.

| State | What it does |
| --- | --- |
| **Auto** (default) | The page decides, exactly as the popup behaved before the toggle existed. The host says which detector speaks first; the page's content gives the answer. |
| **ACE** | The ACE route, whatever the page looks like. The four AESDirect steps have no "primary" one to assume, so a page that is none of them says so and offers nothing: a pin does not invent a form. |
| **INTTRA** | The INTTRA route, whatever the page looks like. A screen the detector cannot name is filled as **Create Shipping Instruction**, and both the line above the buttons and the result line say so. |

The pin exists because the operator can see the portal when the detector
cannot. The third live run read "INTTRA screen not identified" and blocked Fill
on the very page being filled (`docs/INTTRA-INTEGRATION.md` section 5c). A fill
has to aim at some mapping table, and guessing one silently is not the helper's
call to make - which is why Auto still refuses. Pinning is the operator making
that call, so the create page's fields are tried and the answer names the
assumption:

```
The screen was not identified, so the Create Shipping Instruction fields were tried. Filled 2 of 7.
```

**What a pin cannot do.** It changes which buttons are offered and which
mapping table an unnamed screen is filled from. It does not change what a write
is allowed to do: every value still goes through the same detector-resolved
selectors, a selector that matches several controls is still refused as
AMBIGUOUS, a container row the screen does not have is still reported rather
than written into another row, and nothing is ever clicked. A pin cannot make
Quickfill write a field that is not on the screen.

It also cannot cross portals. A **named AESDirect step is never treated as an
unidentified INTTRA screen**, however the toggle is set: INTTRA's ladders match
by label wording, and an ACE step carries wordings that brush against them
("Vessel", "Booking Number"), so a toggle left on INTTRA while the operator
moved to Step 4 would otherwise type INTTRA's values into ACE's boxes. On a
named step a pinned INTTRA fill refuses and says which step it is; Copy rows
stays, because it touches nothing but the clipboard.

## 3. What it drops, and what that costs

Each of these is a deliberate removal, and each has a price. They are listed
with the price so nobody has to rediscover it in front of a customs officer.

| Dropped | Cost |
| --- | --- |
| The ten data quality checks (`buildPreflight`) | A malformed Schedule B number, a missing UOM or an out-of-range value reaches ACE and is rejected there instead of here. |
| The ISO 6346 check digit block | A mistyped container number is typed into ACE and INTTRA exactly as the email had it. `aceShipmentFrom` is the one function that makes this happen, and reversing it is a one-line edit. |
| The Deckhand review and the Approve click | An extraction with a contradicted seal or an unpaired list is used without anyone having looked at the marks. |
| The conflict screen | When the invoice and the email disagree about a booking, vessel, container or seal, the **email wins**, silently. Rationale: the carrier checks the shipping instruction against its own booking confirmation, so the carrier's document is the one that has to match. It is a rule, not a judgement, which is why it can be applied without a screen. |
| The fill gate (`fillGate`) | Nothing blocks a fill. Ever. |
| `overwrite: false` | A field that already holds a different value is replaced rather than left alone with a warning. |
| The Shipment Reference Number counter | ACE Step 1's reference falls back to the invoice number, and is **empty** for an email-only paste. If the running gap-free sequence matters for a filing, use the ACE Helper for that filing; the counter lives in `src/core/referenceCounter.ts` and Quickfill deliberately does not touch it. |
| The session log and diagnostics | There is no audit trail of what Quickfill wrote. The saved `filing-package.json` is the audit trail; Quickfill does not write one. |

One thing is **not** dropped: Quickfill still refuses to guess. With several
containers in the package and one container field on ACE's Transportation
step, it leaves the field empty rather than picking one. And with a grid
shorter than the container list, it fills the rows that exist and stops,
because filling the rest would mean pressing Add Row.

## 4. How it shares code with the other two

Quickfill is a separate **extension**, not a separate **codebase**. There is one
selector table for ACE and one for INTTRA, and Quickfill uses them; a selector
that CBP changes is fixed once, in `src/ace/selectors/`, and all three
extensions get the fix.

| Reused, unchanged | From |
| --- | --- |
| ACE fill orchestration, field resolution, Select2 handling, the writer | `src/content/filler.ts` and what it calls |
| ACE page detection, mappings, selector tables, transformers | `src/content/pageDetector.ts`, `src/ace/` |
| INTTRA fill, container grid, page detection, mappings | `inttra-extension/src/content/`, `.../mappings/` |
| Email extraction | `deckhand/src/extractor.ts` |
| The package and its builder | `shared/src/` |
| Spreadsheet rows to canonical | `src/excel/canonicalMapper.ts` |
| The stylesheet | `extension/styles/ui.css`, copied at build |

New code, all under `quickfill-extension/`:

```
src/paste.ts                     the one input, pure; format detection + auto-resolve
src/aceShipment.ts               package -> CanonicalShipment, ungated
src/content/quickfillContent.ts  one content script, both portals
src/ui/popup.ts                  the whole interface, in both frames: the
                                 action popup, and behind Pop out the same
                                 page in a window (section 5c)
src/background/serviceWorker.ts  holds the parsed paste for the session
src/core/{messages,store}.ts     four messages and a session key
```

`tests/quickfillInvariants.test.ts` asserts that this directory declares no
`mappings/` or `selectors/` folder of its own and imports neither field writer
directly, so the sharing cannot quietly stop.

### Why a third extension rather than a mode

Because of the host list. Quickfill is the only one of the three that asks for
the CBP hosts **and** the INTTRA/e2open hosts at once. Putting that combined
list in its own manifest is what stops the ACE Helper and the INTTRA Helper
from acquiring each other's permissions; an operator who wants only one portal
installs only that helper. The invariant tests pin all three manifests, and one
of them fails if `cbp.dhs.gov` ever appears in the INTTRA manifest or vice
versa.

## 5. Build, check, install

| Command | Does |
| --- | --- |
| `npm run build:quickfill` | build `dist-quickfill/` |
| `npm run build:quickfill:watch` | rebuild on change |
| `npm run build:quickfill:playground` | build `dist-quickfill-playground/`, the practice build (section 5a) |
| `npm run check:bundle:quickfill` | supply-chain check on the built bundle, allowing only `cbp.dhs.gov`, `inttra.com`, `e2open.com` |
| `npm run icons:quickfill` | regenerate the committed icons (amber, "Q") |
| `npm test -- tests/quickfill.test.ts tests/quickfillPopup.test.ts tests/quickfillInvariants.test.ts` | its own tests: the four paste shapes and both fills against real fixtures, the popup in jsdom, the invariants |
| `npm run verify` | everything, including the two lines above |

Install: `chrome://extensions` → Developer mode → **Load unpacked** →
`dist-quickfill/`. It can be installed beside the other two; the three are
independent extensions with independent storage, and the amber "Q" tells them
apart in the toolbar.

## 5a. Practising without the portal: the playground

`npm run build:quickfill:playground` (in CI, the `quickfill-playground-unpacked`
artifact) writes `dist-quickfill-playground/`: the same three bundles under a
manifest that matches **pages opened from disk and from localhost only**, with
no host permission at all, and beside them a `playground/` folder holding the
four AESDirect steps as pages, the example workbook and a README. The card in
`chrome://extensions` reads "Quickfill Helper (playground)", so it cannot be
mistaken for the real build, and it cannot open a portal page, so nothing can
be filed from it.

The ACE Helper has the same thing, from the same generator:
`npm run build:playground` writes `dist-ace-playground/` with these four pages
and this workbook, for the panel rather than the paste box (USER-GUIDE.md
section 4).

The four pages are `tests/fixtures/ace-*.html` wrapped at build time
(`scripts/playground.mjs`): the real labels and the six ids captured from the
live portal, tabs that link the four files, and mock buttons (Save shows a note,
Add New Line empties the line so "Fill line" can be practised for line 2).
There is no second copy of a screen to drift from the one the tests run
against. The workbook is the template's worked example
(`scripts/templateData.mjs`, shared with `npm run template`): one sheet, the
header row and two lines, so select-all and copy is exactly the paste.

To practise: load the folder unpacked, turn on **Allow access to file URLs**
on its card (without it the helper cannot see a page opened from disk), open
`playground/step1-shipment.html`, paste the workbook rows into the box (`Read
as: spreadsheet rows · 2 lines`), and press **Fill this page**; then the other
three steps through the tabs, and on Step 3 **Fill line**, **Add New Line**,
**Fill line** again for line 2. The popup recognises a step by its content
(the step tabs, the headings), which is what lets it work on a file: on the
live portals nothing changes, because no INTTRA screen carries ACE's "Step N:"
tabs.

What it proves: the paste is read, the mapping tables find the fields by the
captured labels and ids, and the values are transformed on the way (the date
to MM/DD/YYYY, pounds to whole kilograms, codes upper-cased). What it does
not: the live dropdowns are Select2 widgets and the playground's are plain
selects; twenty of the twenty-six fields still match by label wording only;
ACE's own validation is absent. A fill that works here is the mechanics
working, not the portal.

## 5b. The tab that was already open

Chrome injects a content script when a page **loads**. Load the extension, or
press Reload on its card after `npm run build:quickfill`, and every portal tab
that is already open keeps running nothing: the manifest still matches it, and
the script that was injected into it before the reload is gone. The tab looks
completely normal, so there is nothing to see.

That is the whole of the live run on **2026-09-21**. The operator had the
Create Shipping Instruction page open at
`ship.inttra.e2open.com/siact/siworkspace#/create/...` with the Copy Container
Details modal over it and an empty grid on the screen, pasted a carrier email
(`Read as: carrier email · 7 containers · 7 with a seal`), pinned the toggle to
INTTRA, and got:

```
Quickfill is not running in this tab. Open an ACE or INTTRA screen and reload the page.
Open an ACE or INTTRA screen in this tab.
```

Two things were wrong with that, and both are fixed.

**The advice was to do what the operator had already done.** The second line is
what the popup says when it has no portal to offer, and it printed under a line
that had already said the real reason. A tab that cannot be reached is not a
tab that is on the wrong page, and the popup now tells them apart: `tab.url` is
populated by Chrome only for a tab the extension has host permission for, so
its absence *is* the answer that this is not a portal tab, and it costs no
`tabs` permission to read.

**Every route was withdrawn, including the one that needs no page.** Copy rows
builds its block out of the package's own containers; it asks the tab only for
the grid's column order, and `gridPasteBlock` has always had a fallback for a
page with no grid on it. So the block is now built in the popup when the tab
cannot be asked, in `GRID_COLUMNS` order, which is the order the live grid was
read in on 2026-09-20 (Container Number, Carrier Seal #, Shipper Seal #, Cargo
Description, Marks & Numbers, HS Code). The result line says which order it
used. On that run the operator would have had their seven rows on the
clipboard, with the grid to paste them into already on the screen.

**And the popup now starts the script itself.** On a failed ping it calls
`chrome.scripting.executeScript` for this extension's own
`quickfillContent.js`, into every frame of the active tab, and asks again.
The modal stays open; nothing is reloaded.

This is why the manifest asks for `scripting`, which is a permission the
extension deliberately did without until then:

| | |
| --- | --- |
| What it can inject | `quickfillContent.js`, the file in this bundle. Never a function, never a string, never a file named by a message |
| Where | The five hosts in `host_permissions`. Chrome refuses anywhere else, and the popup does not ask where it has no `tab.url` |
| Which world | The extension's isolated world, the default. Never `MAIN`, which would put our code in the page's own world beside the portal's |
| How long | The tab's lifetime. Never `registerContentScripts`, which would outlive the popup |
| What the operator sees | Nothing new. `host_permissions` already grant the five portal hosts, and `scripting` adds no install warning of its own |

`tests/quickfillInvariants.test.ts` asserts every row of that table against the
source, and `tests/webInvariants.test.ts` holds the expected permission set of
all three manifests in one place, so a fourth permission can only ever arrive
by editing a line that says what it is for.

The content script registers its listener **once per frame** and remembers that
on the frame, because a frame that already had the script would otherwise
answer every message twice, which Chrome reports as "Could not send response
more than once".

What this does not fix: a page the portal is still drawing, and a frame whose
own listener throws before it answers. The listener now treats a failed read of
the page as "not this frame" rather than as silence, so one slow frame cannot
make the whole tab look dead.

## 5c. Pop out: the popup that stays open

Reported 2026-09-22, against all three helpers: leave an ACE or INTTRA screen
with the helper open, come back, and the helper is gone; the toolbar icon has
to be clicked again.

**That is Chrome, not a bug here.** An action popup is destroyed the moment it
loses focus, and on a form being filled that is the first click into the form.
There is no flag, no permission and no API that keeps one open. The only fix is
a surface Chrome does not destroy.

The ACE and INTTRA helpers answer with a side panel and the `sidePanel`
permission (`docs/ARCHITECTURE.md`, "The two UI surfaces"). **Quickfill does
not, and this is the decision, not an oversight:**

| | Side panel | Pop-out window (chosen) |
| --- | --- | --- |
| Permission | `sidePanel` | none; `chrome.windows.create` on our own extension page asks for nothing |
| Where it sits | docked, taking width from the portal | anywhere, including a second screen |
| Suits | a panel you read while filling: status, line picker, report | one paste box, which needs no docked strip |
| Cost | the portal is narrower, and INTTRA's create page is already wide | the window can fall behind the browser on a single screen |

So the popup keeps a **Pop out** button beside Clear. It opens this same
`popup.html` with `?window=1` in a `type: 'popup'` window and closes the popup
behind it, because two live copies of one box, each holding a paste the other
does not know about, is worse than no window at all. Nothing is handed over in
the URL: both read the same `chrome.storage.session` on boot, so the window
opens on exactly what the popup was showing, toggle included.

Two things the window has to do that a popup never did, both in
`src/ui/liveTab.ts` and shared with the two side panels:

- **It has to keep looking.** A popup was gone before the page could change. A
  window is still on the screen when the operator switches to the ACE tab,
  opens a second draft or reloads the portal, and a stale "Copy Container
  Details, 7 containers" reads as current. So it re-probes on
  `tabs.onActivated`, `tabs.onUpdated` and `windows.onFocusChanged`, coalesced
  so that loading a page is one probe and two probes never overlap.
- **It has to ask about somebody else's window.** `currentWindow` inside a
  pop-out window is the pop-out, whose only tab is Quickfill itself; asking it
  would report "not a portal tab" with the portal open right beside it. So a
  detached surface queries `windowType: 'normal'` and takes the most recently
  used answer.

What the window does NOT change: not one of the removals in section 3 comes
back, nothing is clicked, and a fill still goes through the same
detector-resolved selectors. It is the same interface, in a frame Chrome does
not close. Neither it nor the two side panels has been used on a real shipment.

## 6. What is not verified

Quickfill inherits `README.md`'s caveats whole and resolves none of them.

1. **ACE:** twenty fields still match by label wording only; six carry ids
   captured from the live DOM on 2026-09-16. Quickfill fills what the ACE
   Helper fills today, no more and no less, because it is the same mapping
   table. `docs/ACE-MAPPING.md`.
2. **Every ACE dropdown is a Select2 3.x combobox** over a hidden `<select>`,
   and **no dropdown write has ever run against the live portal**. This is
   unchanged by Quickfill and is the most likely thing to be wrong in front of
   a real form.
3. **INTTRA:** every FIELD selector in `inttra-extension/src/mappings/` is a
   placeholder. Captured live on 2026-09-17: the hostname
   `ship.inttra.e2open.com`, the Copy Container Details modal root and the
   grid container; on the fifth run that day neither held a table in the
   document that answered, so the screen is identified by its grid, found by
   the wording of its header row whatever it is built from, a rung that has
   run against mocks only. Its cells are `editableGrid` ones that hold no
   control until clicked, so there the route is **Copy rows** and paste, not
   Fill. On the live portal
   Quickfill
   will currently fill **nothing** there. Building it now is still right - the
   mapping tables are the thing that needs capturing, and they are shared - but
   it must not be described as working. `docs/INTTRA-INTEGRATION.md` sections 6
   and 7.
4. **Quickfill has been opened on the live INTTRA portal on two days**
   (2026-09-17 and 2026-09-21) and has still never completed a real shipment. That one run confirmed the
   hostname and the shape of the Copy Container Details screen, and found two
   bugs that are now fixed and pinned by tests: a container manifest was
   thrown away because it was tabular but not an invoice, and the grid screen
   was misidentified because it is a modal over another step. A fourth run the
   same day found two more, also fixed and pinned: the grid's seal headings
   are dropdowns and were read as their whole option list, so Shipper Seal #
   was never identified, and a column that was not identified was left out of
   the pasted row instead of pasted blank, so the seals were pasted nowhere.
   See `docs/INTTRA-INTEGRATION.md` section 5a. Every build now carries a
   stamp (`build <version>+<commit>.<time>` in the popup header), because that
   run could not at first tell which build was loaded. A fifth run, with those
   fixes loaded, found that neither helper found the grid at all: it is
   neither a table nor an ARIA grid, and Quickfill offered nothing while the
   INTTRA Helper fell back to the default column order. The grid is now found
   by the wording of its header row, Quickfill offers Copy rows alone on an
   INTTRA page it cannot name, and the INTTRA Helper's Diagnostics describes
   the page's structure for the capture. None of that has run on the live
   portal yet. A sixth run, on 2026-09-21, never reached the page at all: the
   tab had been open since before that build was loaded, so no frame of it was
   running the content script, and the popup withdrew every route - including
   Copy rows, which needs nothing from the page - in front of the grid the
   operator was trying to fill. The popup now starts the script itself, and
   Copy rows no longer depends on the tab (section 5b). **Nothing about the
   fill itself was learned on that run**: no field was written, no paste was
   performed, and the three captured container selectors and the label ladders
   are exactly as unproven as they were on 2026-09-20. The trade-offs in
   section 3 have still never been tested against an operator in a hurry,
   which is exactly the condition under which dropping the checks matters
   most.
5. **The pop-out window has never been opened on a live portal** (section 5c),
   and neither has the side panel the other two helpers moved to. Both are
   answers to a complaint made about the live portal on 2026-09-22, but the
   surface is all that changed: the same detector, the same selectors, the
   same refusals. A window that stays open in front of an unfilled field is
   still an unfilled field.

## 7. The dashboard, and why nothing was added to it

Nothing in `web/` changed, and nothing needed to.

The operator dashboard exists to host the preparation step: import the invoice,
read the email, review, build, resolve, download. Quickfill runs Deckhand's
extractor inside the extension, so for this workflow there is no preparation
step to host. No new page, no new Worker, no new deploy, no flag inside the
dashboard.

Separation is held by four things:

1. **`web/` is untouched.** Same eight tabs, same `connect-src 'none'`, same
   static-only `wrangler.jsonc`, same deploy workflow.
2. **The import ban runs both ways.** `tests/webInvariants.test.ts` already
   asserted that nothing shipping in an extension imports from `web/`;
   `quickfill-extension` is now in that list, so Quickfill cannot grow a
   dependency on the hosted page.
3. **No channel between them.** Quickfill has no network permission and no
   `externally_connectable`; its CSP is `connect-src 'none'` and its bundle
   check allows only the two portals' hosts. The dashboard cannot push into it
   and it cannot pull from the dashboard.
4. **They interoperate through the file, not through code.** Quickfill's box
   accepts a `filing-package.json` the dashboard downloaded - that is the
   existing contract in `shared/src/filingPackage.ts`, versioned by
   `FILING_PACKAGE_SCHEMA_VERSION`. Use the dashboard's careful path when a
   shipment is complicated and Quickfill's fast path when it is not, with the
   same file.

**If a hosted surface is ever wanted for Quickfill** - a stripped page for
someone without the extension - the separation to hold to is a *separate build
target and a separate Worker*, not a mode in the current app: a `web-quickfill/`
directory with its own `wrangler.jsonc` (own Worker name, own URL), its own
`_headers`, its own deploy workflow, and its own invariant test, sharing only
`shared/` and `deckhand/` exactly as `web/` limits itself today. That keeps one
deploy from being able to break the other, and keeps the persistence decision in
`docs/WEB-DASHBOARD.md` section 10 scoped to the app that raised it.

This is not built and not approved. It is written down so that if it happens it
is a decision rather than a drift.
