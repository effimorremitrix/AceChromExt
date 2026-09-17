# Architecture

## The one-way data flow

```
  QuickBooks Desktop (local)                      ..... Phase 2, companion/
        |  companion/src/transport/    qbXML over COM, or a saved response
        |  companion/src/qbxml/        request builders + response parsers
        v
  QbInvoice  (QuickBooks-shaped, knows nothing about ACE)
        |  companion/src/mapping/      -> canonical, + a field-origin record
        v
  CANONICAL SHIPMENT MODEL
        |  companion/src/excel/        -> ACE_Import.xlsx
        v
  XLSX file (local)
        |  src/excel/excelReader.ts        bytes -> arrays of arrays
        v
  raw grid
        |  src/sources/                    which InvoiceDataSource claims it?
        |    ExcelSource                   a workbook somebody filled in
        |    QuickBooksExportSource        one the companion wrote
        |    WebSource                     declared, unavailable by design
        |  src/excel/canonicalMapper.ts    semantic normalization + provenance
        v
  CANONICAL SHIPMENT MODEL  ................ src/models/CanonicalInvoice.ts
   { invoice, commodities[], provenance, source }
        |
        |  src/excel/validator.ts          plausibility rules -> issues
        |  src/ui/preview.ts               traffic lights, original vs ACE
        |  src/ui/preflight.ts             ten named data quality checks
        |  src/ui/mappingStatus.ts         source -> ACE field, per field
        v
  USER REVIEWS, THEN CLICKS FILL
        |
        |  src/ace/mappings/*              what to fill: field, transform, limits
        |  src/ace/selectors/*             where to find it: the ACE selectors
        |  src/ace/selectors/overrides.ts  selectors captured from live ACE
        |  src/ace/transformers/*          presentation for ACE
        |  src/content/pageDetector.ts     which step is on screen?
        |  src/content/fieldDetector.ts    which element is this field?
        v
  src/content/fieldWriter.ts               THE ONLY WRITE PATH
        |
        v
  ACE form  ->  user reviews  ->  USER SUBMITS

  (throughout: src/core/sessionLog.ts records import, every transformation and
   every fill, in session memory only, exportable on request and uploaded
   nowhere. src/content/automationPolicy.ts states what is never clicked.)
```

Nothing flows backwards. The canonical model has no idea ACE exists; the
mappings have no idea Excel exists; and the QuickBooks half has no idea either
exists - it produces the canonical model and stops.

## Phase 4: the second source and the second destination

```
  QuickBooks Desktop ──▶ companion ──▶ CanonicalShipment ─┐
                                                          │  shared/src/builder.ts
  Email / .eml ───▶ deckhand/ ───▶ DeckhandShipment ──────┤  ownership + matching + conflicts
                     (rules extractor, review, approval)  │
                                                          ▼
                                                   FilingPackage  ─── filing-package.json
                                                    /          \
                        src/sources/FilingPackageSource        inttra-extension/
                        (-> CanonicalShipment, the ACE         (Fill Current Page, InttraGridWriter)
                         pipeline unchanged)                           │
                               │                                       ▼
                             ACE                                    INTTRA
```

Three rules keep this additive:

- **ACE never depends on it.** `FilingPackageSource` is one more
  `InvoiceDataSource`; it yields a `CanonicalShipment` and the preview,
  checks, mapping status and fill run unchanged. Excel and the workbook path
  are untouched. Tests assert the Phase 1 regression suite and the QuickBooks
  export still pass with no package in sight.
- **Deckhand and the package are pure.** `deckhand/` and `shared/` know
  nothing about a DOM, a portal, `chrome.*`, or the companion; both
  extensions and the companion import them and they import none of those.
- **The INTTRA Helper is a separate extension.** Its own manifest, hosts,
  build (`dist-inttra/`) and bundle check. It reuses the ACE Helper's field
  detector, candidate constructors, override parser, highlight helper and
  transformers by import, and has its own writer (`setInttraFieldValue`),
  grid writer, page detector and automation policy.

`docs/DECKHAND.md`, `docs/INTTRA-INTEGRATION.md` and `docs/END-TO-END-FLOW.md`
describe each piece; the table below lists where they live.

## Phase 5: the operator dashboard, a fourth caller of the same code

