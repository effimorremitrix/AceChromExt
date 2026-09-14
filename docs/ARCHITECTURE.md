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

The QuickBooks half deliberately rejoins through the **spreadsheet**, not
through a private channel into the extension. A workbook is inspectable,
editable, e-mailable and archivable; a private channel would have meant a
second import path to maintain, a second thing to validate, and a Chrome
extension that had to talk to a local process.

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

## Extending it

| To do this | Change |
| --- | --- |
| Support a new spreadsheet column | `src/excel/columnAliases.ts` |
| Map another QuickBooks custom field | `customFields` in `ace-export.config.json` - no code |
| Read another built-in qbXML element | `builtInCandidates` in `companion/src/mapping/qbToCanonical.ts` |
| Add a second invoice source | implement `InvoiceSourceAdapter` in `companion/src/adapter/` |
| Add an ACE field | the relevant `src/ace/mappings/*.ts` |
| Add a transformation rule | `src/ace/transformers/` + register it in `index.ts` |
| Fix a selector after an ACE change | the mapping's `candidates`, per `docs/ACE-MAPPING.md` |
| Add a validation rule | `src/excel/validator.ts` |
| Add QuickBooks (phase 2) | a new producer of `CanonicalShipment`; nothing downstream changes |
