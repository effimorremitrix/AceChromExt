# ACE Helper

A Chrome (Manifest V3) extension that cuts the manual typing out of preparing
U.S. Customs **ACE / AES export filings**.

It does four things, and stops there:

| | |
| --- | --- |
| **F2 calculator** | ACE numeric fields reject `*`, `/`, `(`, `)`. Press F2 beside any numeric field, type `79833 * 7.94`, press Enter, and only the **result** goes into the field. |
| **Excel import** | A local `.xlsx` becomes a canonical shipment model, in your browser. No upload, no server. |
| **Preview** | Traffic lights per field, with the original cell value beside the ACE value wherever something was transformed. |
| **Fill** | **Fill Current Page** and **Fill Current Commodity Line**, on your click, into the ACE step you have open. |

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

**Phase 1, working, with one caveat you must read.**

The extension builds, installs, and is covered by 210 unit tests plus an end-to-end smoke test that drives a real Chromium with a mocked ACE host. The mapping
*architecture* is complete; the ACE *selectors* are **placeholders** that have
not been captured from the live portal. Until they are verified, filling will
report "no field on this page matched the mapping" for fields it cannot
identify - and it will never write to a field it did not confidently find.

Verifying a selector takes about a minute per field with DevTools:
**[docs/ACE-MAPPING.md](docs/ACE-MAPPING.md)** lists exactly what to capture.

QuickBooks integration is **not** in this phase.

## Quick start

```bash
npm install
npm run verify        # typecheck + tests + template + build -> dist/
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

Full guide: **[docs/USER-GUIDE.md](docs/USER-GUIDE.md)**

## Layout

```
extension/        manifest, HTML shells, CSS, icons   (static, copied to dist/)
src/
  models/         CanonicalInvoice, AceField          (contracts)
  calculator/     parser, calculator, F2 overlay
  excel/          reader, column aliases, canonical mapper, validator
  ace/
    pages.ts      page signatures
    mappings/     shipment | parties | commodities | transportation
    transformers/ numbers | weight | dates | text | codes + registry
  content/        pageDetector, fieldDetector, fieldWriter, filler, highlight
  ui/             app, popup, panel, preview, diagnostics, importer
  core/           settings, messages, store, logger
  background/     service worker
templates/        ACE_Import_Template.xlsx
tests/            210 unit tests, security invariants, e2e smoke test, mock ACE fixtures
docs/             INSTALLATION | USER-GUIDE | ACE-MAPPING | ARCHITECTURE | SECURITY
```

Data flows one way: `Excel -> canonical model -> preview -> ACE`. Every ACE
write goes through the single `setAceFieldValue` helper, which uses the native
value setter and dispatches `input`/`change` so ACE's own framework registers
the value.

More: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**,
**[docs/SECURITY.md](docs/SECURITY.md)**

## Scripts

| Command | Does |
| --- | --- |
| `npm run verify` | typecheck + tests + template + build |
| `npm run build` / `build:watch` | build `dist/` |
| `npm test` / `test:watch` | vitest (210 tests) |
| `npm run smoke` | end-to-end test in real Chromium against a mocked ACE host |
| `npm run typecheck` | tsc, no emit |
| `npm run template` | regenerate the import template |
| `npm run icons` | regenerate the PNG icons |

## Compliance note

ACE Helper is a data-entry aid. It does not validate a filing, does not give
customs advice, and does not replace the filer's review. The accuracy of every
AES filing remains the filer's legal responsibility.
