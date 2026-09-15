# The operator dashboard (web/)

> **Status:** built and tested against the repository's fixtures; not yet
> used by an operator on a real shipment, and not yet deployed to a real
> Cloudflare account from this repository. It changes nothing about the
> three caveats in README.md: the QuickBooks COM hop, the INTTRA selectors
> and the ACE Transportation step still need their live verification, and
> hosting a page does not do any of it.

A web page that gives the operator one screen for the whole preparation:
import the invoice, read the email, review the extraction, build and
check the package, see what ACE and INTTRA will get, see what is still
missing, and download the files the two extensions read. It is hosted so it
is one URL away on any machine; it is **browser-only** so the shipment never
leaves that machine.

```
                         Cloudflare (static files only)
                                    │  serves index.html, dashboard.js, styles
                                    ▼
                         ┌─────────────────────┐
                         │  Operator Dashboard │   runs in the browser
                         │  web/               │   connect-src 'none'
                         └──────────┬──────────┘
        ACE_Invoice_*.xlsx ───▶     │     ◀─── pasted email / .eml
        filing-package.json ──▶     │
                                    │  downloads
                                    ▼
                           filing-package.json          ACE_Invoice_*.xlsx
                            /               \                  │
                   ACE Helper          INTTRA Helper       ACE Helper
                   (Chrome)            (Chrome)            (Chrome)
                        │                    │
                       ACE                INTTRA           you submit both
```

## Contents

