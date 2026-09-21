# Installing ACE Helper, INTTRA Helper and Quickfill Helper

All three are unpacked Chrome extensions. None is on the Chrome Web Store, so
each is loaded in developer mode from a folder you build locally: `dist/` for
the ACE Helper, `dist-inttra/` for the INTTRA Helper, `dist-quickfill/` for the
Quickfill Helper. Load any one, any two, or all three; they do not depend on
each other and each keeps its own storage.

Which to install:

| | Install |
| --- | --- |
| You want the preview, the data quality checks, the mapping status and the F2 calculator | **ACE Helper** |
| You file shipping instructions on INTTRA | **INTTRA Helper** |
| You want one paste box and one click, and you check the form yourself | **Quickfill Helper** - read [QUICKFILL.md](QUICKFILL.md) section 3 first: it lists every check it drops and what that costs |

## 1. Prerequisites

- Google Chrome or Microsoft Edge, version 114 or newer
- Node.js 20 or newer (only to build; the extension itself needs nothing at runtime)

## 2. Build

```bash
npm install
npm run verify      # typecheck + tests + template + all builds + all bundle checks
```

`npm run verify` writes the ACE Helper to `dist/`, the INTTRA Helper to
`dist-inttra/` (same layout: `manifest.json`, `popup.html`, `panel.html`,
`styles/`, `inttraContent.js`, `popup.js`, `panel.js`, `serviceWorker.js`,
`icons/`), and the Quickfill Helper to `dist-quickfill/` (no panel; just
`manifest.json`, `popup.html`, `styles/`, `quickfillContent.js`, `popup.js`,
`serviceWorker.js`, `icons/`):

```
dist/
  manifest.json
  popup.html      panel.html      styles/ui.css
  popup.js        panel.js
  aceContent.js   serviceWorker.js
  icons/          templates/ACE_Import_Template.xlsx
```

Rebuilding after a change, once the first `verify` has passed:

```bash
npm run build:all   # all three extensions, no checks
```

Then press the reload button on each extension's card in `chrome://extensions`
and check the `build ...` stamp in the helper's header, which carries the git
commit and build time: an unpacked build that was not reloaded looks identical
until you read it.

Individual steps, if you prefer:

| Command | What it does |
| --- | --- |
| `npm run build:all` | builds all three of the below in one press |
| `npm run build` | builds `dist/` (ACE Helper) |
| `npm run build:inttra` | builds `dist-inttra/` (INTTRA Helper) |
| `npm run build:quickfill` | builds `dist-quickfill/` (Quickfill Helper) |
| `npm run build:watch` / `build:inttra:watch` | rebuilds on every change (then press the reload button in `chrome://extensions`) |
| `npm test` | runs the test suite |
| `npm run typecheck` | TypeScript, no emit |
| `npm run template` | regenerates `templates/ACE_Import_Template.xlsx` |
| `npm run icons` / `icons:inttra` / `icons:quickfill` | regenerates the PNG icons of each extension |
| `npm run check:bundle` | checks the built `dist/` for eval, network APIs, and any URL host but CBP - covers bundled dependencies, not just our own source |
| `npm run check:bundle:inttra` | the same check on `dist-inttra/`, allowing only INTTRA and e2open hosts |
| `npm run check:bundle:quickfill` | the same check on `dist-quickfill/`, allowing both portals' hosts - Quickfill is the only extension that may name both |
| `npm run smoke` | end-to-end test: loads `dist/` into a real Chromium, serves the mock ACE screens *from the ACE host* by request interception, and drives F2, import, and both Fill buttons. Needs `dist/` built first; set `CHROME_PATH` if Chrome is not in a standard location. It never contacts the real ACE portal. See the note below on which Chrome build to point it at. |

## 3. Load it into Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `dist/` folder (not the repository root).
5. Pin "ACE Helper" to the toolbar so the popup is one click away.
6. For the INTTRA Helper, repeat with the `dist-inttra/` folder.
7. For the Quickfill Helper, repeat with the `dist-quickfill/` folder. Its icon
   is the amber "Q", so the three are told apart in the toolbar. It has no
   panel: the popup is the whole interface.
8. Each helper's header shows `build <version>+<commit>.<time>`, the stamp of
   the folder Chrome loaded (also shown as the version in `chrome://extensions`).
   If it is not the build you just ran, Chrome is still running an older
   folder: reload the card, then the portal tab.
9. To practise a fill without a portal, load a playground build the same way,
   turn on **Allow access to file URLs** on its card, and open
   `playground/step1-shipment.html` from that folder. Both run on local pages
   only and can never reach a portal:

   | Build | Folder, or CI artifact | What it drives |
   | --- | --- | --- |
   | `npm run build:playground` | `dist-ace-playground/`, `ace-playground-unpacked` | the ACE Helper panel: import, preview, checks, the reference counter, fill (`docs/USER-GUIDE.md` section 4) |
   | `npm run build:quickfill:playground` | `dist-quickfill-playground/`, `quickfill-playground-unpacked` | the Quickfill popup: one paste box (`docs/QUICKFILL.md` section 5a) |

   Load whichever you are practising; loading both at once means two helpers
   answering on the same page.

