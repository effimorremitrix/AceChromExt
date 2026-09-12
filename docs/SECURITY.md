# Security and privacy

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

`npm run smoke` additionally confirms in a real browser that an outbound
`fetch` and an inline `<script>` are both refused by the CSP on the extension
pages, and that ACE's Save Line button is never clicked during a fill.

## Reporting

Security issues in this extension should go to the repository owner privately,
not into a public issue.
