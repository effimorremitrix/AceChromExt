# Working in this repository

## Starting a new project in an empty repository

**This section is portable. It is written to be copied verbatim into
`~/.claude/CLAUDE.md` so it applies to every project, not just this one.**

When a session starts in a repository that has no commits yet (`git rev-parse
HEAD` fails, or `git ls-remote --heads origin` returns nothing), create the base
branch *before* doing any work:

```bash
# 1. main first, as an empty root commit
git checkout -b main
git commit --allow-empty -m "Initialize repository"
git push -u origin main

# 2. then the working branch, off main
git checkout -b <feature-branch>
```

Then do the work on the feature branch and open the pull request against
`main`.

After the first push, check which branch GitHub made the default:

```bash
git ls-remote --symref origin HEAD
```

If it is not `main`, tell the user to switch it: **Settings → General → Default
branch → the switch icon (⇄, two crossing arrows) → `main` → Update.** It is a
repository-settings change, so it cannot be done from the CLI or the GitHub MCP
tools; it needs a human in the web UI.

### Why

GitHub makes the **first branch pushed** the default branch. If that is the
feature branch, there is no other branch to open a pull request against, and
`create_pull_request` fails with `PullRequest.base (invalid)`.

### Two ways to get this wrong

- **Renaming the feature branch to `main` afterwards.** GitHub's rename dialog
  warns that it *closes the open pull request*, and it fails outright if `main`
  already exists. Renaming is not the same operation as switching the default;
  the pencil icon renames, the ⇄ icon switches.
- **Rebasing an already-pushed branch onto a new root** to retrofit a base.
  That rewrites published history.

### Recovering when work is already pushed

If the feature branch is already pushed and has become the default, do **not**
rebase. Join an empty root commit with a merge, which makes `main` an ancestor
without rewriting anything:

```bash
EMPTY_TREE=$(git hash-object -t tree /dev/null)
ROOT=$(git commit-tree "$EMPTY_TREE" -m "Initialize repository")
git branch main "$ROOT"
git merge --allow-unrelated-histories --no-ff main -m "Merge the empty root commit as a pull-request base"
git push origin main
git push origin <feature-branch>          # fast-forward, no force needed
```

Verify the merge changed nothing before pushing:

```bash
git diff <sha-before-merge> HEAD          # must be empty
git merge-base --is-ancestor main HEAD    # must succeed
```

The pull request then shows the whole project as its diff, because `main` is
empty.

---

# ACE Helper, INTTRA Helper, Quickfill Helper, Deckhand, the operator dashboard

Three Chrome MV3 extensions (ACE Helper in `extension/` + `src/`, INTTRA Helper
in `inttra-extension/`, Quickfill Helper in `quickfill-extension/`), a
QuickBooks Desktop companion (`companion/`), an email extraction module
(`deckhand/`), the filing package that ties them together (`shared/`), and a
browser-only operator dashboard hosted as static files (`web/`). See
`README.md` for what they do, `docs/ARCHITECTURE.md` for how they fit,
`docs/END-TO-END-FLOW.md` for the whole chain, `docs/QUICKFILL.md` for the
fast path, and `docs/WEB-DASHBOARD.md` for the dashboard.

**This repository stands alone.** Deckhand was migrated in from a retired
repository; `tests/independence.test.ts` fails on any import outside this
tree, any hosted-service dependency, and any mention of the retired
repository outside the one history note in `docs/DECKHAND.md`. Keep it that way.

## Commands