```
  Cloudflare ── static files ──▶ browser ┌─────────────────────────────┐
                                         │ web/  Operator Dashboard    │
   ACE_Invoice_*.xlsx  ─────────────────▶│  src/sources  (import)      │
   filing-package.json ─────────────────▶│  deckhand/    (extract)     │──▶ filing-package.json ──▶ ACE Helper / INTTRA Helper
   pasted email / .eml ─────────────────▶│  shared/      (package)     │──▶ ACE_Invoice_*.xlsx  ──▶ ACE Helper
                                         │  preflight + mappingStatus  │        (downloads, this machine)
                                         │  INTTRA mappings (readiness)│
                                         └─────────────────────────────┘
```

The dashboard is not a fifth program with its own rules. It is a page that
calls the modules the panels and the companion already call - the source
registry, the extractor and its review, the package builder, the data
quality gate, the offline mapping status, the INTTRA mapping tables - and
renders the two shared tabs (`deckhandTab.ts`, `packageTab.ts`) through the
same context object the panels use. Its own code is a workspace of shipments
held in memory (`web/src/state.ts`), the workflow as pure functions over one
shipment (`web/src/workflow.ts`), readiness and provenance views
(`web/src/readiness.ts`), and the page itself.

Three rules keep it additive, and `tests/webInvariants.test.ts` asserts each:

- **It sends nothing.** No network API in `web/src`, none in the built
  bundle (`npm run check:bundle:web`, empty host allowlist), and
  `connect-src 'none'` in the page and in the host's response headers. The
  hosting configuration (`web/wrangler.jsonc`) has no Worker script and no
  binding: Cloudflare serves files and never sees a shipment.
- **It cannot fill.** It imports no content script, field writer, filler or
  grid writer, and no `chrome.*`. The hand-off to the extensions is the
  file, as before.
- **The local programs do not know it exists.** Nothing under `src/`,
  `inttra-extension/`, `companion/`, `deckhand/` or `shared/` imports from
  `web/`; both manifests are unchanged; `tests/independence.test.ts` keeps
  any hosting provider's name out of them.

QuickBooks stays where it was: `ace-export` runs beside QuickBooks Desktop,
over local COM, and the file it writes is carried to the dashboard. The
dashboard never asks for QuickBooks to be reachable.

`docs/WEB-DASHBOARD.md` covers the screens, development, deployment, and the
optional server-side layer that is documented but not built.

The QuickBooks half deliberately rejoins through the **spreadsheet**, not
through a private channel into the extension. A workbook is inspectable,
editable, e-mailable and archivable; a private channel would have meant a
second import path to maintain, a second thing to validate, and a Chrome
extension that had to talk to a local process.

## Phase 6: Quickfill, the same code with the ceremony removed

```
                    ┌──────────────────────────────────────┐
   one paste box ──▶│ quickfill-extension/                 │
   (email | package │   src/paste.ts    detect + build     │──▶ fillFields()         ──▶ ACE
    | extraction    │   src/aceShipment ungated ACE view   │──▶ fillInttraFields()   ──▶ INTTRA
    | rows)         │   src/content/    one script, both   │──▶ fillContainerGrid()
                    └──────────────────────────────────────┘
```

Quickfill is a third *extension*, not a third *codebase*. It owns no mapping
table, no selector table, no transformer and no writer: it calls
`src/content/filler.ts`, `inttra-extension/src/content/filler.ts` and
`gridWriter.ts`, so a selector CBP changes is still fixed once and all three
extensions get the fix. `tests/quickfillInvariants.test.ts` asserts that it
declares no `mappings/` or `selectors/` folder and imports neither field writer
directly, so the sharing cannot quietly stop.

Its own code is four small things: the detection ladder and package build in
`paste.ts` (pure, no DOM, no `chrome.*`), an ungated package-to-ACE view in
`aceShipment.ts`, one content script that answers for both portals, and a popup.

What it removes, and what that is worth, is `docs/QUICKFILL.md` section 3. Two
things it does **not** remove:

- **It presses nothing.** It fills through the two extensions' own fillers, and
  both carry an `automationPolicy.ts` whose switches are frozen `false`. Speed
  does not buy the right to press Save, Add Row, Continue or Certify.
- **It does not guess.** Several containers and one ACE container field still
  means the field is left empty, and a grid shorter than the container list is
  filled as far as it goes rather than extended.

