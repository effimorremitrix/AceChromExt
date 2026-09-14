# ACE Helper

[![CI](https://github.com/effimorremitrix/AceChromExt/actions/workflows/ci.yml/badge.svg)](https://github.com/effimorremitrix/AceChromExt/actions/workflows/ci.yml)

A Chrome (Manifest V3) extension that cuts the manual typing out of preparing
U.S. Customs **ACE / AES export filings**.

It does four things, and stops there:

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

## What it will never do

- **Never** saves a commodity line, submits, or certifies a filing. The last
  click is always yours.
- **Never** navigates ACE for you.
- **Never** touches ACE sign-in, MFA, CAPTCHA, or any other security control.
- **Never** sends shipment or customer data anywhere; it has no network
  permission and its CSP forbids outbound connections.
- **Never** stores ACE credentials, because it never sees them.
- No `eval()`, no remote code: expressions go through a hand-written parser
  that can only produce a number.

## Status

**Phases 1, 2 and 3 are built. Two caveats you must read.**

The extension and the companion build, install, and are covered by 545 unit
tests - including an automated end-to-end fixture that runs the real chain from
a QuickBooks invoice to a filled ACE form - plus a smoke test that drives a real
Chromium with a mocked ACE host.

1. **The ACE selectors are placeholders.** The mapping *architecture* is
   complete; the 24 selectors have not been captured from the live portal.
   Until they are verified, filling reports "no field on this page matched the
   mapping" for fields it cannot identify - and it never writes to a field it
   did not confidently find. Verifying one takes about a minute with DevTools:
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

## Quick start

```bash
npm install
npm run verify        # typecheck + tests + template + build + bundle check -> dist/
```

Then `chrome://extensions` -> Developer mode -> **Load unpacked** -> pick
`dist/`. Reload any ACE tab that was already open.

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

Full guide: **[docs/USER-GUIDE.md](docs/USER-GUIDE.md)**.
Everything in one place, QuickBooks included:
**[docs/ACE-HELPER-GUIDE.md](docs/ACE-HELPER-GUIDE.md)**

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

## Layout

```
extension/        manifest, HTML shells, CSS, icons   (static, copied to dist/)
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
                  calculatorPanel, diagnostics, importer
  core/           settings, messages, store, sessionLog, logger
  background/     service worker
companion/        QuickBooks Desktop companion        (Node, not shipped in the extension)
  src/qbxml/      XML reader, request builders, response parsers
  src/transport/  COM bridge (32-bit PowerShell) | saved-response replay
  src/adapter/    InvoiceSourceAdapter | QuickBooksDesktopAdapter
  src/mapping/    QuickBooks -> canonical, with a field-origin record
  src/excel/      canonical -> ACE_Import.xlsx (+ Audit and Checks sheets)
  src/ui/         cli | preview | the local ACE Export Helper window
  powershell/     QbxmlRequest.ps1
templates/        ACE_Import_Template.xlsx
tests/            545 unit tests, security invariants, a Phase 1 regression suite,
                  an end-to-end fixture, a Chromium smoke test, mock ACE + qbXML fixtures
docs/             ACE-HELPER-GUIDE (start here) | INSTALLATION | USER-GUIDE |
                  ACE-MAPPING | ARCHITECTURE | SECURITY | QUICKBOOKS-INTEGRATION
.github/workflows CI: verify (Node 20 + 22), bundle check, e2e smoke
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
| `npm run verify` | typecheck + tests + template + build + bundle check + companion build |
| `npm run build` / `build:watch` | build `dist/` (the extension) |
| `npm run build:companion` | build `dist-companion/` (the QuickBooks companion) |
| `npm run qb` | run the companion: `npm run qb -- --help` |
| `npm test` / `test:watch` | vitest (545 tests) |
| `npm run smoke` | end-to-end test in real Chromium against a mocked ACE host (needs Chrome for Testing or a Playwright Chromium; see docs/INSTALLATION.md) |
| `npm run check:bundle` | supply-chain check on `dist/`: no eval, no network APIs, no unexpected URL hosts |
| `npm run typecheck` | tsc, no emit |
| `npm run template` | regenerate the import template |
| `npm run icons` | regenerate the PNG icons |

## Compliance note

ACE Helper is a data-entry aid. It does not validate a filing, does not give
customs advice, and does not replace the filer's review. The accuracy of every
AES filing remains the filer's legal responsibility.
