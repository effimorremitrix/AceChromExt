# ACE Helper, INTTRA Helper, Quickfill Helper, Deckhand

[![CI](https://github.com/effimorremitrix/AceChromExt/actions/workflows/ci.yml/badge.svg)](https://github.com/effimorremitrix/AceChromExt/actions/workflows/ci.yml)

Three Chrome (Manifest V3) extensions, two local programs and one hosted,
browser-only dashboard that cut the manual typing out of preparing U.S.
Customs **ACE / AES export filings** and **INTTRA shipping instructions**,
fed by QuickBooks Desktop and by the emails the carrier and the producer send.

```
  QuickBooks Desktop ──▶ ace-export ──▶ CanonicalShipment ─┐
                                                           ├──▶ FilingPackage ──▶ ACE Helper    ──▶ ACE     (you submit)
  Email / document ────▶ Deckhand ────▶ DeckhandShipment ──┘   (filing-package.json) INTTRA Helper ──▶ INTTRA  (you submit)
                                            ▲
                     Operator Dashboard (web/, hosted as static files, runs in the browser):
                     import, extract, review, build, resolve, see readiness, download the package
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
- **Quickfill Helper** is the same two fills with everything else taken out:
  one side panel, one paste box, a portal toggle and a row of buttons. All
  three helpers open the same way: a panel docked beside the page that stays
  there while you click into the form. Paste the
  carrier email (or a package, or spreadsheet rows), click, the fields fill.
  On an INTTRA screen it offers every route the page has - the header fields,
  the per-container blocks, the container grid, and the clipboard block for
  Copy Container Details - because the live create page carries the grid as a
  modal over it and one of them would otherwise be unreachable. No preview, no
  checks, no review, no approval, no conflict screen, no report - it assumes
  you read the form. It still never saves, submits or certifies.
  **[docs/QUICKFILL.md](docs/QUICKFILL.md)**
- **The operator dashboard** is one web page for the whole preparation:
  import the workbook or a package, run Deckhand, approve, build the package,
  resolve conflicts, see ACE and INTTRA readiness and where every value came
  from, download the files the extensions read. Hosted on Cloudflare as
  static files; everything runs in the browser and nothing is uploaded.
  **[docs/WEB-DASHBOARD.md](docs/WEB-DASHBOARD.md)**

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
  network permission, both CSPs forbid outbound connections, and the hosted
  dashboard's page has `connect-src 'none'` and no network API in its bundle.
- **Never** store a credential, because they never see one.
- **Never** pair a seal with a container by position, or correct a container
  number that fails its check digit.
- No `eval()`, no remote code: expressions go through a hand-written parser
  that can only produce a number.

## Status

**Phases 1 to 5 are built. Four caveats you must read.**

The two extensions, the companion and the dashboard build, install, and are
covered by the unit suite - including an automated end-to-end fixture that
runs the real chain from a QuickBooks invoice plus a booking email to a
filled ACE form and a filled INTTRA container grid, and a second one that
runs the same fixture through the dashboard into a package file and back -
plus a smoke test that drives a real Chromium with a mocked ACE host.

1. **The ACE selectors match by label, not yet by id.** The label wording of
   every field on all four steps was read off the live AESDirect screens
   (Steps 1-3 on 2026-09-14; Step 4, which has three fields, on 2026-09-16)
   and the extension resolves fields by it, so no field is a pure guess any
   more. Six ids were copied from the live DOM on 2026-09-16 (Departure Date,
   1st Quantity, Value of Goods, Shipping Weight, Conveyance Name and
   Transportation Reference Number), so **twenty of the twenty-six fields
   still match by label wording only**; `fieldsWithoutCapturedSelector()` is
   the list and `tests/aceMapping.test.ts` pins it, so it can only shrink.
   Every dropdown is a Select2 combobox over a hidden `<select>`, and no
   dropdown write has ever run against the live portal. Filling never writes
   to a field it did not confidently find. A DevTools capture lifts a field
   from medium to high confidence in about a minute:
   **[docs/ACE-MAPPING.md](docs/ACE-MAPPING.md)** lists exactly what to capture.
   Since Phase 3 a captured selector is **pasted into the panel** and is in
   force on the next fill, with no rebuild and no developer.

2. **The QuickBooks COM call has not been run against a real QuickBooks.**
   There is no Windows machine with QuickBooks Desktop in this toolchain.
   Everything from the qbXML response onwards is tested against saved
   responses, and the request builders are tested against the documented
   schema, but the hop through `QBXMLRP2.RequestProcessor` itself is untested.
   That includes the companion's one write, `bill --write`: whether QuickBooks
   accepts the negative commission line through the SDK is a schema
   assumption until section 11 step f has been run.
   **[docs/QUICKBOOKS-INTEGRATION.md](docs/QUICKBOOKS-INTEGRATION.md) section 11**
   says exactly what to run on the QuickBooks PC and what you should see.

3. **The INTTRA Helper has no captured field selector.** Every field
   selector and every page signature is still a placeholder tested against
   mock screens, so on a real screen the helper mostly reports "not found".
   Two structural selectors were captured from the live DOM on 2026-09-17 -
   the Copy Container Details modal root and the grid container - along with
   the hostname `ship.inttra.e2open.com`. That makes the container grid
   findable, and its cells turn out to be `editableGrid` ones that hold no
   control until clicked, so there the route is **Copy rows and paste**
   rather than Fill. The grid itself, found by its headings, is what
   identifies the screen (a later run that day showed the captured ids alone
   were not enough); its seal headings are dropdowns, read by the option they
   show, and the paste block carries one cell per grid column so it lines up.
   The grid's header row is still to be captured, and a fifth run showed the
   grid to be neither a table nor an ARIA grid; it is now found by the wording
   of its header row, tested against mocks only. The mechanics are tested; the
   field selectors are not.
   **[docs/INTTRA-INTEGRATION.md](docs/INTTRA-INTEGRATION.md) section 5a**
   **[docs/INTTRA-INTEGRATION.md](docs/INTTRA-INTEGRATION.md) section 6** is
   the capture procedure. Deckhand likewise has been shown fixtures, not a
   real inbox.

4. **The Quickfill Helper inherits all three caveats and improves none of
   them.** It shares the ACE and INTTRA mapping tables, so it fills exactly
   what the other two fill and no more - which on the live INTTRA portal is
   currently nothing. It has also never been used on a real shipment, and the
   checks it drops on purpose are listed with their cost in
   **[docs/QUICKFILL.md](docs/QUICKFILL.md) section 3**.

The dashboard (Phase 5) changes none of this: it prepares the same files the
extensions already read, and it has not yet been deployed to a real account
or used on a real shipment. **[docs/WEB-DASHBOARD.md](docs/WEB-DASHBOARD.md)
section 9** lists what it still needs.

## Quick start

```bash
npm install
npm run verify        # typecheck + tests + template + all builds + bundle checks -> dist/, dist-inttra/, dist-quickfill/, dist-web/
```

Then `chrome://extensions` -> Developer mode -> **Load unpacked** -> pick
`dist/` (ACE Helper), again for `dist-inttra/` (INTTRA Helper), and again for
`dist-quickfill/` (Quickfill Helper) if you want the fast path. The three are
independent; install only the ones you need. Reload any ACE or INTTRA tab that
was already open.

Full steps: **[docs/INSTALLATION.md](docs/INSTALLATION.md)**

## Using it

1. Open the side panel (toolbar icon) and download
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

`node ace-export.mjs bill CN-1042` builds the supplier's Bill that mirrors the
invoice (same goods, the invoice's terms and number, a negative commission
line) and previews it with its checks; `--write` adds it to QuickBooks, and
`--excel` writes the calculation as a workbook. It is the companion's one
write, and it has not run against a real QuickBooks yet:
[docs/QUICKBOOKS-INTEGRATION.md](docs/QUICKBOOKS-INTEGRATION.md) sections 6b
and 10c.

What QuickBooks holds - invoice number, date, customer, PO, FOB terms, payment
terms, carrier, line description, quantity and amount - is read directly. Vessel,
booking, container and seal come from QuickBooks custom fields. Schedule B,
origin and licence code are **not** in any accounting system: you configure them
once per item, and anything still missing is flagged rather than guessed.

Full guide: **[docs/QUICKBOOKS-INTEGRATION.md](docs/QUICKBOOKS-INTEGRATION.md)**

## The operator dashboard

```bash
npm run dev:web       # http://127.0.0.1:8788/ - the same page the host serves
```

One screen, eight tabs, in the order of the work: **Import** the workbook
`ace-export` wrote (or the template, or a package), **Deckhand** the email,
**Package** it, read **ACE readiness** and **INTTRA readiness**, ask
**Provenance** where any value came from, and on **Overview** read the
numbered list of what is still to do, then download `filing-package.json`
and, if wanted, the ACE workbook. Both go into the extensions through the
same Import they always had. **Help** shows this repository's user guide
and setup guide inside the page.

It is hosted on Cloudflare as static files and runs entirely in the browser:
no server, no account, no upload, `connect-src 'none'`. QuickBooks stays on
the Windows PC behind `ace-export`; the file is carried over. Deploying:
`npx wrangler deploy --config web/wrangler.jsonc`, or the opt-in
`deploy-web.yml` workflow. **[docs/WEB-DASHBOARD.md](docs/WEB-DASHBOARD.md)**

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
quickfill-extension/
                  Quickfill Helper: manifest, side panel, icons, and src/ - paste.ts (the one
                  input), aceShipment.ts (ungated package -> ACE model), one content script
                  for both portals. No mappings of its own: it uses the two above
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
  ui/             app, sidePanel (the one surface), preview, mappingStatus, preflight,
                  calculatorPanel, diagnostics, importer,
                  liveTab + lastTab (a surface that stays open: re-probing, and
                  the screen the operator was last on),
                  deckhandTab + packageTab (shared with the INTTRA Helper)
  core/           settings, messages, store, sessionLog, logger
  background/     service worker
web/              the operator dashboard: index.html, _headers, wrangler.jsonc (static assets only),
                  src/ (state, workflow, readiness, exportExcel, files, app, views)
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
tests/            unit tests, security invariants for all three extensions and the dashboard,
                  a Phase 1 regression suite, three end-to-end fixtures, a Chromium smoke
                  test, mock ACE + INTTRA screens, qbXML and sanitized email fixtures,
                  and an independence test (no dependency outside this repository)
docs/             USER-GUIDE (start here) | SETUP-GUIDE | INSTALLATION |
                  ACE-MAPPING | ARCHITECTURE | SECURITY | QUICKBOOKS-INTEGRATION |
                  DECKHAND | INTTRA-INTEGRATION | QUICKFILL | END-TO-END-FLOW | WEB-DASHBOARD
.github/workflows CI: verify (Node 20 + 22), three bundle checks, e2e smoke;
                  deploy-web (opt-in, needs Cloudflare secrets)
```

Data flows one way: `QuickBooks -> canonical model -> Excel -> canonical model
-> preview -> ACE`. The canonical model is the same object in both halves, so
QuickBooks is simply a second producer of it and reuses the whole preview,
validation and fill pipeline unchanged. The single exception to "one way" is
the companion's `bill --write`, which sends one `BillAddRq` back into
QuickBooks after a duplicate check; everything else only reads. Inside the extension that seam is
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
| `npm run verify` | typecheck + tests + template + all three extension builds + their three bundle checks + companion build + dashboard build + its bundle check |
| `npm run build:all` | build all three extensions at once: `dist/`, `dist-inttra/`, `dist-quickfill/`. No checks, and not the playgrounds, the companion or the dashboard |
| `npm run build` / `build:watch` | build `dist/` (the ACE Helper) |
| `npm run build:inttra` / `build:inttra:watch` | build `dist-inttra/` (the INTTRA Helper) |
| `npm run build:quickfill` / `build:quickfill:watch` | build `dist-quickfill/` (the Quickfill Helper) |
| `npm run build:companion` | build `dist-companion/` (the QuickBooks companion) |
| `npm run build:web` / `dev:web` | build `dist-web/` (the operator dashboard); `dev:web` also serves it on `127.0.0.1:8788` |
| `npm run qb` | run the companion: `npm run qb -- --help` |
| `npm test` / `test:watch` | vitest |
| `npm run smoke` | end-to-end test in real Chromium against a mocked ACE host (needs Chrome for Testing or a Playwright Chromium; see docs/INSTALLATION.md) |
| `npm run check:bundle` | supply-chain check on `dist/`: no eval, no network APIs, no URL host but CBP |
| `npm run check:bundle:inttra` | the same on `dist-inttra/`, allowing only INTTRA and e2open hosts |
| `npm run check:bundle:quickfill` | the same on `dist-quickfill/`, allowing both portals' hosts |
| `npm run check:bundle:web` | the same on `dist-web/`, allowing no host at all |
| `npm run typecheck` | tsc, no emit |
| `npm run template` | regenerate the import template |
| `npm run icons` / `icons:inttra` / `icons:quickfill` | regenerate the PNG icons of each extension |

## Compliance note

ACE Helper, INTTRA Helper, Quickfill Helper and the operator dashboard are
data-entry aids.
They do not validate a filing or a shipping instruction, do not give customs
or shipping advice, and do not replace the filer's review. The accuracy of every AES filing and every
shipping instruction remains the filer's legal responsibility.