The one structural thing that is genuinely new is the **host list**: Quickfill
is the only extension that asks for the CBP hosts and the INTTRA/e2open hosts at
once. Keeping that combined list in its own manifest is the reason it is a
separate extension rather than a mode inside one of the others - the ACE Helper
and the INTTRA Helper cannot acquire each other's permissions, and an operator
who works one portal installs one helper. All three manifests are pinned by the
invariant tests, and `npm run check:bundle:quickfill` re-checks the combined
allowlist against the built bundle.

Which INTTRA screen is open is the shared detector's word for both helpers
(`inttra-extension/src/content/pageDetector.ts`): a visible container grid, or
a visible captured marker, outscores every wording hint combined, so the popup
and the INTTRA Helper's panel cannot disagree about the Copy Container Details
modal. The block both copy for that grid is `gridPasteBlock` in the shared grid
writer: one cell per grid column, from Container Number rightwards, blank where
nothing feeds a column.

Nothing in `web/` changed: Quickfill runs Deckhand inside the extension, so
there is no preparation step to host. `quickfill-extension` is in the list of
directories that may not import from `web/`, so it cannot grow a dependency on
the dashboard either. `docs/QUICKFILL.md` section 7.

## Why the canonical model sits in the middle

The spreadsheet, ACE's DOM and QuickBooks all change for unrelated reasons.
Putting a stable model between them means:

- a spreadsheet-format change touches only `columnAliases.ts` + `canonicalMapper.ts`;
- an ACE DOM change touches only `ace/selectors/*` - or nothing at all, because
  a captured selector can be pasted into the panel and is in force on the next
  fill without a rebuild;
- a new *source* of the model implements `InvoiceDataSource` and changes nothing
  downstream. ExcelSource is the fallback and is the Phase 1 path verbatim;
  identifying a workbook as QuickBooks-produced changes its label and nothing
  else, which a test asserts by comparing the two canonical models;
- QuickBooks is a second *producer* of the same model, and reuses the entire
  preview / validation / fill pipeline unchanged. Phase 2 added no second
  invoice model and no second transformation engine: `qbToCanonical.ts` calls
  Phase 1's own `mapCell`, so `lb x 0.45359237` is written once and both paths
  round the same way.

Provenance is stored beside the model rather than inside it, so the model stays
a plain data contract while the preview can still show "176,000 lb -> 79,832 kg".

## Two-stage transformation

| Stage | Where | Does |
| --- | --- | --- |
| Semantic | import (`canonicalMapper`) | units, codes, dates: the model is ACE-correct in meaning |
| Presentation | fill (`transformers/index.ts` registry) | the exact string an ACE input accepts, per-field rounding, casing, truncation |

Both stages call the same pure functions in `src/ace/transformers/`, so a rule
exists once. Mappings name transformers as strings, which keeps the mapping
layer data-only.

## Components