## 4. Check it is alive

1. Open your ACE filing at `https://ace.cbp.dhs.gov/...` and sign in as usual.
   ACE Helper does not touch authentication; log in exactly as you do today.
2. Click the toolbar icon. The header should show the detected step, for
   example `Step 3: Commodities (high confidence)`.
3. Click into any numeric field on the ACE page and press **F2**. The
   calculator should appear beside the field.

If the header says "No ACE tab detected", the ACE tab is either not open or is
on a host outside the extension's permissions (see below). Reload the ACE tab
after installing the extension: content scripts are only injected into pages
loaded *after* the extension was installed or reloaded.

## 5. Permissions, and why each one exists

| Permission | Why |
| --- | --- |
| `storage` | remembers your settings, and holds the imported shipment in session memory |
| `https://ace.cbp.dhs.gov/*`, `https://aesdirect.cbp.dhs.gov/*`, `https://*.cbp.dhs.gov/*` | the only pages the extension may read or write |

There is no `tabs`, no `<all_urls>`, no `scripting`, no `downloads`, and no
network permission of any kind. The extension page CSP pins `connect-src` to
`'none'`, so the extension cannot make a network request even by accident.

The INTTRA Helper asks for the same single `storage` permission and for
`https://*.inttra.com/*` and `https://*.e2open.com/*` only. The Shipping
Instructions screens were confirmed on 2026-09-17 to be served from
`ship.inttra.e2open.com`, which the second of those patterns covers; if your
agency reaches them under some other domain, see
`docs/INTTRA-INTEGRATION.md` section 2.

If your agency reaches ACE through a different hostname, add it to both
`host_permissions` and `content_scripts.matches` in `extension/manifest.json`,
and to `ACE_URL_PATTERNS` in `src/ui/tabs.ts`, then rebuild.

## 6. Updating

```bash
git pull
npm install
npm run verify
```

Then click the reload arrow on the ACE Helper card in `chrome://extensions`,
and reload any open ACE tab. The same for the INTTRA and Quickfill cards. The
`build` stamp in each header changes with every build; if it did not, the
reload did not take.

## 7. Uninstalling

Remove the extension from `chrome://extensions`. Settings are removed with it.
Imported shipment data was only ever in memory, so nothing is left on disk.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to
`main`:

| Job | What it runs |
| --- | --- |
| **Verify** (Node 20 and 22) | typecheck, the 700 unit tests, all three builds, and a check that the committed template and both icon sets still match their generators |
| **Bundle supply-chain check** | `npm run check:bundle` against `dist/`, `npm run check:bundle:inttra` against `dist-inttra/`, and `npm run check:bundle:quickfill` against `dist-quickfill/` |
| **End-to-end** | `npm run smoke` against the mocked ACE host, in a pinned Chrome for Testing build |

The Verify job uploads the built unpacked extension as a workflow artifact
(`ace-helper-unpacked`, kept 14 days), so a reviewer can download and load it
without building anything.

Both Node versions in the matrix are tested, and the workflow uses only
first-party `actions/*` steps with `permissions: contents: read`.

### Which Chrome the smoke test needs

**Branded Google Chrome 137 or newer will not work.** It disables the
`--load-extension` command-line switch, so the extension silently never loads
and the test times out waiting for its service worker. (The test says so
explicitly rather than reporting a bare timeout.)

Use a build that still supports loading an unpacked extension:

- **Chrome for Testing** - what CI pins (`CHROME_VERSION` in the workflow).
  Download the `linux64`/`mac-*`/`win64` zip for a version from
  <https://googlechromelabs.github.io/chrome-for-testing/> and point
  `CHROME_PATH` at the extracted binary.
- **A Playwright-managed Chromium**, e.g. `PLAYWRIGHT_BROWSERS_PATH`'s
  `chromium/chrome-linux/chrome`.

```bash
CHROME_PATH=/path/to/chrome-linux64/chrome npm run smoke
```

Loading the extension by hand in your everyday branded Chrome is unaffected -
`chrome://extensions` -> Load unpacked works normally. The restriction only
applies to the command-line switch that automation uses.

## Build notes

- `xlsx@0.18.5` (SheetJS) is bundled from npm. Workbooks are read as arrays of
  arrays (`header: 1`), and a file must start with the ZIP magic bytes, which
  together keep the two published SheetJS advisories out of reach - see
  `docs/SECURITY.md`.
- `vitest` is a development dependency only; nothing from it ships in `dist/`.

## The QuickBooks companion

`npm run build` builds the extension. The QuickBooks Desktop companion is a
separate program with a separate output:

```bash
npm run build:companion        # -> dist-companion/
npm run qb -- --help
```

Copy `dist-companion/` to the Windows PC that runs QuickBooks; it needs Node 20+
and the QuickBooks Desktop SDK there, and nothing else. Installation,
authorization and troubleshooting:
**[QUICKBOOKS-INTEGRATION.md](QUICKBOOKS-INTEGRATION.md)**.
