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

# ACE Helper

A Chrome MV3 extension that fills U.S. Customs ACE/AES export filing forms from
a locally imported spreadsheet. See `README.md` for what it does and
`docs/ARCHITECTURE.md` for how it is put together.

## Commands

| Command | Use |
| --- | --- |
| `npm run verify` | typecheck + 210 tests + template + build + bundle check. Run before every push. |
| `npm run build` / `build:watch` | build `dist/` |
| `npm test` / `test:watch` | vitest |
| `npm run smoke` | end-to-end in real Chrome against a mocked ACE host. Needs Chrome for Testing or a Playwright Chromium - **branded Chrome 137+ will not work** (see `docs/INSTALLATION.md`). |
| `npm run check:bundle` | supply-chain check on `dist/` |
| `npm run template` / `icons` | regenerate the committed generated files |

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

## Where things live

Data flows one way: `Excel → canonical model → preview → ACE`.

| Change | File |
| --- | --- |
| a spreadsheet column | `src/excel/columnAliases.ts` |
| an ACE field | `src/ace/mappings/<page>.ts` |
| a transformation rule | `src/ace/transformers/` + register in `index.ts` |
| a validation rule | `src/excel/validator.ts` |
| a selector that ACE changed | the mapping's `candidates`, per `docs/ACE-MAPPING.md` |

## Current state

All 24 ACE selectors are **placeholders** - none captured from the live portal.
`docs/ACE-MAPPING.md` lists exactly what to capture, field by field. Never
replace a `placeholder(...)` with `verified(...)` unless the selector really was
copied from live ACE.