| Path | Responsibility |
| --- | --- |
| `src/models/` | `CanonicalInvoice`, `AceField` - contracts, no behaviour |
| `src/calculator/parser.ts` | tokenizer + recursive-descent parser. No `eval`, no `Function`. Can only produce a number or a typed error |
| `src/calculator/calculator.ts` | rounding, ACE-safe vs display formatting |
| `src/calculator/calculatorUI.ts` | F2 overlay, in a shadow root |
| `src/excel/` | reader, column dictionary, canonical mapper, validator |
| `src/ace/pages.ts` | page signatures + commodity-line container selectors |
| `src/ace/mappings/` | one file per ACE step; declarative, data-only |
| `src/ace/transformers/` | numbers, weight, dates, text, codes + the registry |
| `src/content/pageDetector.ts` | scores evidence (tab text, heading, URL, marker) into a page + confidence |
| `src/content/fieldDetector.ts` | five-tier candidate resolution; ambiguity blocks the write |
| `src/content/fieldWriter.ts` | `setAceFieldValue` - the single write path |
| `src/content/filler.ts` | orchestration; produces a `FillReport` |
| `src/content/highlight.ts` | temporary tinting, restored afterwards |
| `quickfill-extension/src/paste.ts` | the one input: detect the shape, build the package, auto-resolve. Pure |
| `quickfill-extension/src/aceShipment.ts` | package -> ACE model with no gate; the ungated twin of `shared/src/aceView.ts` |
| `quickfill-extension/src/content/` | one content script for both portals; tallies a report to a count |
| `src/ui/app.ts` | the shared UI, rendered in both surfaces |
| `src/ui/importer.ts` | the XLSX parser, injected only into the panel |
| `src/core/store.ts` | session-memory storage of the imported shipment |
| `src/background/serviceWorker.ts` | holds the store across popup open/close |
| `companion/src/qbxml/` | a small XML reader (no DOCTYPE, no entity expansion), qbXML request builders, response parsers |
| `companion/src/transport/` | `QbxmlTransport`: the COM bridge, or replay of a saved response |
| `companion/src/adapter/` | `InvoiceSourceAdapter` and its QuickBooks implementation |
| `companion/src/mapping/` | QuickBooks -> canonical, plus the `FieldOrigin` record |
| `companion/src/excel/` | canonical -> the Phase 1 import workbook |
| `companion/src/ui/` | the `ace-export` command and the local window |
| `companion/src/package/` | `ace-export package` and `ace-export deckhand`: an email on disk, a filing package on disk |
| `deckhand/src/` | extraction: model, ISO 6346, readers (.eml, text; PDF and image declared unavailable), the rules extractor, the review model, text outputs, JSON |
| `shared/src/` | the filing package: provenanced values, the builder (ownership, matching, conflicts, manual values), JSON in and out (merged values rebuilt, never trusted), the ACE view |
| `src/sources/FilingPackageSource.ts` | `filing-package.json` as an ACE data source |
| `src/ui/deckhandTab.ts`, `src/ui/packageTab.ts` | the Deckhand review and the package screens, rendered by both panels |
| `inttra-extension/src/pages.ts` | INTTRA screen signatures (wording guessed from the observed workflow) |
| `inttra-extension/src/mappings/` | one file per screen, plus the container grid's columns and root candidates. Every field selector is a placeholder; the grid root's first two rungs were captured live on 2026-09-17 |
| `inttra-extension/src/content/fieldWriter.ts` | `setInttraFieldValue`: native inputs and contenteditable, events, read-back, structured result |
| `inttra-extension/src/content/gridWriter.ts` | columns identified by header text, one row per container, every cell verified, no Add Row |
| `inttra-extension/src/content/automationPolicy.ts` | Add Row, Continue, Submit, login: named and frozen off |
| `web/src/state.ts` | the dashboard's workspace: shipments in memory, one active; the same three things a panel holds |
| `web/src/workflow.ts` | import, extract, approve, build, resolve, export: pure functions over one shipment, calling the shared code |
| `web/src/readiness.ts` | ACE readiness (the extension's checks and mapping status), INTTRA readiness (the helper's mapping tables), next actions, provenance rows |
| `web/src/exportExcel.ts` | the ACE workbook, from the companion's `buildShipmentRows`, with a Provenance sheet |
| `web/src/app.ts`, `web/src/views/` | the page: header, tabs, the two shared tabs, the readiness and provenance screens |
| `scripts/build-web.mjs`, `web/wrangler.jsonc` | esbuild into `dist-web/`; Cloudflare static assets, no script, no binding |

## Why the companion is a separate program

It is a Node program in `companion/`, built to `dist-companion/`, and it is not
part of the extension bundle. Three reasons:

1. **The extension's promises stay true by construction.** `tests/invariants.test.ts`
   asserts that nothing in `src/` calls `fetch`, spawns anything, or names a
   non-CBP host, and `scripts/check-bundle.mjs` asserts the same of `dist/`.
   The companion legitimately spawns PowerShell and opens a loopback socket.
   Keeping it out of `src/` means those checks never had to be weakened.
2. **It runs where QuickBooks runs.** QuickBooks Desktop is a Windows
   application with a local COM server; a browser extension cannot reach it.
3. **Different lifecycles.** Chrome reviews the extension; the companion is
   copied onto one PC by the person who exports the invoices.

The seam between them is the canonical model and the workbook - both plain
data, both already tested from the Phase 1 side.

## Why the adapter interface exists

`InvoiceSourceAdapter` is written in shipping words, not QuickBooks words: no
method mentions qbXML, `TxnID` or `DataExt`. The QuickBooks types stop at
`toCanonicalInvoice`. A second source - a different accounting system, a
customer's ERP - implements four methods and inherits the preview, the
validation, the workbook and both user interfaces.

`FieldOrigin` is the other half of that contract. An ACE filing is a legal
declaration, so "QuickBooks reported this", "this was computed from it",
"this came from a custom field" and "a person typed this" must not look alike
in a review screen. Every canonical value carries which one it was.