| Command | Use |
| --- | --- |
| `npm run verify` | typecheck + tests + template + all three extension builds + their three bundle checks + companion build + dashboard build + its bundle check. Run before every push. |
| `npm run build` / `build:watch` | build `dist/` (the ACE Helper) |
| `npm run build:playground` | build `dist-ace-playground/`: the same ACE Helper bundles under a manifest that matches local files only, plus the four mock ACE steps and the example workbook (`docs/USER-GUIDE.md` section 4). `check:bundle:playground` runs the bundle check on it |
| `npm run build:inttra` | build `dist-inttra/` (the INTTRA Helper) |
| `npm run build:quickfill` | build `dist-quickfill/` (the Quickfill Helper) |
| `npm run build:quickfill:playground` | build `dist-quickfill-playground/`: the same bundles under a manifest that matches local files only, plus the four mock ACE steps and the example workbook (`docs/QUICKFILL.md` section 5a). `check:bundle:quickfill:playground` runs the bundle check on it |
| `npm run build:companion` | build `dist-companion/` (the QuickBooks companion) |
| `npm run qb -- --help` | run the companion |
| `npm run build:web` / `dev:web` | build `dist-web/` (the operator dashboard); `dev:web` serves it on `127.0.0.1:8788` |
| `npm run check:bundle:web` | the supply-chain check on `dist-web/`, allowing no host at all |
| `npm test` / `test:watch` | vitest |
| `npm run smoke` | end-to-end in real Chrome against a mocked ACE host. Needs Chrome for Testing or a Playwright Chromium - **branded Chrome 137+ will not work** (see `docs/INSTALLATION.md`). |
| `npm run check:bundle` / `check:bundle:inttra` / `check:bundle:quickfill` | supply-chain check on `dist/` (CBP hosts only), `dist-inttra/` (INTTRA/e2open only) and `dist-quickfill/` (both, and only Quickfill may name both) |
| `npm run template` / `icons` / `icons:inttra` / `icons:quickfill` | regenerate the committed generated files |

CI runs all of this on every pull request; `.github/workflows/ci.yml`.

## Rules this codebase enforces on itself

`tests/invariants.test.ts` and `scripts/check-bundle.mjs` fail the build on any
of these, so do not work around them - fix the cause:

- no `eval`, `new Function`, string `setTimeout`, or dynamic `import()`;
- no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, or any http(s) URL
  outside `cbp.dhs.gov`;
- no `.click()`, `.submit()`, or navigation in the content layer - the
  extension never saves a line, submits, or certifies a filing;
- no `.value =` in the content layer outside `fieldWriter.ts`: every ACE write
  goes through `setAceFieldValue`, which uses the native value setter,
  dispatches `input`/`change`, and verifies the read-back;
- no `document.cookie`, password handling, `localStorage`, or `sessionStorage`;
  imported data lives in `chrome.storage.session` only;
- `innerHTML` is only ever assigned a string literal;
- the manifest keeps `permissions: ["storage"]`, CBP-only hosts, and a CSP with
  `script-src 'self'` + `connect-src 'none'`.

`tests/quickfillInvariants.test.ts` holds the Quickfill Helper's, and is the
only place the *deliberate* removals are written down: it asserts no eval, no
network, no credential, no browser storage outside `chrome.storage.session`, no
`.click()`/`.submit()` in its content layer, exactly the five portal hosts and
`permissions: ["storage"]` - and it deliberately does NOT assert a preview, a
check or a gate, because Quickfill has none by design. It also asserts that
`quickfill-extension/` declares no `mappings/` or `selectors/` folder of its own
and imports neither field writer directly, so the code sharing cannot quietly
stop. The three walkers are hardcoded to `src/`, `inttra-extension/` and
`quickfill-extension/`, so a fourth top-level program needs its own file or it
ships with no promises at all.

`tests/inttraInvariants.test.ts` holds the same promises for the INTTRA Helper:
INTTRA/e2open hosts only and never `<all_urls>`, no `.click()` anywhere in its
content layer (not even Add Row), every write through `setInttraFieldValue`,
no credential handling. `deckhand/` and `shared/` are pure: no `chrome.*`, no
DOM, no network, no import from either extension's content layer or from the
companion, and no code path that pairs a seal with a container by position.

`tests/webInvariants.test.ts` holds the dashboard's: `web/src` has no network
API, no http(s) URL, no browser storage, no `chrome.*`, no import of any
content script, filler, grid writer, extension storage or companion runtime;
`index.html` and `_headers` keep `connect-src 'none'`; `web/wrangler.jsonc`
has no `main` and no binding; `package.json` keeps `dependencies` at `xlsx`
and no hosting-provider dev dependency; nothing under `src/`,
`inttra-extension/`, `companion/`, `deckhand/` or `shared/` imports from
`web/`. `tests/independence.test.ts` keeps any hosting provider's name out
of the local programs: only `web/`, its build, its tests, the workflows and
the docs may say it. Do not add a server, a binding, or persistence to the
dashboard without the decision described in `docs/WEB-DASHBOARD.md`
section 10.

