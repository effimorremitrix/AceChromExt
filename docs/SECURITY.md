# Security and privacy

This document covers five programs that ship from this repository:

- **the ACE Helper extension** (`src/` -> `dist/`), which runs in Chrome;
- **the INTTRA Helper extension** (`inttra-extension/` -> `dist-inttra/`),
  which runs in Chrome, separately; see [INTTRA Helper](#the-inttra-helper);
- **the Quickfill Helper extension** (`quickfill-extension/` ->
  `dist-quickfill/`), which runs in Chrome and reaches both portals; see
  [Quickfill Helper](#the-quickfill-helper);
- **the QuickBooks companion** (`companion/` -> `dist-companion/`), which runs
  on the Windows PC beside QuickBooks Desktop;
- **the operator dashboard** (`web/` -> `dist-web/`), a static page hosted on
  Cloudflare that runs in the operator's browser; see
  [The operator dashboard](#the-operator-dashboard).

Two pure modules are bundled into all of them and carry no capability of their
own: `deckhand/` (email extraction) and `shared/` (the filing package). See
[Deckhand and the filing package](#deckhand-and-the-filing-package).

They are built separately and on purpose. The extension's guarantees below are
enforced by checks over `src/` and `dist/`; the companion legitimately needs to
spawn a process and open a loopback socket, and keeping it out of the
extension's build means those checks never had to be relaxed to accommodate it.
The companion's own guarantees are in [Companion](#the-quickbooks-companion).

## What this extension does not do

| Not done | Enforced by |
| --- | --- |
| `eval()`, `new Function`, dynamic code | hand-written arithmetic parser; MV3 CSP; no such call in the codebase |
| Remote script loading | everything is bundled by esbuild; `script-src 'self'` |
| Network requests | no `fetch`/`XHR`/WebSocket anywhere; `connect-src 'none'` on extension pages; no network permission |
| Credential handling | ACE sign-in, MFA, and CAPTCHA are never read or automated |
| Cloud upload or analytics | there is no server, no endpoint, no telemetry |
| Automatic submission or certification | `filler.ts` never clicks an ACE control; asserted by a test |
| Bypassing ACE validation | values are written through normal input events; ACE's own validation runs unchanged, and a rejected value is reported as a failure |

## Permissions

```json
"permissions": ["storage"],
"host_permissions": [
  "https://ace.cbp.dhs.gov/*",
  "https://aesdirect.cbp.dhs.gov/*",
  "https://*.cbp.dhs.gov/*"
]
```

No `tabs`, no `<all_urls>`, no `scripting`, no `downloads`, no `webRequest`.
(Those are the ACE Helper's. The INTTRA Helper's are the same list against its
own hosts; the Quickfill Helper adds `scripting`, and only that, for one
purpose described in its own section below.)
The content script is declared for the same three patterns, so the extension
has no reach outside CBP hosts. `src/ui/tabs.ts` re-checks the host of any tab
it addresses.

## Data handling

| Data | Storage | Lifetime |
| --- | --- | --- |
| Settings (rounding, debug mode, ...) | `chrome.storage.local` | until uninstall |
| Imported shipment and customer data | `chrome.storage.session` (memory-backed, not on disk, not page-readable) | until the browser closes, or Clear Imported Data |
| ACE credentials | never touched | - |

The workbook itself is read with `File.arrayBuffer()` in the extension page and
is never copied anywhere.

## XSS posture

All extension UI is built with `createElement` + `textContent`
(`src/ui/dom.ts`). There is no `innerHTML` assignment of dynamic content, so a
spreadsheet cell or an ACE label can never be interpreted as markup. The two
`innerHTML` uses in the calculator are literal `<kbd>` hints with no
interpolation.

## SheetJS advisories

`xlsx@0.18.5` is the newest version on the npm registry and carries two
published advisories. The fixed releases are distributed from the SheetJS CDN,
which this build environment cannot reach, so both are mitigated in code:

| Advisory | Mitigation |
| --- | --- |
| GHSA-4r6h-8v6p-xvw6 - prototype pollution in `sheet_to_json` | sheets are read with `header: 1`, i.e. as arrays of arrays. No object is ever built from sheet-controlled keys, which is what the advisory depends on. A test asserts a `__proto__` header does not pollute `Object.prototype` |
| GHSA-5pgg-2g8v-p4x9 - ReDoS in the legacy parsers | a file must start with the ZIP magic bytes `PK\x03\x04` and have a `.xlsx`/`.xlsm`/`.xltx` name, so SheetJS never content-sniffs into the `.xls`/dBASE/text parsers. Files are also size- and row-capped (15 MB, 5000 rows) |

Worth doing when the CDN is reachable: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`,
then keep both mitigations anyway.

`vitest` carries a moderate advisory in `@vitest/mocker`'s redirect-mock
feature. It is a development-only dependency, the feature is not used, and
nothing from it ships in `dist/`.

## Threat model notes

- **A malicious workbook** is data, not code: it is parsed into arrays, and
  every value is normalized or rejected before it reaches the DOM as text.
- **A compromised ACE page** could read the calculator's shadow root (it is
  `open`) and the host element. Neither holds anything the page did not already
  have: the expression the user typed for that page's own field.
- **The extension cannot exfiltrate** what it reads: it has no network
  permission and its CSP forbids outbound connections.

## Invariants enforced by tests

`tests/invariants.test.ts` asserts the promises above against the source, so a
future change breaks a test rather than a promise:

- no `eval`, `new Function`, string `setTimeout`, or computed dynamic `import`;
- no `fetch`, `XMLHttpRequest`, `WebSocket`, or `sendBeacon`, and no http(s)
  URL in the source outside `cbp.dhs.gov`;
- no `.click()`, `.submit()`, `requestSubmit`, `location =`, or `window.open`
  in the content layer;
- no `.value =` assignment in the content layer outside `fieldWriter.ts`, so
  every ACE write goes through `setAceFieldValue`;
- no `document.cookie`, password handling, `localStorage`, or `sessionStorage`;
- `store.ts` uses `chrome.storage.session` and never `local` or `sync`;
- `innerHTML` is only ever assigned a string literal;
- the manifest stays MV3, `permissions` stays exactly `["storage"]`, hosts stay
  CBP-only in both `host_permissions` and `content_scripts`, the CSP keeps
  `script-src 'self'` + `connect-src 'none'` with no `unsafe-eval`, and there
  are no `web_accessible_resources`.

Each of these was verified to fail when deliberately violated.

`npm run check:bundle` asserts the same promises against the **built** `dist/`
rather than the source, so a bundled dependency - SheetJS included - cannot
introduce `eval`, `new Function`, `fetch`, `XMLHttpRequest`, `WebSocket`,
`sendBeacon`, `EventSource`, `importScripts`, `document.cookie`, or
`localStorage` without failing the build. Any http(s) URL string in the bundle
must belong to an allowlisted domain; today the only matches are XML namespace
identifiers used by SheetJS to compare spreadsheet markup (they are never
dereferenced, which the forbidden-API list above proves) and our own
`cbp.dhs.gov` match patterns. Both checks were verified to fail when
deliberately violated.

The namespace allowlist also carries the ODF and VML identifiers
(`docs.oasis-open.org`, `openoffice.org`, and SheetJS's literal
`macVmlSchemaUri` token) that come with SheetJS's *writer*. Only the
dashboard bundles the writer (it downloads a workbook); the two extension
bundles never contain those strings, and the forbidden-API list proves no
bundle can dereference any of them.

CI (`.github/workflows/ci.yml`) runs the unit suite, the bundle check, and the
end-to-end smoke test on every pull request, so none of these guarantees can
regress unnoticed.

`npm run smoke` additionally confirms in a real browser that an outbound
`fetch` and an inline `<script>` are both refused by the CSP on the extension
pages, and that ACE's Save Line button is never clicked during a fill.

## The QuickBooks companion

### What it does not do

| Not done | Enforced by |
| --- | --- |
| Any outbound network request | there is no `fetch`, no HTTP client, and no URL to anything: everything it talks to is on the same machine |
| Cloud upload, telemetry, analytics | there is no server and no endpoint |
| Storing or reading a QuickBooks password | QuickBooks authorization is the SDK's certificate mechanism; no credential is ever seen |
| Writing to QuickBooks, other than one vendor Bill | one request type, `BillAddRq`, is built in one file and sent only by `ace-export bill --write` after a duplicate, vendor and account check. There is no `Mod`, no `Del` and no other `Add` request anywhere in the code; `tests/invariants.test.ts` pins that list |
| Filing anything | it writes a spreadsheet. The extension then fills fields, and a person submits |
| Inventing customs data | a missing Schedule B, origin or licence code stays blank and is reported as an error |

### QuickBooks authorization

Access is granted through the SDK's **application certificate**, stored inside
the company file, approved once by a QuickBooks Admin, and revocable at any
time under *Edit > Preferences > Integrated Applications*. The companion never
sees, asks for, or stores a QuickBooks password. Only `*QueryRq` requests are
sent, plus one `BillAddRq` on an explicit `bill --write`, so an authorized
session can add a vendor Bill and change nothing else in the company file.

### The COM bridge

The SDK's request processor is 32-bit in-process COM, so the call is made by
the 32-bit Windows PowerShell through `companion/powershell/QbxmlRequest.ps1`.

- The script takes **parameters only**; the request body is read from a file.
  Nothing out of a company file is ever concatenated into a command line, and
  the script contains no `Invoke-Expression`.
- PowerShell is started with `-NoProfile -NonInteractive`, so no user profile
  script runs.
- Request and response live in a private temporary directory created per
  request with mode 0700, and removed in a `finally` block.
- The session is opened and closed per request, so the tool never leaves a
  session held against someone's company file.

### The local window

`ace-export gui` is the one listener in the whole project, and it is opt-in.

- It binds to **127.0.0.1**, never `0.0.0.0`, so nothing on the network can
  reach it.
- Every API request must carry a **token generated for that run**, so another
  program on the same machine cannot drive it by guessing the port.
- The page loads no external script, style, font or image. Its response CSP is
  `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'`,
  with `form-action 'none'` and `base-uri 'none'`.
- Responses carry `no-store`, `nosniff` and `no-referrer`.

### Reading qbXML safely

A qbXML response is untrusted input like any other file. The reader in
`companion/src/qbxml/xml.ts` is deliberately small:

- **`<!DOCTYPE>` is rejected outright**, so there are no entity definitions, no
  external entities, and no "billion laughs" expansion;
- only the five predefined entities and numeric character references are
  decoded, and an unknown entity is left verbatim rather than resolved;
- input size and nesting depth are capped;
- attribute bags are null-prototype objects and an attribute literally named
  `__proto__` is dropped, so a response cannot reach `Object.prototype`.

The configuration file gets the same treatment: unknown keys are dropped, every
field name is validated against the canonical model, and `__proto__` keys are
ignored.

### Data at rest

| Data | Where | Lifetime |
| --- | --- | --- |
| The qbXML request and response | a per-request temp directory, mode 0700 | deleted when the request ends |
| The generated workbook | wherever you pointed `--out` | yours |
| Configuration (`ace-export.config.json`) | the working directory | yours. It holds custom-field names and Schedule B numbers, never credentials |
| QuickBooks credentials | nowhere | never read |

`ace-export.config.json` and `ACE_Invoice_*.xlsx` are in `.gitignore`, so a
real company's item catalogue and a real customer's shipment do not get
committed by accident.

## The INTTRA Helper

A second extension, deliberately not merged into the first: the ACE Helper
keeps its CBP-only reach and the INTTRA Helper its INTTRA-only reach, and
each bundle is checked against its own host allowlist
(`npm run check:bundle:inttra`).

| Not done | Enforced by |
| --- | --- |
| Login, MFA, or any credential handling | never sees one; `tests/inttraInvariants.test.ts` forbids the words `password` and `credential` in its source |
| Pressing Save, Continue, Next, Add Row, Submit, or accepting a declaration | `automationPolicy.ts` names each switch and freezes it off; no `.click()`, `.submit()`, `MouseEvent` or `PointerEvent` anywhere in its content layer |
| Headless or unattended operation | it is a content script that answers a popup; there is nothing to run it |
| Network access | no `fetch`, no network permission, `connect-src 'none'` |
| Reaching outside INTTRA | `host_permissions` and `content_scripts.matches` are `https://*.inttra.com/*` and `https://*.e2open.com/*`; no `<all_urls>`; the tab helper re-checks the host |
| Writing outside `setInttraFieldValue` | no `.value =` or `.textContent =` in the content layer outside `fieldWriter.ts` |
| Guessing a field or a grid column | a field is written only when exactly one control matched; a grid column only when its heading was identified |

| Data | Storage | Lifetime |
| --- | --- | --- |
| The loaded package and Deckhand extraction | `chrome.storage.session` | until the browser closes, or Clear Data |
| Settings and captured selectors | `chrome.storage.local` | until uninstall; no shipment data, no credential |
| INTTRA credentials | never touched | - |

## The Quickfill Helper

A third extension, and the only one that reaches both portals. Its host list is
the reason it is separate rather than a mode inside one of the other two: the
ACE Helper keeps its CBP-only reach and the INTTRA Helper its INTTRA-only reach,
and an operator who works one portal installs one helper. Its bundle is checked
against its own combined allowlist (`npm run check:bundle:quickfill`).

**Quickfill deliberately removes checks, and removes no guarantee.** It has no
preview, no data quality checks, no ISO 6346 block, no Deckhand review or
approval, no conflict screen and no fill gate; it overwrites without asking and
resolves a source disagreement in the carrier email's favour without saying so.
Every one of those is a data-accuracy decision that the operator now makes by
reading the form, and each is listed with its cost in `docs/QUICKFILL.md`
section 3. None of them is a security control, and none of the rows below moves.

| Not done | Enforced by |
| --- | --- |
| `eval()`, `new Function`, a string timer, a dynamic `import()` | none in its source; MV3 CSP `script-src 'self'`; re-checked against the built bundle |
| Network requests | no `fetch`/`XHR`/`WebSocket`/`EventSource`/`sendBeacon` and no http(s) URL at all in its source; no network permission; `connect-src 'none'` |
| Pressing Save, Save Line, Add Line, Add Row, Continue, Submit or Certify | it fills through the other two extensions' fillers, whose `automationPolicy.ts` switches are frozen off; no `.click()`, `.submit()`, `MouseEvent` or `PointerEvent` in its content layer; it declares no policy file of its own, so there is no second place to turn one on |
| Credential handling | never sees one; `tests/quickfillInvariants.test.ts` forbids the words `password` and `credential` and any `document.cookie` |
| Persistence | no `localStorage`, `sessionStorage`, IndexedDB or `caches`; the pasted shipment lives in `chrome.storage.session` only; nothing injected outlives the tab |
| Reaching outside the two portals | `host_permissions` and `content_scripts.matches` are exactly the three CBP patterns plus `https://*.inttra.com/*` and `https://*.e2open.com/*`; no `<all_urls>`; the manifest is pinned field by field |
| Injecting anything but its own content script | `scripting` is used in one place, `src/ui/popup.ts`, to start `quickfillContent.js` in a tab that is not running it (`docs/QUICKFILL.md` section 5b). `tests/quickfillInvariants.test.ts` asserts the one caller, the file by name, and no `func`, no `args`, no `world` (so never the page's own world), no `registerContentScripts` and no `insertCSS`. Chrome refuses the call outside `host_permissions`, and the popup does not make it where the tab reports no URL |
| A second selector table or a second write path | it declares no `mappings/` or `selectors/` folder and imports neither field writer directly, so every write still goes through `setAceFieldValue` / `setInttraFieldValue` with its read-back |
| Guessing | several containers and one ACE container field leaves the field empty; a grid shorter than the container list is filled as far as it goes |

| Data | Storage | Lifetime |
| --- | --- | --- |
| The pasted text and the package built from it | `chrome.storage.session` | until the browser closes, or Clear |
| Settings | none; it has none | - |
| Portal credentials | never touched | - |

There is no session log and no diagnostics snapshot: Quickfill keeps no record
of what it wrote. If an audit trail is wanted for a filing, use the ACE Helper,
which writes one, or keep the `filing-package.json`.

## Deckhand and the filing package

`deckhand/` and `shared/` are data code. `tests/invariants.test.ts` and
`tests/independence.test.ts` assert that neither calls `eval`, `fetch`, a
socket or a string timer, names an http(s) URL, touches `chrome.*`, a DOM,
`localStorage` or `sessionStorage`, imports from either extension's content
layer or from the companion, or pairs a seal with a container by array index.

An email is untrusted input. It is parsed by regular expressions into strings
that only ever become text nodes and input values. A `.eml` is read without
rendering: the text/plain part is decoded, an HTML-only part has its tags
stripped. A `filing-package.json` and a `deckhand-*.json` are untrusted input
too: both parsers check shapes, enumerations and sizes, drop unknown and
`__proto__` keys, recompute every container's ISO 6346 status rather than
trusting it, and the package parser rebuilds the merged values from the two
halves and the operator's decisions, so a hand-edited merged value cannot get
in.

The companion's `ace-export package` and `ace-export deckhand` write files to
the directory the operator names and nowhere else. `filing-package-*.json`
and `deckhand-*.json` are in `.gitignore`.

## The operator dashboard

A static web page, hosted on Cloudflare, that runs the same import,
extraction, package and readiness code as the panels, in the operator's
browser. The hosting serves files; it never receives a shipment.

| Not done | Enforced by |
| --- | --- |
| Any request from the page | no `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, worker or `postMessage` in `web/src` (`tests/webInvariants.test.ts`); none in the built bundle (`npm run check:bundle:web`, empty host allowlist); `connect-src 'none'` in the page's `<meta>` CSP and in the `_headers` the host serves |
| Server-side code or storage | `web/wrangler.jsonc` has no `main` and no binding of any kind; the test fails if one appears |
| Keeping a shipment in the browser | no `localStorage`, `sessionStorage`, IndexedDB, `caches`, `navigator.storage` or cookie; the shipment lives in page memory and is gone with the tab. The package file is how it is kept |
| Filling a portal | no import of any content script, field writer, filler or grid writer; no `chrome.*`; the hand-off to the extensions is a downloaded file |
| Loading anything remote | `index.html` loads one local script and two local stylesheets; the CSP is `default-src 'none'` with `script-src 'self'`, `style-src 'self'`, `form-action 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` |
| Credential handling | there is no login; the page holds nothing until a file is chosen. Who may open the URL is a hosting decision (Cloudflare Access, an internal name), outside the page |
| Changing the extensions | both manifests are asserted unchanged (storage only, portal hosts only, no dashboard host), and nothing under `src/`, `inttra-extension/`, `companion/`, `deckhand/` or `shared/` may import from `web/` |
| Depending on the host | `wrangler` is not a dependency; the repository's dependency list stays `xlsx`. The local programs may not name a hosting provider (`tests/independence.test.ts`) |

| Data | Where | Lifetime |
| --- | --- | --- |
| Imported workbook, email text, extraction, package, decisions | page memory | until the tab closes, or Close shipment |
| Downloaded `filing-package.json`, `ACE_Invoice_*.xlsx` | wherever the operator saves them | theirs |
| Anything on Cloudflare | the static files of the page | no shipment data, ever |

Response headers served with the page: the CSP above,
`Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`,
`Cache-Control: no-store`.

Threat model notes:

- **The hosting account** can change the page. That is the one trust the
  dashboard adds: whoever can deploy can serve a different `dashboard.js`.
  The deploy workflow re-runs the invariants and the bundle check before
  deploying, and the deployed bundle can be compared to a local
  `npm run build:web` of the same commit. A compromised host still cannot
  reach QuickBooks or either portal: the page has no route to any of them.
- **A malicious file** is data, exactly as in the extensions: the workbook
  is parsed into arrays, the package and the email are parsed by the shared
  defensive parsers, and everything reaches the DOM as text.
- **Another tab** cannot read the page's memory; the page opens no channel
  to any other context.

## Reporting

Security issues in these programs should go to the repository owner privately,
not into a public issue.


---

## Phase 3 additions

### The session log

Import, every transformation and every fill are recorded so that "ACE has the
wrong weight on line 2 - where did that come from?" has an answer after the
fact as well as before it.

| | |
| --- | --- |
| Where | `chrome.storage.session` - memory-backed, not written to disk by the extension, gone when the browser closes |
| Contains | invoice numbers, weights, values and transformations derived from the shipment |
| Credentials | none. ACE Helper never sees an ACE, Login.gov or QuickBooks credential, and `makeEntry` refuses any entry matching a credential pattern rather than relying on that |
| Leaves the machine | never. **Copy diagnostics** writes to the clipboard; **Export diagnostics** writes a file via a Blob URL. There is no third path - the extension has no network permission and `npm run check:bundle` fails the build if a network API appears |
| Cleared by | **Clear Imported Data**, which clears the log with the shipment because the log holds values derived from it; **Clear log** in Diagnostics; closing the browser |

Asserted in `tests/invariants.test.ts` ("the session log").

### Selector overrides

Selectors captured from the live ACE portal can be pasted into the panel rather
than compiled in.

| | |
| --- | --- |
| Where | `chrome.storage.local` - a configuration fact about the portal, so it survives a restart |
| Contains | CSS selectors and label text read off a public form. No shipment, customer or credential data |
| Trust | the JSON is untrusted input. `parseOverrides` checks the strategy, the field key, the CSS selector's syntax, sizes and counts, and refuses `__proto__`. A refusal stores nothing |
| Blast radius | overrides are tried *first*; the built-in candidates stay behind them, so a wrong paste degrades to the previous behaviour rather than breaking the field |
| Read by | the content script, from storage - never accepted from the panel over a message. The side that touches the ACE DOM does not take a selector on trust from another context |

### Auto-fill safety, written down

`src/content/automationPolicy.ts` states that **Save Line**, **Add New Line**,
**Submit** and **Certify** are disabled. They are named and frozen rather than
merely absent, so enabling one is a deliberate edit to a file whose entire
content is the reason not to, and no *setting* can reach them.

`tests/invariants.test.ts` asserts the constants are false and frozen, that no
settings key resembles one, and that no file under `src/content/` or
`src/calculator/` calls `.click()`, `.submit()`, `requestSubmit()`,
`window.open`, or assigns `location`.

### The source seam

`src/sources/` may not import from `companion/`, may not call `fetch`, and may
not open a socket - asserted in `tests/invariants.test.ts`. `WebSource` is
declared and **unavailable**: building it would mean giving the extension a
network permission, which is a decision about the security posture of the whole
tool rather than a code change.