## Why `setAceFieldValue` exists

`element.value = x` updates the DOM node but not the framework's model, so the
value looks right and files wrong. The helper:

1. writes through the **native prototype** value setter, bypassing any patched
   instance setter;
2. dispatches `input` (React / Angular / Vue);
3. dispatches `change` (jQuery, plain DOM);
4. optionally dispatches `blur` + `focusout`;
5. reads the value back and reports whether ACE kept it - a value ACE silently
   reverted is an honest failure, not a false success.

`<select>` is handled by matching option value, then exact option text, then a
`C33 - ...` code prefix. No option match means no write.

Every ACE write in the codebase goes through this function. The calculator's
insertion does too.

## The two UI surfaces

| Surface | Contains | Why |
| --- | --- | --- |
| `popup.html` | page status, line picker, Fill buttons, last report | one click from the ACE tab |
| `panel.html` | import, full preview, settings, diagnostics | Chrome closes a popup when a file picker opens, and previews need width |

Both render `src/ui/app.ts`. The XLSX parser is injected into the panel only,
so `popup.js` is ~27 kB instead of ~380 kB.

## Storage

| Data | Where | Lifetime |
| --- | --- | --- |
| Settings | `chrome.storage.local` | until uninstall |
| Imported shipment | `chrome.storage.session` | until the browser closes or Clear Imported Data |
| Quickfill's pasted shipment | `chrome.storage.session` | until the browser closes or Clear |
| ACE credentials | nowhere | never read |

`chrome.storage.session` is memory-backed, is not written to disk, and is not
readable by web pages.

## Deliberate non-automation

The architecture has room for these and does not do them:

- clicking **Save Line**, **Add New Line**, or advancing to the next row;
- navigating between ACE steps;
- submitting or certifying a filing.

`filler.ts` never calls `.click()` on an ACE control - a test asserts it. Adding
line automation later means adding a step *after* the fill report, gated behind
an explicit user action; it does not require changing the fill path.

This survives Quickfill unchanged. Quickfill removes the checks, not the
boundary: it fills through the same fillers, `tests/quickfillInvariants.test.ts`
asserts the same `.click()` / `.submit()` ban over its own content layer, and it
deliberately declares no `automationPolicy.ts` of its own so there is no second
place to turn Save on.

## Extending it

| To do this | Change |
| --- | --- |
| Support a new spreadsheet column | `src/excel/columnAliases.ts` |
| Map another QuickBooks custom field | `customFields` in `ace-export.config.json` - no code |
| Read another built-in qbXML element | `builtInCandidates` in `companion/src/mapping/qbToCanonical.ts` |
| Add a second invoice source | implement `InvoiceSourceAdapter` in `companion/src/adapter/` |
| Add an ACE field | the relevant `src/ace/mappings/*.ts` |
| Add a transformation rule | `src/ace/transformers/` + register it in `index.ts` |
| Teach Quickfill another paste shape | the detection ladder in `quickfill-extension/src/paste.ts`. Never a format picker: one box is the product |
| Fix a selector after an ACE change | the mapping's `candidates`, per `docs/ACE-MAPPING.md` |
| Add a validation rule | `src/excel/validator.ts` |
| Add QuickBooks (phase 2) | a new producer of `CanonicalShipment`; nothing downstream changes |
| Teach Deckhand a new email shape | a rule in `deckhand/src/extract/` and a fixture in `tests/fixtures/deckhand/` |
| Read PDFs or a mailbox | a `DocumentReader` in `deckhand/src/readers/`, registered in `deckhand/src/extractor.ts` |
| Change what the package carries or how the halves merge | `shared/src/filingPackage.ts`, `shared/src/builder.ts` |
| Add an INTTRA field | `inttra-extension/src/mappings/<screen>.ts` |
| Fix an INTTRA selector after capture | paste it in the INTTRA panel's Diagnostics, then make it permanent in the mapping |
| Add a destination (another portal) | a third extension reading `FilingPackage`; nothing upstream changes |
| Add a screen to the dashboard | a renderer in `web/src/views/` over the existing state; no new rule, the rules live in `src/`, `shared/`, `deckhand/` |
| Let the dashboard keep a shipment between page loads, or share one | a decision first: `docs/WEB-DASHBOARD.md` section 10 |