## Where things live

Data flows one way: `QuickBooks → canonical model → Excel → canonical model →
preview → ACE`. The one exception is `ace-export bill --write`, which sends a
single `BillAddRq` back into QuickBooks after a duplicate, vendor and account
check; `tests/invariants.test.ts` pins it to that request type, built in
`companion/src/qbxml/requests.ts` and reached only from
`QuickBooksBillWriter.write`. Never add a `Mod`, a `Del` or another `Add`.

| Change | File |
| --- | --- |
| a spreadsheet column | `src/excel/columnAliases.ts` |
| an ACE field | `src/ace/mappings/<page>.ts` |
| an INTTRA field | `inttra-extension/src/mappings/<screen>.ts` (placeholders until captured live) |
| a selector for a control that repeats per container | write it once with `{n}` (the row token, `src/ace/selectors/overrides.ts`); `mappingsForRow` in `inttra-extension/src/content/filler.ts` aims it at the row. Never the class: it is the same on every row |
| a grid column on Copy Container Details | `GRID_COLUMNS` in `inttra-extension/src/mappings/containerGrid.ts` |
| a grid heading that is a dropdown, or the shape of the paste block | `readHeaderCell` and `gridPasteBlock` in `inttra-extension/src/content/gridWriter.ts`, shared by both helpers |
| how the container grid is found when it is not a table | `findHeaderRowByText` and `findContainerGrid` in `inttra-extension/src/content/gridWriter.ts`; the detector and both content scripts go through `findContainerGrid` |
| what Diagnostics says about the page's structure (frame, markers, what is around "Container Number") | `inttra-extension/src/content/structureProbe.ts` |
| what identifies an INTTRA screen, and what each kind of evidence is worth | `EVIDENCE` and `detectInttraPage` in `inttra-extension/src/content/pageDetector.ts`; `pages.ts` stays free of DOM code because the dashboard imports it |
| the build stamp in the manifests and the headers | `scripts/buildStamp.mjs`, `buildStamp` in `src/ui/dom.ts` |
| an email shape Deckhand should read | a rule in `deckhand/src/extract/` + a fixture in `tests/fixtures/deckhand/`; never a rule that pairs by position |
| whose seal an unlabelled seal column is | `sealKindOf` in `deckhand/src/extract/containers.ts`. An unattributed seal is the SHIPPER's, because the operator is the shipper; only "carrier", "line" or "customs" send it the other way. It decides which INTTRA grid column the number lands in, so read `docs/DECKHAND.md` before changing it |
| a field in the filing package, or the merge policy | `shared/src/filingPackage.ts` + `shared/src/builder.ts` |
| a document reader (PDF, mailbox) | implement `DocumentReader` in `deckhand/src/readers/`, register in `deckhand/src/extractor.ts` |
| a dashboard screen | a renderer in `web/src/views/` over `ShipmentRecord`; the rules stay in `src/`, `shared/`, `deckhand/`. A workflow step is a pure function in `web/src/workflow.ts` |
| what Quickfill accepts in its one paste box | the detection ladder in `quickfill-extension/src/paste.ts`. Never add a format picker: one box is the product |
| either playground (the four mock ACE steps, the example workbook, its README) | `scripts/playground.mjs` wraps `tests/fixtures/ace-*.html` at build time, never a second copy of a screen; the example data is `scripts/templateData.mjs`, shared with `npm run template`. `HELPERS` is the only difference between the ACE build's playground and Quickfill's: the card name, the banner, the README, and whether the generated manifest keeps host permissions (the ACE panel finds its tab by URL, Quickfill asks the content script) |
| which tabs the ACE panel will address | `tabPatterns()` in `src/ui/tabs.ts`, read from this build's own manifest, so the panel searches exactly what Chrome injected into. `ACE_URL_PATTERNS` stays in the file as the fallback and because `tests/invariants.test.ts` pins it against `host_permissions` |
| how gated Quickfill is | `quickfill-extension/src/aceShipment.ts`. It is the local, ungated twin of `shared/src/aceView.ts`, and the one file where "fill it anyway" lives. Do not gate it, and do not ungate `aceView.ts` |
| the dashboard's hosting | `web/wrangler.jsonc` (static assets only), `web/_headers`, `.github/workflows/deploy-web.yml` |
| the guides in the dashboard's Help tab | `docs/USER-GUIDE.md` and `docs/SETUP-GUIDE.md` themselves; the page bundles them at build time (`?raw` import), never a second copy |
| a transformation rule | `src/ace/transformers/` + register in `index.ts` |
| a validation rule | `src/excel/validator.ts` |
| the Shipment Reference Number sequence | `src/core/referenceCounter.ts`. The filer's own running integer, in `chrome.storage.local` beside the settings. It RESERVES rather than increments, because the sequence may have no gaps: a number is handed out and handed out again until "Mark as filed" retires it. Do not make it advance on fill |
| a selector that ACE changed | the mapping's `candidates`, per `docs/ACE-MAPPING.md` |
| a qbXML element to read | `builtInCandidates` in `companion/src/mapping/qbToCanonical.ts` |
| a QuickBooks custom field | `customFields` in the user's `ace-export.config.json`, no code |
| another invoice source | implement `InvoiceSourceAdapter` in `companion/src/adapter/` |
| a bill rule (which vendor and account an item belongs to, a vendor's commission, the memo wording) | the `bill` block of the user's `ace-export.config.json`, resolved by `billRuleForItem` in `companion/src/config.ts`; the arithmetic and every refusal in `companion/src/bill/billPlan.ts` (pure); the checks and the one write in `companion/src/adapter/BillWriter.ts`; the calculation workbook in `companion/src/excel/billWorkbook.ts` |
| the one qbXML write | `buildBillAdd` in `companion/src/qbxml/requests.ts`, imported by `BillWriter.ts` alone. Do not widen `InvoiceSourceAdapter` with it, and do not let `write()` skip `check()` |

## The companion is a separate program

`companion/` (→ `dist-companion/`) is a Node program that runs on the Windows PC
beside QuickBooks. **Do not move it under `src/`.** `tests/invariants.test.ts`
and `scripts/check-bundle.mjs` assert that nothing in the extension spawns a
process, opens a socket, or names a non-CBP host; the companion legitimately
does the first two. It has its own invariants in the same test file.

It reuses Phase 1 rather than reimplementing it: `qbToCanonical.ts` calls
`mapCell` from `src/excel/canonicalMapper.ts`, so unit conversion and code
formatting exist once. Never add a second invoice model or a second
transformation engine.

## Current state

Six things are built but not verified against the real system, and all must
stay honestly described:

1. The ACE selectors are **mostly verified by label wording, with six real
   ids**. Labels for all four steps were read off live AESDirect screens
   (Steps 1-3 on 2026-09-14, Step 4 on 2026-09-16) and live in
   `capturedLabel(...)` candidates. Six ids were copied from the live DOM on
   2026-09-16: Departure Date (`estExportDate`), 1st Quantity, Value of Goods,
   Shipping Weight, Conveyance Name and Transportation Reference Number
   (`refNbrValue`). Twenty fields still match by label only;
   `fieldsWithoutCapturedSelector()` is the list and `tests/aceMapping.test.ts`
   pins it, so it can only shrink. `docs/ACE-MAPPING.md` says what to capture,
   field by field. Never replace a `placeholder(...)` with `verified(...)`
   unless the selector really was copied from the live DOM, and never write
   `capturedLabel(...)` for a wording that was not read off the real screen.
   `PONumber` and `FreightTerms` are template columns with no ACE field: do not
   map them.

   Two structural facts, both from 2026-09-16, that guesses keep getting
   wrong: ACE ids are Spring binding paths ending in `.stringField`
   (`commodityLines[0].quantity1.stringField`), so use `bindingPath(...)` /
   `bindingSuffix(...)`, not `byIdSuffix(...)`, and note that such an id is not
   a valid CSS id selector. And **every dropdown is a Select2 3.x combobox**
   over a hidden `<select>`; `resolveSelect2` in
   `src/content/fieldDetector.ts` maps the widget back to the real control,
   but no dropdown write has ever run against the live portal. Never put a
   Select2-generated id (`select2-chosen-3`, `s2id_autogen4`) in a selector
   table: they are numbered from a global counter.

   ACE Step 4 has **no Container Number and no Seal Number** (confirmed in
   edit mode with MOT = vessel, containerized). Those stay in the canonical
   model and the spreadsheet for the INTTRA Helper; they are not ACE fields.
   Port of Export and Port of Unlading are on Step 1, vary per shipment, and
   are **not mapped yet**.

   A playground build (`npm run build:playground` -> `dist-ace-playground/`,
   local files only, never a portal) drives the whole panel against the four
   mock steps. Like Quickfill's, it proves the mechanics on the captured
   labels and the six captured ids, and nothing whatever about the live
   portal: its dropdowns are plain selects, and no Select2 write has still
   ever run. A green fill there does not shrink the twenty.

2. The QuickBooks **COM hop has never run against a real QuickBooks** - there is
   no Windows machine with QuickBooks Desktop in this toolchain. Everything
   above the transport is tested against saved qbXML fixtures. Do not describe
   the live integration as working; `docs/QUICKBOOKS-INTEGRATION.md` section 11
   is the procedure for verifying it on the QuickBooks PC. The companion's one
   write, `bill --write` (a vendor Bill mirroring an invoice, with a negative
   commission line), has likewise never run; section 11 step f verifies it,
   and until then the negative line and the `BillAdd` element order are
   schema assumptions, not facts. The bill fixtures in `tests/fixtures/qbxml/`
   (`bill-*.xml`, `vendor-query.xml`, `account-query.xml`) are hand-written to
   the documented schema, not captured.

3. The INTTRA Helper has **three captured field selectors, all on the
   container block**, and two captured structural ones. Captured from the live
   DOM on 2026-09-20 (Create Shipping Instruction -> Particulars): every
   control of container N carries the same `-N` suffix, numbered from 1
   upward, with `id` and `name` holding the same string, so Container Number
   is `#cont-num-{n}`, Carrier Seal is `#carr-seal-{n}` and Shipper Seal is
   `#ship-seal-{n}`. `{n}` is the ROW TOKEN (`src/ace/selectors/overrides.ts`),
   substituted with the container's row number before detection by
   `mappingsForRow` in `inttra-extension/src/content/filler.ts`. Two rules
   there are load-bearing: the CLASS is never the selector, because it is
   identical on every row and would match them all; and beyond row 1 a
   candidate that carries no row number is DROPPED rather than tried, because
   filling container 2 on a draft that has one block would otherwise fall
   through to a label, match the only control on the screen, and write
   container 2 into container 1's box. A row the draft does not have is
   reported by its number, never written elsewhere; the helper does not press
   Add Container. The live seal boxes take 79 characters and are labelled
   "Seal Number(s)", so a seal is never truncated at 15. Also learned that
   day: the live portal has **no separate Container & Cargo screen** - Create
   Shipping Instruction is one page carrying General Details, the routing and
   the Particulars blocks, which is why `INTTRA_MAPPINGS_BY_PAGE` serves both
   scopes on `generalDetails`. That one page is also why the first live run of
   this build read **"INTTRA screen not identified"** and blocked Fill: both
   signatures matched a heading and TIED, and a tie meant `unknown`. So the
   create URL is now captured (`siworkspace#/create`, from the live address
   bar) and a tie between `generalDetails` and `containerCargo` resolves to
   the create page, whose label is now "Create Shipping Instruction"
   (`pages.ts`, `detectInttraPage`). Every other tie is still reported as
   unidentified, and which of the two causes fired on that live run is still
   unknown, because the Diagnostics evidence block was not captured;
   `docs/INTTRA-INTEGRATION.md` section 5c. Every OTHER field selector is still
   `placeholder(...)`; `unverifiedInttraFieldKeys()` is the list and
   `tests/inttra.test.ts` pins it, so it can only shrink. What was captured
   from the live DOM on 2026-09-17 is structural:
   the Copy Container Details modal root `#siCopyContainerWrapperDiv` and the
   grid container `#editableGridWrapper`, now a page marker and the first
   grid-root rung. Also confirmed that day: the hostname
   `ship.inttra.e2open.com`, that the URL carries no screen name, and that
   Copy Container Details is a **modal over another step** - so tab wording
   cannot identify it. Detection therefore scores **structure above every
   wording hint combined**: a captured marker that is VISIBLE, or the
   container grid itself found by its headings, scores 10, and tab + heading
   + URL can reach at most 9 (`EVIDENCE` in
   `inttra-extension/src/content/pageDetector.ts`). A marker that is in the
   DOM but hidden counts for nothing. The grid is the evidence that held up on
   the fourth live run that day, when a build carrying the captured ids still
   read the strip behind the modal, and it is what both helpers now go by. The
   grid is `editableGrid`: its cells hold no control until clicked, so Fill
   can never write one and **Copy rows and paste is the route, not a
   fallback**. Two facts about that grid, both from the fourth run: its two
   seal headings are **dropdowns of seal types**, so a heading is read as the
   option it shows (`readHeaderCell`), never as its option list, which is
   what had left Shipper Seal # unidentified; and the paste block
   (`gridPasteBlock`) carries **one cell per grid column** from Container
   Number rightwards, blank where nothing feeds a column, cut at the widest
   value, because a column left out of the row shifts every value after it,
   which is how the seals were pasted nowhere. `docs/INTTRA-INTEGRATION.md`
   section 5a. A fifth run the same day, with that fix in the build, still
   found no grid: the live grid is **neither a `<table>` nor an ARIA grid**,
   and in the document that answered neither captured id held one (two
   visible tables, no Container Number heading between them). So the grid is
   now found by the **wording of its header row**, whatever it is built from
   (`findHeaderRowByText` and `findContainerGrid` in `gridWriter.ts`, read as
   a `divGrid`; the detector and both content scripts go through it),
   Quickfill offers Copy rows alone on an INTTRA page it cannot name, and
   Diagnostics carries a Page structure block (`structureProbe.ts`): which
   frame answered, whether each captured id is absent, hidden or visible, and
   what surrounds the words "Container Number". That rung has run against
   mocks only, and the captured ids are unconfirmed on this modal. Never mark
   an INTTRA candidate `verified(...)` unless it was copied from the live DOM;
   the grid's header row is still uncaptured.
   `docs/INTTRA-INTEGRATION.md` section 6 is the capture procedure and
   section 7 the list of what is untested. The helper never presses Add Row,
   Save, Continue or Submit; that is policy in
   `inttra-extension/src/content/automationPolicy.ts`, not a gap. Every dist
   manifest carries `version_name` = version + git commit + build time
   (`scripts/buildStamp.mjs`), shown as `build ...` in each helper's header,
   so a stale unpacked build is visible at a glance; the INTTRA panel's
   header also names the tab it addresses.

4. Deckhand's rules extractor has been shown **fixtures, not a real inbox**.
   PDF and image reading are declared and unavailable, on purpose, because
   both would need a network service or a dependency that fails the bundle
   check. Do not describe them as supported.

5. The operator dashboard has **not been deployed to a real Cloudflare
   account from this repository, nor used on a real shipment**. It is
   tested against the same fixtures as everything else, and it changes
   nothing about items 1 to 4: it prepares the same files the extensions
   already read. Do not describe it as verified in production, and do not
   claim that hosting it resolves any of the caveats above.

6. The Quickfill Helper has **never been used on a real shipment**, and it
   improves nothing in items 1 to 4: it shares the same mapping tables, so it
   fills exactly what the other two fill, which on the live INTTRA portal is
   the three captured container fields per row (item 3), nothing else on the
   form screens, and, on the container grid, the same paste block the INTTRA
   Helper copies. Its container button walks every container block in one
   press, because the number of containers differs per draft. Its read-as line counts the
   containers that carry a seal (a count, not a check), and its Copy rows
   line names the pasted columns and any left blank. On an INTTRA page the
   detector cannot name it offers Copy rows alone, in the default column
   order, and says so (the fifth live run). A playground build
   (`dist-quickfill-playground/`, local files only, never a portal) fills the
   four mock ACE steps from the example workbook; it proves the mechanics on
   the captured labels and ids, not the live portal. What is new about it is
   what it takes away - the
   preview, the ten data quality checks, the ISO 6346 block, the Deckhand
   review and Approve click, the conflict screen, the fill gate, the
   overwrite warning and the reference counter. Every one of those removals
   is listed with its cost in `docs/QUICKFILL.md` section 3; keep that table
   true, and never describe Quickfill as "safer because it is simpler". It is
   faster because it is simpler, and it is only safe because the operator
   reads the form. Two things it still refuses: it never presses a portal
   control, and it never guesses which of several containers goes in ACE's
   single container field.