1. [What it does, and what it never does](#1-what-it-does-and-what-it-never-does)
2. [What is local and what is hosted](#2-what-is-local-and-what-is-hosted)
3. [The workflow on the screen](#3-the-workflow-on-the-screen)
4. [Getting files in and out](#4-getting-files-in-and-out)
5. [Local development](#5-local-development)
6. [Building and deploying to Cloudflare](#6-building-and-deploying-to-cloudflare)
7. [Environment strategy](#7-environment-strategy)
8. [How it reuses the code, and what is enforced](#8-how-it-reuses-the-code-and-what-is-enforced)
9. [What still needs real-world testing](#9-what-still-needs-real-world-testing)
10. [Optional future: a server-side layer](#10-optional-future-a-server-side-layer)

---

## 1. What it does, and what it never does

The dashboard **prepares**. The extensions **fill**. The operator **submits**.

| Does | Never does |
| --- | --- |
| Opens several shipments side by side, in memory | Stores a shipment in browser storage, a cookie, or on a server |
| Imports an ACE workbook (from `ace-export` or the template) or a `filing-package.json` | Talks to QuickBooks; QuickBooks stays on the Windows PC behind `ace-export` |
| Pastes or loads the carrier email and runs Deckhand's extractor | Reads a mailbox, a PDF or an image (declared unavailable, as in the extensions) |
| Shows the Deckhand review with the same marks, and takes the Approve click | Approves past a failed check digit, a contradicted seal, or an unpaired list |
| Builds the filing package, shows every conflict, takes the operator's pick, records typed values as manual | Overwrites a source value or invents a missing one |
| Computes ACE readiness with the ACE Helper's own checks and mapping status | Fills ACE, or knows whether a selector resolves on the live page |
| Computes INTTRA readiness from the INTTRA Helper's own mapping tables | Fills INTTRA, logs in, or presses anything in a portal |
| Answers "where did this value come from?" for every value | Sends any of it anywhere: the page has no network API and `connect-src 'none'` |
| Downloads `filing-package.json` and the ACE workbook | Pushes anything into an extension: the hand-off is a file, by design |

The Chrome extensions are unchanged. They still have exactly the `storage`
permission, their portal hosts, and `connect-src 'none'`; they do not know
the dashboard exists, and `tests/webInvariants.test.ts` asserts that the
manifests name no dashboard host and that nothing in `src/`,
`inttra-extension/` or `companion/` imports from `web/`.

## 2. What is local and what is hosted

| | Where it runs | What it holds |
| --- | --- | --- |
| **Hosted on Cloudflare** | the edge, as static files | `index.html`, `dashboard.js`, two stylesheets, `_headers`, a `404.html`. No Worker script, no binding, no database, no log of anything but the request for those files. |
| **In the operator's browser** | the page, in memory | the imported workbook, the email text, the extraction, the package, the operator's decisions. Gone when the tab closes. |
| **On the operator's disk** | wherever they save | `filing-package.json`, `ACE_Invoice_<n>.xlsx`, saved Deckhand JSON. The audit trail. |
| **On the QuickBooks PC** | `ace-export`, over local COM | the company file, read-only, never reachable from the Internet |
| **In Chrome, on the portals** | the two extensions | the fill, in front of the form, and the operator's submission |

Nothing in the first row can see anything in the second: the page's CSP is
`default-src 'none'; script-src 'self'; style-src 'self'; ... connect-src
'none'`, set both in `index.html` and in the `_headers` file the host serves,
so a `fetch` would be refused by the browser even if one were added, and the
bundle check (`npm run check:bundle:web`) fails the build if one is.

Why not keep the shipment in the browser between reloads? Because the
extensions do not either: they hold it in `chrome.storage.session`, which is
memory-backed and not on disk. The dashboard follows the same posture, and
the package file is how a shipment is kept. If persistence across reloads is
wanted later, it is a decision (section 10), not a quiet change.

## 3. The workflow on the screen

Eight tabs, in the order of the work:

| Tab | Shows | Reuses |
| --- | --- | --- |
| **Overview** | status lines, ACE and INTTRA readiness at a glance, the numbered list of what is still to do with the next open step highlighted, the two download cards, the activity log | `fillGate`, the readiness module |
| **Import** | the file picker and drop zone, the invoice summary, the ten data quality checks, the import notes, the preview cells with original / ACE value | `src/sources`, `buildPreflight`, `buildPreview` |
| **Deckhand** | the panels' Deckhand tab: paste box, Extract, the review rows with marks, Approve | `src/ui/deckhandTab.ts`, `deckhand/` |
| **Package** | the panels' Package tab: header, containers, conflicts with the two choices, notes, typed values, Save, plus Download ACE workbook | `src/ui/packageTab.ts`, `shared/` |
| **ACE readiness** | the data quality checks and the mapping status table (source, original, transformation, ACE value, status) for the shipment and the chosen commodity line; the hand-off steps | `buildPreflight`, `buildMappingStatus`, `aceShipmentFromPackage` |
| **INTTRA readiness** | the fill gate, each INTTRA screen with the value it will get and where it came from, the container grid row by row, the placeholder-selector warning; the hand-off steps | `ALL_INTTRA_MAPPINGS`, `GRID_COLUMNS`, `fillGate` |
| **Provenance** | every header, cargo and container value in one filterable table: value, source, detail, original, transformation | `describeProvenance` |
| **Help** | the operator's guide and the setup guide, readable in the page: `docs/USER-GUIDE.md` and `docs/SETUP-GUIDE.md`, bundled at build time and rendered with the page's own Markdown reader (`web/src/markdown.ts`, createElement only). Links between the two guides switch guides; links to other docs are named, not opened | the docs themselves |

The header holds the shipment picker, **New shipment** and **Open file...**.
The status bar under the tabs says what the last action did. The footer
repeats the two promises: local only, fills nothing.

Colours are the panels' colours: green read with confidence, yellow derived
or low confidence, blue typed by the operator, red missing.

## 4. Getting files in and out

**From the QuickBooks PC to the dashboard.** File-based, on purpose:

```
node ace-export.mjs export CN-1042                        -> ACE_Invoice_CN-1042.xlsx
node ace-export.mjs package CN-1042 --deckhand booking.eml -> filing-package-CN-1042_EBKG18531408.json
```

Copy the file to the machine with the browser (a shared folder, a USB stick,
an internal file share; whatever the office already uses for the workbook)
and import it. Neither `ace-export` nor QuickBooks gets a network connection
out of this, and no connection comes in.

**From the dashboard to the extensions.** Download `filing-package.json`
(both extensions) or the ACE workbook (ACE Helper only), then in Chrome open
the panel, **Import**, choose the file. That is the same import the panels
had before the dashboard existed, and the workbook the dashboard writes is
read by the ACE Helper's `ExcelSource` as a workbook: a round-trip test
asserts the canonical values come back unchanged.

**Later.** A controlled channel from the dashboard into an extension is
possible without touching the domain model (the package is the contract),
but it would mean either a network permission in an extension or
`externally_connectable` in its manifest, and both are decisions about the
security posture of the whole tool. The interfaces are designed so that
such a channel would replace only `web/src/files.ts` and the panels' import
step; nothing in `shared/`, `deckhand/` or the readiness code would change.

## 5. Local development

```bash
npm install
npm run dev:web          # build, watch, serve on http://127.0.0.1:8788/
```

The dev server is esbuild's, bound to the loopback address only. Edit
anything under `web/`, `src/`, `shared/`, `deckhand/` or the INTTRA
mappings and reload. The page behaves exactly as hosted: same CSP (from the
`<meta>` tag), same bundle.

| Command | Does |
| --- | --- |
| `npm run build:web` | build `dist-web/` (minified, no source map) |
| `npm run build:web:watch` | rebuild on change, no server |
| `npm run dev:web` | rebuild on change and serve on `127.0.0.1:8788` (`PORT=` to change) |
| `npm run check:bundle:web` | the supply-chain check over `dist-web/dashboard.js`, allowing no host at all |
| `npm test -- tests/web tests/webInvariants.test.ts` | the dashboard's tests: workflow, readiness, the rendered page, the invariants |
| `npm run verify` | everything, including the two lines above |

Tests live in `tests/web/` (workflow, readiness, the DOM) and
`tests/webInvariants.test.ts` (the promises). The end-to-end test in
`tests/web/workflow.test.ts` runs the qbXML fixture through the companion
adapter into the companion's workbook, imports it in the dashboard, extracts
the sanitized booking email, approves, builds, serializes, re-imports, and
asserts the package and every canonical value are identical; then writes
the ACE workbook and reads it back through the ACE Helper's reader with the
same assertion.

## 6. Building and deploying to Cloudflare

The dashboard is deployed as **Workers static assets**: a folder of files
served by Cloudflare's edge, configured by `web/wrangler.jsonc`, with no
Worker script. (Cloudflare Pages would serve the same folder; the
configuration below is the one Cloudflare recommends for new projects, and
`tests/webInvariants.test.ts` checks it stays a static-only configuration.)

**Once, in the Cloudflare account:** create an API token with the *Workers
Scripts: Edit* permission and note the account id.

**From a machine with this repository:**

```bash
npm ci
npm run verify                                   # includes build:web and check:bundle:web
npx wrangler deploy --config web/wrangler.jsonc               # production
npx wrangler deploy --config web/wrangler.jsonc --env preview # preview
```

`wrangler` is fetched by `npx` at deploy time and is deliberately not a
dependency of this repository (`tests/independence.test.ts` keeps the
dependency list to `xlsx`). It reads `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` from the environment, or logs in interactively.

The first deploy prints the URL (`https://ace-operator-dashboard.<account>.workers.dev`
by default). A custom domain is added in the Cloudflare dashboard under the
Worker's settings; nothing in the repository changes for it.

**From GitHub Actions:** `.github/workflows/deploy-web.yml`.

- Runs on **Run workflow** (choose `preview` or `production`), or on a push to
  `main` that touches the dashboard or the code it reuses, **only if** the
  repository variable `DEPLOY_WEB` is `true`.
- Needs the two secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`,
  added under **Settings → Secrets and variables → Actions** (repository
  secrets), or under **Settings → Environments → production** / **preview**
  to scope them to one environment. Without them the deploy step stops with
  "it's necessary to set a CLOUDFLARE_API_TOKEN environment variable"; the
  steps before it (tests, build, bundle check) still run. The CI workflow
  does not see the secrets; it only builds and checks.
- Before deploying it re-runs the dashboard's invariant and workflow tests
  and the bundle check, so a page that gained a network call or a binding is
  never deployed.

**What Cloudflare must be told, and what it must not be given.** Only the
token above. No environment variable holds a secret the page could read,
because the page reads nothing at runtime: the version and build date are
compiled into `dashboard.js` by esbuild from `package.json`.

Response headers (`web/_headers`, honoured by the static-asset host): the
CSP, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Cache-Control: no-store`. The page also carries the
CSP in a `<meta>` tag so any static host applies it.

## 7. Environment strategy

| Environment | Name on Cloudflare | Deployed by | For |
| --- | --- | --- | --- |
| **preview** | `ace-operator-dashboard-preview` | `--env preview`, or the workflow with `preview` chosen | trying a build before operators see it |
| **production** | `ace-operator-dashboard` | the plain deploy, or the workflow with `production` | the operators' URL |

Both are the same static files; the only difference is the name, so the two
URLs differ. There are no per-environment variables because the page uses
none. Access control (who may open the URL) is a hosting concern: Cloudflare
Access in front of the Worker, or an internal DNS name; the page itself
holds nothing to protect until a file is imported, and nothing then leaves
it.

Version: `package.json` `version` is compiled in and shown in the footer.
Bump it and redeploy to know which build operators are on.

## 8. How it reuses the code, and what is enforced

```
web/
  index.html            the shell: CSP meta, two stylesheets, one script
  _headers              response headers for the static host
  wrangler.jsonc        static assets only; no main, no binding
  styles/dashboard.css  additions on top of extension/styles/ui.css (copied at build)
  src/
    state.ts            Workspace: shipments in memory, one active
    workflow.ts         the steps, as pure functions over a ShipmentRecord
    readiness.ts        ACE readiness, INTTRA readiness, next actions, provenance rows
    exportExcel.ts      the ACE workbook, from the companion's row builder
    files.ts            File in, Blob download out, clipboard
    markdown.ts         the Markdown reader for the guides (blocks -> createElement)
    guides.ts           docs/USER-GUIDE.md and docs/SETUP-GUIDE.md, imported as text at build time
    app.ts              the page: header, tabs, status, the shared tabs, the footer
    views/              overview, import, ace, inttra, provenance, help, shared helpers
    main.ts             mounts the app
scripts/build-web.mjs   esbuild -> dist-web/
tests/web/              workflow, readiness, dashboard (jsdom), fixtures
tests/webInvariants.test.ts
```

What it imports, and from where:

| From | What | Why it is safe |
| --- | --- | --- |
| `src/sources`, `src/excel` | the workbook reader, the source registry, the validator | the ACE Helper's own import path, pure |
| `src/ui/preflight.ts`, `src/ui/mappingStatus.ts`, `src/ui/preview.ts` | the checks, the offline mapping status, the preview cells | pure functions the panel also calls |
| `src/ui/deckhandTab.ts`, `src/ui/packageTab.ts`, `src/ui/dom.ts` | the two shared tabs and the DOM helper | already shared by two panels through a context object; no `chrome.*` |
| `src/core/settings.ts` | `DEFAULT_SETTINGS` | guarded: no `chrome.storage` without `chrome` |
| `deckhand/`, `shared/` | extraction, review, approval, the package | pure by their own invariants |
| `inttra-extension/src/mappings`, `pages.ts` | which package field feeds which INTTRA screen | data-only |
| `companion/src/excel/aceWorkbook.ts` | `buildShipmentRows`, `checkRows`, `sanitizeFileNamePart` | pure; the same rows `ace-export` writes |

`tests/webInvariants.test.ts` fails the build if `web/src`:

- calls `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`,
  `postMessage`, `BroadcastChannel`, a worker or a service worker;
- names any http(s) URL;
- touches `localStorage`, `sessionStorage`, IndexedDB, `caches`,
  `navigator.storage` or `document.cookie`;
- uses `eval`, `new Function`, a string timer or a computed `import()`;
- mentions a password or credential;
- imports any content script, field writer, filler or grid writer, the
  extensions' storage, messaging or UI shells, the companion's transport,
  qbXML, adapter, package writer or CLI, or a `node:` module;
- uses `chrome.*`;

and if `index.html` loads more than its own script, or its CSP or the
`_headers` CSP loses `connect-src 'none'`; or `wrangler.jsonc` gains a
`main` or any binding; or `package.json` gains a runtime dependency or a
hosting-provider dev dependency; or either extension manifest changes its
permissions or names a dashboard host; or anything under `src/`,
`inttra-extension/`, `companion/`, `deckhand/` or `shared/` imports from
`web/`.

`npm run check:bundle:web` asserts the network and dynamic-code promises
against the **built** `dist-web/dashboard.js`, dependencies included, with
an empty host allowlist. (SheetJS's writer carries ODF and VML XML namespace
identifiers; they are allowlisted as namespaces, like the OOXML ones the
extensions already carry, and the same check proves nothing in the bundle
could dereference one.)

`tests/independence.test.ts` still bans the retired repository everywhere,
and now also bans any hosting provider's name from the extensions, Deckhand,
the filing package, the companion, their builds and their tests: the
dashboard is the one hosted surface, and the local programs may not know it
exists.

## 9. What still needs real-world testing

Hosting a page does not test anything the extensions could not. The list is
the repository's existing list, plus two items of its own:

1. **QuickBooks Desktop COM** must still be run against a real QuickBooks
   installation on the Windows PC: `docs/QUICKBOOKS-INTEGRATION.md` section 11.
   The dashboard only ever sees the file `ace-export` wrote.
2. **INTTRA selectors** must still be captured from the live portal:
   `docs/INTTRA-INTEGRATION.md` sections 6 and 7. The INTTRA readiness tab
   says what the helper will try to write, not whether the portal accepts it.
3. **ACE Transportation** (5 fields) and the element ids of Steps 1 to 3
   remain to be captured: `docs/ACE-MAPPING.md`.
4. **A real deploy** from this repository to a Cloudflare account, and a
   check in the deployed page's DevTools that the Network panel shows the
   static files and nothing else while a shipment is imported, extracted,
   built and downloaded.
5. **An operator on a real shipment**, with the time to prepare a filing
   measured with and without the dashboard, and every "where did this come
   from?" question they ask written down.

## 10. Optional future: a server-side layer

**Not built, not approved, documented so it is a decision rather than a
drift.**

The dashboard keeps nothing between page loads. If operators need to reopen
a shipment tomorrow without the file, or two operators need the same
shipment, a persistence layer becomes a question. Three possible answers,
in order of how much they change the security posture:

| Option | Where the data lives | What changes |
| --- | --- | --- |
| **A. Local persistence, opt-in** | the operator's browser (IndexedDB), never the server | the invariant "no browser storage" is replaced by "encrypted at rest with a key the operator holds"; nothing hosted changes |
| **B. Files on a share the office already has** | the office's file share | nothing in the code; a folder convention in the user guide |
| **C. A server-side store** | a Cloudflare binding (D1 or R2 or KV) behind a Worker, behind Cloudflare Access | the page gains `connect-src 'self'`, the config gains `main` and a binding, `tests/webInvariants.test.ts` is rewritten to allow exactly one origin, and a data-retention and access policy is written before the first shipment is stored |

B costs nothing and is the recommendation for as long as it works. A is
where to go next if it does not. C should be built only against a written
requirement, because it turns a tool whose whole premise is that shipment
data stays local into one that holds customer and cargo data on a hosted
service, and that has to be a deliberate product decision with an owner.
None of the three touches `shared/`, `deckhand/`, the canonical model or the
extensions: the package remains the contract.
