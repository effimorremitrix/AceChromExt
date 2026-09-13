# Installing ACE Helper

ACE Helper is an unpacked Chrome extension. It is not on the Chrome Web Store,
so it is loaded in developer mode from a folder you build locally.

## 1. Prerequisites

- Google Chrome or Microsoft Edge, version 114 or newer
- Node.js 20 or newer (only to build; the extension itself needs nothing at runtime)

## 2. Build

```bash
npm install
npm run verify      # typecheck + tests + template + build
```

`npm run verify` ends by writing the unpacked extension to `dist/`:

```
dist/
  manifest.json
  popup.html      panel.html      styles/ui.css
  popup.js        panel.js
  aceContent.js   serviceWorker.js
  icons/          templates/ACE_Import_Template.xlsx
```

Individual steps, if you prefer:

| Command | What it does |
| --- | --- |
| `npm run build` | builds `dist/` |
| `npm run build:watch` | rebuilds on every change (then press the reload button in `chrome://extensions`) |
| `npm test` | runs the test suite |
| `npm run typecheck` | TypeScript, no emit |
| `npm run template` | regenerates `templates/ACE_Import_Template.xlsx` |
| `npm run icons` | regenerates the PNG icons |
| `npm run check:bundle` | checks the built `dist/` for eval, network APIs, and unexpected URL hosts - covers bundled dependencies, not just our own source |
| `npm run smoke` | end-to-end test: loads `dist/` into a real Chromium, serves the mock ACE screens *from the ACE host* by request interception, and drives F2, import, and both Fill buttons. Needs `dist/` built first; set `CHROME_PATH` if Chrome is not in a standard location. It never contacts the real ACE portal. |

## 3. Load it into Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `dist/` folder (not the repository root).
5. Pin "ACE Helper" to the toolbar so the popup is one click away.

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
and reload any open ACE tab.

## 7. Uninstalling

Remove the extension from `chrome://extensions`. Settings are removed with it.
Imported shipment data was only ever in memory, so nothing is left on disk.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to
`main`:

| Job | What it runs |
| --- | --- |
| **Verify** (Node 20 and 22) | typecheck, the 210 unit tests, build, and a check that the committed template and icons still match their generators |
| **Bundle supply-chain check** | `npm run check:bundle` against the built `dist/` |
| **End-to-end** | `npm run smoke` in the runner's Chrome, against the mocked ACE host |

The Verify job uploads the built unpacked extension as a workflow artifact
(`ace-helper-unpacked`, kept 14 days), so a reviewer can download and load it
without building anything.

Both Node versions in the matrix are tested, and the workflow uses only
first-party `actions/*` steps with `permissions: contents: read`.

## Build notes

- `xlsx@0.18.5` (SheetJS) is bundled from npm. Workbooks are read as arrays of
  arrays (`header: 1`), and a file must start with the ZIP magic bytes, which
  together keep the two published SheetJS advisories out of reach - see
  `docs/SECURITY.md`.
- `vitest` is a development dependency only; nothing from it ships in `dist/`.
