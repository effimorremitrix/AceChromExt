# ACE Helper, INTTRA Helper, Deckhand

[![CI](https://github.com/effimorremitrix/AceChromExt/actions/workflows/ci.yml/badge.svg)](https://github.com/effimorremitrix/AceChromExt/actions/workflows/ci.yml)

Two Chrome (Manifest V3) extensions and two local programs that cut the manual
typing out of preparing U.S. Customs **ACE / AES export filings** and **INTTRA
shipping instructions**, fed by QuickBooks Desktop and by the emails the
carrier and the producer send.

```
  QuickBooks Desktop ──▶ ace-export ──▶ CanonicalShipment ─┐
                                                           ├──▶ FilingPackage ──▶ ACE Helper    ──▶ ACE     (you submit)
  Email / document ────▶ Deckhand ────▶ DeckhandShipment ──┘   (filing-package.json) INTTRA Helper ──▶ INTTRA  (you submit)
```

- **ACE Helper** fills ACE from a spreadsheet or from a filing package, with an
  F2 calculator, a preview, data quality checks and a mapping status screen.
- **INTTRA Helper** fills the Shipping Instructions screens and the Copy
  Container Details grid from the same filing package, one row per container,
  every cell read back. **[docs/INTTRA-INTEGRATION.md](docs/INTTRA-INTEGRATION.md)**
- **Deckhand** reads booking, containers, seals, vessel and ports out of an
  email, pairs a seal with a container only when the document showed them
  together, validates ISO 6346 check digits, and hands nothing on until a
  person approves it. **[docs/DECKHAND.md](docs/DECKHAND.md)**
- **The filing package** composes the invoice and the extraction, records
  where every value came from, flags every disagreement, and is a plain JSON
  file both extensions read. **[docs/END-TO-END-FLOW.md](docs/END-TO-END-FLOW.md)**

The ACE Helper does four things, and stops there:

| | |
| --- | --- |
| **F2 calculator** | ACE numeric fields reject `*`, `/`, `(`, `)`. Press F2 beside any numeric field, type `79833 * 7.94`, press Enter, and only the **result** goes into the field. |
| **Excel import** | A local `.xlsx` becomes a canonical shipment model, in your browser. No upload, no server. |
| **Preview** | Traffic lights per field, with the original cell value beside the ACE value wherever something was transformed. |
| **Fill** | **Fill Current Page** and **Fill Current Commodity Line**, on your click, into the ACE step you have open. |
| **Mapping status** | One row per ACE field: source, original value, transformation, ACE value, ACE field, ACE selector, status. |
| **Data quality checks** | Ten named checks above the Fill buttons, so nothing is typed off a sheet with a blank Schedule B by accident. |
| **Session log** | What was loaded, what was converted, what was filled. Memory only, exportable, uploaded nowhere. |

Alongside it, a **QuickBooks Desktop companion** (`ace-export`) turns an invoice
in QuickBooks into that same `.xlsx`, so the spreadsheet does not have to be
typed either: **[docs/QUICKBOOKS-INTEGRATION.md](docs/QUICKBOOKS-INTEGRATION.md)**.

## What they will never do

- **Never** save a line, continue, submit, certify a filing, or accept a
  declaration. The last click is always yours, in ACE and in INTTRA.
- **Never** navigate a portal for you, or press Add Row in a grid.
- **Never** touch a sign-in, MFA, CAPTCHA, or any other security control.
- **Never** send shipment or customer data anywhere; neither extension has a
  network permission and both CSPs forbid outbound connections.
- **Never** store a credential, because they never see one.
- **Never** pair a seal with a container by position, or correct a container
  number that fails its check digit.
- No `eval()`, no remote code: expressions go through a hand-written parser
  that can only produce a number.

## Status

**Phases 1 to 4 are built. Three caveats you must read.**

The two extensions and the companion build, install, and are covered by 700
unit tests - including an automated end-to-end fixture that runs the real
chain from a QuickBooks invoice plus a booking email to a filled ACE form and
a filled INTTRA container grid - plus a smoke test that drives a real Chromium
with a mocked ACE host.

1. **The ACE selectors match by label, not yet by id.** The label wording of
   every field on Steps 1-3 (Shipment, Parties, Commodities) was captured
   from the live AESDirect screens on 2026-09-14 and the extension resolves
   fields by it; the element ids, the dropdown option values and the
   Transportation step (5 fields) are still uncaptured, so 22 of the 27 fields
   are verified by label and 5 are placeholders. Filling never writes to a
   field it did not confidently find. A DevTools capture lifts a field from
   medium to high confidence in about a minute:
   **[docs/ACE-MAPPING.md](docs/ACE-MAPPING.md)** lists exactly what to capture.
   Since Phase 3 a captured selector is **pasted into the panel** and is in
   force on the next fill, with no rebuild and no developer.

2. **The QuickBooks COM call has not been run against a real QuickBooks.**
   There is no Windows machine with QuickBooks Desktop in this toolchain.
   Everything from the qbXML response onwards is tested against saved
   responses, and the request builders are tested against the documented
   schema, but the hop through `QBXMLRP2.RequestProcessor` itself is untested.
   **[docs/QUICKBOOKS-INTEGRATION.md](docs/QUICKBOOKS-INTEGRATION.md) section 11**
   says exactly what to run on the QuickBooks PC and what you should see.

3. **The INTTRA Helper has never seen the live portal.** Every selector, page
   signature and the exact hostname are placeholders tested against mock
   screens. The mechanics are tested; the selectors are not. A field that
   does not resolve is never written, so on a real screen the helper will
   mostly report "not found" until the selectors are captured.
   **[docs/INTTRA-INTEGRATION.md](docs/INTTRA-INTEGRATION.md) section 6** is
   the capture procedure. Deckhand likewise has been shown fixtures, not a
   real inbox.

## Quick start

```bash
npm install
npm run verify        # typecheck + tests + template + both builds + bundle checks -> dist/, dist-inttra/
```

Then `chrome://extensions` -> Developer mode -> **Load unpacked** -> pick
`dist/` (ACE Helper) and again for `dist-inttra/` (INTTRA Helper). Reload any
ACE or INTTRA tab that was already open.

Full steps: **[docs/INSTALLATION.md](docs/INSTALLATION.md)**

## Using it

1. Open the panel (toolbar icon -> **Open full panel**) and download
   `templates/ACE_Import_Template.xlsx`.
2. Fill it in: **one row per ACE commodity line**; shipment-level columns only
   on the first row.
3. Import it. Read the preview - yellow means an assumption was made for you.
4. In ACE, navigate to the step you want. Click **Fill Current Page** or
   **Fill Current Commodity Line**.
5. Check every field in ACE. **You** save and submit.

Full guide, from invoice and email to ACE and INTTRA:
**[docs/USER-GUIDE.md](docs/USER-GUIDE.md)**. Installing, QuickBooks
configuration and selector capture: **[docs/SETUP-GUIDE.md](docs/SETUP-GUIDE.md)**

## Starting from QuickBooks instead of a spreadsheet

On the Windows PC that runs QuickBooks Desktop:

```bash
npm run build:companion        # -> dist-companion/, copy that folder over
node ace-export.mjs init       # write a configuration
node ace-export.mjs probe      # authorize once, as QuickBooks Admin
node ace-export.mjs export CN-1042
```

```
Ready to export?
  v Invoice number         CN-1042
  v Customer               Aydin Kuruyemis San Ve Tic A.S
  v Invoice date           2026-09-21
  v Commodity description  1/1 line(s) described
  v Amount                 651,217.60 total
  v Weight                 79,832 kg total      (176,000 lb x 0.45359237)

Wrote ACE_Invoice_CN-1042.xlsx
```

Then import that file into the panel exactly as above. `node ace-export.mjs gui`
does the same through a small local window instead of the command line.

What QuickBooks holds - invoice number, date, customer, PO, FOB terms, payment
terms, carrier, line description, quantity and amount - is read directly. Vessel,
booking, container and seal come from QuickBooks custom fields. Schedule B,
origin and licence code are **not** in any accounting system: you configure them
once per item, and anything still missing is flagged rather than guessed.

Full guide: **[docs/QUICKBOOKS-INTEGRATION.md](docs/QUICKBOOKS-INTEGRATION.md)**

## Starting from an email

Paste the carrier's or producer's email into the **Deckhand** tab of either
panel (or load a saved `.eml`), press Extract, and read the review:

```
Booking reference      : EBKG18531408   ✓
Vessel                 : MSC FIRENZE    ✓
Voyage                 : 541W           ✓
Containers
   1. MSCU1234566  ✓  carrier seal SL-4471209  ✓  shipper seal SH-001
   2. MSDU7654322  ✓  carrier seal SL-4471210  ✓
   3. TGHU7654320  ✓  carrier seal SL-9        ✓
Anything I am unsure of : 2 seal(s) appeared with no container beside them ...
```

Approve it, then **Package -> Build filing package**: the invoice and the
extraction become one `filing-package.json` in which every value says where it
came from and every disagreement is a conflict you resolve. The INTTRA Helper
imports that file and fills the Shipping Instructions screens and the container
grid; the ACE Helper imports it too. On the QuickBooks PC the same package
comes from `node ace-export.mjs package CN-1042 --deckhand booking.eml`.

## Layout

```
extension/        ACE Helper manifest, HTML shells, CSS, icons   (static, copied to dist/)
inttra-extension/ INTTRA Helper: manifest, HTML, icons, and src/ (pages, mappings, content, ui)
deckhand/         email/document extraction: model, ISO 6346, rules extractor, readers, review
shared/           the filing package: model, provenance, builder (merge + conflicts), JSON, ACE view
src/
  models/         CanonicalInvoice, AceField          (contracts)
  sources/        InvoiceDataSource: Excel | QuickBooksExport | Web (declared)
  calculator/     parser, calculator, F2 overlay
  excel/          reader, column aliases, canonical mapper, validator
  ace/
    pages.ts      page signatures
    mappings/     WHAT to fill: canonical field, transform, limits
    selectors/    WHERE to find it: the ACE selectors, + operator overrides
    transformers/ numbers | weight | dates | text | codes + registry
  content/        pageDetector, fieldDetector, fieldWriter, filler, highlight,
                  automationPolicy (what is never clicked)
  ui/             app, popup, panel, preview, mappingStatus, preflight,
                  calculatorPanel, diagnostics, importer,
                  deckhandTab + packageTab (shared with the INTTRA Helper)
  core/           settings, messages, store, sessionLog, logger
  background/     service worker
companion/        QuickBooks Desktop companion        (Node, not shipped in the extension)
  src/qbxml/      XML reader, request builders, response parsers
  src/transport/  COM bridge (32-bit PowerShell) | saved-response replay
  src/adapter/    InvoiceSourceAdapter | QuickBooksDesktopAdapter
  src/mapping/    QuickBooks -> canonical, with a field-origin record
  src/excel/      canonical -> ACE_Import.xlsx (+ Audit and Checks sheets)
  src/ui/         cli | preview | the local ACE Export Helper window
  src/package/    ace-export package / deckhand: the filing package on disk
  powershell/     QbxmlRequest.ps1
templates/        ACE_Import_Template.xlsx
tests/            700 unit tests, security invariants for both extensions, a Phase 1
                  regression suite, two end-to-end fixtures, a Chromium smoke test,
                  mock ACE + INTTRA screens, qbXML and sanitized email fixtures,
                  and an independence test (no dependency outside this repository)
docs/             USER-GUIDE (start here) | SETUP-GUIDE | INSTALLATION |
                  ACE-MAPPING | ARCHITECTURE | SECURITY | QUICKBOOKS-INTEGRATION |
                  DECKHAND | INTTRA-INTEGRATION | END-TO-END-FLOW
.github/workflows CI: verify (Node 20 + 22), both bundle checks, e2e smoke
```

Data flows one way: `QuickBooks -> canonical model -> Excel -> canonical model
-> preview -> ACE`. The canonical model is the same object in both halves, so
QuickBooks is simply a second producer of it and reuses the whole preview,
validation and fill pipeline unchanged. Inside the extension that seam is
`InvoiceDataSource`: `ExcelSource` is the Phase 1 path and the fallback,
`QuickBooksExportSource` recognises a companion-written workbook and labels it,
and both parse it with identical code. Every ACE write goes through the single
`setAceFieldValue` helper, which uses the native value setter and dispatches
`input`/`change` so ACE's own framework registers the value.

More: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**,
**[docs/SECURITY.md](docs/SECURITY.md)**

## Scripts

| Command | Does |
| --- | --- |
| `npm run verify` | typecheck + tests + template + both extension builds + both bundle checks + companion build |
| `npm run build` / `build:watch` | build `dist/` (the ACE Helper) |
| `npm run build:inttra` / `build:inttra:watch` | build `dist-inttra/` (the INTTRA Helper) |
| `npm run build:companion` | build `dist-companion/` (the QuickBooks companion) |
| `npm run qb` | run the companion: `npm run qb -- --help` |
| `npm test` / `test:watch` | vitest (700 tests) |
| `npm run smoke` | end-to-end test in real Chromium against a mocked ACE host (needs Chrome for Testing or a Playwright Chromium; see docs/INSTALLATION.md) |
| `npm run check:bundle` | supply-chain check on `dist/`: no eval, no network APIs, no URL host but CBP |
| `npm run check:bundle:inttra` | the same on `dist-inttra/`, allowing only INTTRA and e2open hosts |
| `npm run typecheck` | tsc, no emit |
| `npm run template` | regenerate the import template |
| `npm run icons` / `icons:inttra` | regenerate the PNG icons of either extension |

## Compliance note

ACE Helper and INTTRA Helper are data-entry aids. They do not validate a
filing or a shipping instruction, do not give customs or shipping advice, and
do not replace the filer's review. The accuracy of every AES filing and every
shipping instruction remains the filer's legal responsibility.
