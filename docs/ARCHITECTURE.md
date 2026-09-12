# Architecture

## The one-way data flow

```
  XLSX file (local)
        |  src/excel/excelReader.ts        bytes -> arrays of arrays
        v
  raw grid
        |  src/excel/canonicalMapper.ts    semantic normalization + provenance
        v
  CANONICAL SHIPMENT MODEL  ................ src/models/CanonicalInvoice.ts
   { invoice, commodities[], provenance, source }
        |
        |  src/excel/validator.ts          plausibility rules -> issues
        |  src/ui/preview.ts               traffic lights, original vs ACE
        v
  USER REVIEWS, THEN CLICKS FILL
        |
        |  src/ace/mappings/*              declarative field -> selector map
        |  src/ace/transformers/*          presentation for ACE
        |  src/content/pageDetector.ts     which step is on screen?
        |  src/content/fieldDetector.ts    which element is this field?
        v
  src/content/fieldWriter.ts               THE ONLY WRITE PATH
        |
        v
  ACE form  ->  user reviews  ->  USER SUBMITS
```

Nothing flows backwards. The canonical model has no idea ACE exists; the
mappings have no idea Excel exists.

## Why the canonical model sits in the middle

The spreadsheet, ACE's DOM, and (in a later phase) QuickBooks all change for
unrelated reasons. Putting a stable model between them means:

- a spreadsheet-format change touches only `columnAliases.ts` + `canonicalMapper.ts`;
- an ACE DOM change touches only `ace/mappings/*`;
- QuickBooks becomes a second *producer* of the same model, and reuses the
  entire preview / validation / fill pipeline unchanged.

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
| Add an ACE field | the relevant `src/ace/mappings/*.ts` |
| Add a transformation rule | `src/ace/transformers/` + register it in `index.ts` |
| Fix a selector after an ACE change | the mapping's `candidates`, per `docs/ACE-MAPPING.md` |
| Add a validation rule | `src/excel/validator.ts` |
| Add QuickBooks (phase 2) | a new producer of `CanonicalShipment`; nothing downstream changes |
