# Security and privacy

This document covers two programs that ship from this repository:

- **the extension** (`src/` -> `dist/`), which runs in Chrome;
- **the QuickBooks companion** (`companion/` -> `dist-companion/`), which runs
  on the Windows PC beside QuickBooks Desktop.

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
| Writing to QuickBooks | only `*QueryRq` requests are built. There is no `Add`, `Mod` or `Del` request anywhere in the code |
| Filing anything | it writes a spreadsheet. The extension then fills fields, and a person submits |
| Inventing customs data | a missing Schedule B, origin or licence code stays blank and is reported as an error |

### QuickBooks authorization

Access is granted through the SDK's **application certificate**, stored inside
the company file, approved once by a QuickBooks Admin, and revocable at any
time under *Edit > Preferences > Integrated Applications*. The companion never
sees, asks for, or stores a QuickBooks password. Only `*QueryRq` requests are
sent, so an authorized session cannot alter the company file.

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

## Reporting

Security issues in this extension should go to the repository owner privately,
not into a public issue.
