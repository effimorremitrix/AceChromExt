# Quickfill Helper (quickfill-extension/)

> **Status:** built, typechecked and tested against this repository's fixtures.
> It inherits the repository's verification state exactly and improves none of
> it: the ACE selectors are still mostly label matches, the INTTRA selectors are
> still all placeholders, and no dropdown write has ever run against a live
> portal. A simpler interface verifies nothing. See section 6.

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
3. [What it drops, and what that costs](#3-what-it-drops-and-what-that-costs)
4. [How it shares code with the other two](#4-how-it-shares-code-with-the-other-two)
5. [Build, check, install](#5-build-check-install)
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
| — | **Presses Save, Save Line, Add Line, Add Row, Continue, Submit or Certify** |

That last row is the one thing being fast does not buy. Quickfill fills through
the ACE Helper's and the INTTRA Helper's own fillers, and both carry an
`automationPolicy.ts` whose switches are frozen `false`. The last click on a
filing is the filer's, because the filing is the filer's legal declaration.
`tests/quickfillInvariants.test.ts` asserts it of this extension's own content
layer too, and that the extension declares no third policy file of its own.

Permissions: exactly `["storage"]`. CSP: `connect-src 'none'`. No network API
of any kind, asserted against the source and again against the built bundle.

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
Read as: carrier email · EBKG18531408 · 3 containers
```

The buttons shown depend on the page in the tab: the ACE pair on a CBP host
that resolves to one of the four AESDirect steps, the INTTRA pair on a
Shipping Instructions screen, and on the container grid a single **Fill
container grid**.

`quickfill-extension/src/paste.ts` is pure - no DOM, no `chrome.*` - so the
whole input path is unit-testable without a browser, and
`tests/quickfill.test.ts` exercises all four branches.

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
src/ui/popup.ts                  the whole interface
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
| `npm run check:bundle:quickfill` | supply-chain check on the built bundle, allowing only `cbp.dhs.gov`, `inttra.com`, `e2open.com` |
| `npm run icons:quickfill` | regenerate the committed icons (amber, "Q") |
| `npm test -- tests/quickfill.test.ts tests/quickfillPopup.test.ts tests/quickfillInvariants.test.ts` | its own tests: the four paste shapes and both fills against real fixtures, the popup in jsdom, the invariants |
| `npm run verify` | everything, including the two lines above |

Install: `chrome://extensions` → Developer mode → **Load unpacked** →
`dist-quickfill/`. It can be installed beside the other two; the three are
independent extensions with independent storage, and the amber "Q" tells them
apart in the toolbar.

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
3. **INTTRA:** every selector in `inttra-extension/src/mappings/` is a
   placeholder. The hostname is confirmed (`ship.inttra.e2open.com`,
   2026-09-17), the container grid is found by its headings, and its cells are
   known to be unwritable until clicked - so on that screen the route is
   **Copy rows** and paste, not Fill. On the live portal Quickfill
   will currently fill **nothing** there. Building it now is still right - the
   mapping tables are the thing that needs capturing, and they are shared - but
   it must not be described as working. `docs/INTTRA-INTEGRATION.md` sections 6
   and 7.
4. **Quickfill has been opened once on the live INTTRA portal** (2026-09-17)
   and has still never completed a real shipment. That one run confirmed the
   hostname and the shape of the Copy Container Details screen, and found two
   bugs that are now fixed and pinned by tests: a container manifest was
   thrown away because it was tabular but not an invoice, and the grid screen
   was misidentified because it is a modal over another step. See
   `docs/INTTRA-INTEGRATION.md` section 5a. The trade-offs in section 3 have
   still never been tested against an operator in a hurry, which is exactly
   the condition under which dropping the checks matters most.

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
