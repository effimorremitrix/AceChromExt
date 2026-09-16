# Setup guide: installing, configuring QuickBooks, capturing portal selectors

Everything that is done once, or once per portal change, by whoever sets the
tools up. Day-to-day operation is in **[USER-GUIDE.md](USER-GUIDE.md)**.

## Contents

1. [Installing the two extensions](#1-installing-the-two-extensions)
2. [QuickBooks setup](#2-quickbooks-setup)
3. [The Excel file](#3-the-excel-file)
4. [Updating the ACE selectors](#4-updating-the-ace-selectors)
5. [Capturing the INTTRA selectors](#5-capturing-the-inttra-selectors)
6. [What is automated and what is not](#6-what-is-automated-and-what-is-not)
7. [Deploying the operator dashboard](#7-deploying-the-operator-dashboard)

---

## 1. Installing the two extensions

Full detail: **[INSTALLATION.md](INSTALLATION.md)**.

```bash
npm install
npm run verify      # typecheck + tests + template + both builds + both bundle checks
```

Then `chrome://extensions`, **Developer mode** on, **Load unpacked**, choose
`dist/` for the ACE Helper and again `dist-inttra/` for the INTTRA Helper.
Reload any portal tab that was already open; a content script is only
injected into pages loaded after the extension.

Each extension asks for exactly one permission (`storage`) and for its own
portal's hosts only: `cbp.dhs.gov` for ACE, `inttra.com` and `e2open.com` for
INTTRA. Neither has a network permission, and each content security policy
pins `connect-src` to `'none'`, so neither can send anything anywhere.
`npm run check:bundle` and `npm run check:bundle:inttra` assert that against
the built files on every build, dependencies included.

**Confirm the INTTRA hostname on the first live session.** If the Shipping
Instructions screens are under neither domain, add the exact host to both
`host_permissions` and `content_scripts.matches` in
`inttra-extension/manifest.json` and to `INTTRA_URL_PATTERNS` in
`inttra-extension/src/ui/tabs.ts`, then rebuild. Never widen to `<all_urls>`.

---

## 2. QuickBooks setup

Full detail: **[QUICKBOOKS-INTEGRATION.md](QUICKBOOKS-INTEGRATION.md)**. The
short version, on the Windows PC that runs QuickBooks Desktop:

```bash
npm run build:companion     # produces dist-companion/, copy that folder over
cd dist-companion
node ace-export.mjs init    # writes ace-export.config.json
node ace-export.mjs probe   # authorize once, as QuickBooks Admin
```

`probe` needs QuickBooks open and an Admin login: QuickBooks asks once whether
this application may read the company file, and remembers the answer. The
prompt says *without a certificate*, because the companion is an unsigned local
program; that is expected. Answer **Yes, whenever my QuickBooks company file is
open**, leave the personal-data checkbox unchecked, and type `yes` in the
confirmation box to enable **Continue**.
Nothing is written back to QuickBooks; the companion only ever issues Query
requests, and a test asserts that.

Then tell the configuration the things QuickBooks cannot know:

```jsonc
{
  "customFields": {            // your QuickBooks custom field -> shipment field
    "Vessel": "vessel",
    "Booking": "bookingNumber",
    "Container": "containerNumber",
    "Seal": "sealNumber"
  },
  "items": {                   // the customs facts, per item you export
    "Shelled Almonds": {
      "scheduleB": "0802.12.0000",
      "origin": "D",
      "licenseCode": "C33",
      "eccn": "EAR99",
      "exportInformationCode": "OS",
      "quantityUom": "lb",     // what the QuickBooks quantity is in
      "aceUom1": "KG",         // what ACE reports this Schedule B in
      "quantity1From": "weight"
    }
  }
}
```

`node ace-export.mjs fields CN-1042` prints the custom-field names QuickBooks
actually returns for one invoice, so `customFields` is filled in from what is
there rather than from what you hope is there.

**Schedule B, origin and licence code are not in any accounting system.** They
are customs facts and they are yours. Configure them per item and they are
right every time; supply them at export time and they are right this time.
Nothing guesses one. A blank Schedule B exports as blank and is reported as an
error.

**Container and seal in QuickBooks are optional now.** If the custom field
reads a placeholder such as "See Ocean B/L", the filing package notes it and
takes the containers from the carrier's email instead; it is never typed
into a portal.

### Choosing `output.weightUom`

| Setting | The workbook holds | The extension shows |
| --- | --- | --- |
| `"kg"` (default) | the converted kilograms | `79832`, with the pounds on the Audit sheet |
| `"lb"` | the QuickBooks pounds | `176000 lb -> lb x 0.45359237 -> 79832` |

Both file the same kilograms; it is the same conversion code either way.
Choose `"lb"` if you want the whole chain visible in the extension's own
preview and mapping status, which is the more useful default for anyone
reviewing a filing.

---

## 3. The Excel file

`ACE_Invoice_<invoice-number>.xlsx`, with three sheets:

| Sheet | For | Read by the extension? |
| --- | --- | --- |
| `Shipment` | the data | **yes**, one row per ACE commodity line |
| `Audit` | every field, its origin, its original value and its transformation | no |
| `Checks` | validation at the moment of export | no |

The `Shipment` sheet is the import template, unchanged: same columns, same
order, shipment-level values on the first row. A workbook you filled in by
hand and a workbook QuickBooks wrote are the same kind of file, and the
extension reads them with the same code; only the label in the panel differs.

The filing package (`filing-package-<invoice>_<booking>.json`, from
`ace-export package` or from either panel's Package tab) is the other file
the extensions read. It carries the same commercial data plus the approved
email extraction, and keeping it beside the shipment is the audit trail for
what was filed from where.

---

## 4. Updating the ACE selectors

**Where things stand:** the labels of Steps 1 to 3 (Shipment, Parties,
Commodities) were read off the live AESDirect screens and the extension
resolves those fields by that wording at medium confidence. The element ids
are still guesses, the dropdowns may be widgets over a hidden `<select>`, and
Step 4 (Transportation) was never captured. `docs/ACE-MAPPING.md` lists what
is still missing, field by field. Nothing is ever written to a field that was
not confidently found.

It is about a minute per field, and it does **not** need a developer or a
rebuild.

### Capture

1. Open the ACE step in Chrome. Open DevTools (F12).
2. Right-click the box you want, **Inspect**.
3. Copy the whole opening tag, e.g.
   `<input id="filingForm:lineDetails:scheduleB" name="scheduleB" ...>`.
4. For a `<select>`, copy two `<option>` tags as well: the writer needs to
   know whether the values are codes (`KG`) or descriptions (`Kilograms`).

The panel shows the same hint beside any field that did not resolve.

### Install

Panel, **Diagnostics**, **Run field detection on the ACE tab**, open
**ACE selectors**, **Starter for unresolved fields**. You get a JSON skeleton
containing only the fields that failed. Replace each placeholder:

```json
{
  "version": 1,
  "capturedAt": "2026-09-24",
  "fields": {
    "ScheduleB": [
      { "strategy": "id", "selector": "#filingForm\\:lineDetails\\:scheduleB" }
    ],
    "ShippingWeight": [
      { "strategy": "name", "selector": "input[name='shippingWeight']" }
    ],
    "LicenseCode": [
      { "strategy": "label", "labelText": ["License Code/License Exemption"] }
    ]
  }
}
```

**Save selectors.** They take effect on the next fill; reload the ACE tab if
it was already open.

- Captured selectors are tried **first** and count as verified.
- The built-in candidates stay behind them, so a wrong paste degrades to
  today's behaviour instead of breaking the field.
- The JSON is validated on save: a bad strategy, a malformed CSS selector or
  an unknown field key is refused with a message, and nothing is stored.
- **Export** writes the file so it can be shared with another machine;
  **Remove all** goes back to the built-ins.

### Make them permanent

When a set of selectors has proven itself, move it into
`src/ace/selectors/<page>.ts` and change `placeholder(...)` to
`verified(...)`. That is the only code change, and deliberately the only one:
mappings, transformations and validation are separate files so nothing else
moves when the portal does.

---

## 5. Capturing the INTTRA selectors

**Where things stand:** nothing. Every INTTRA selector, every screen
signature and the exact hostname are placeholders tested against mock
screens. The helper will report "not found" on a real screen until this is
done, and it will never write to a field it did not find.

The procedure is the same shape as ACE's, with a longer capture list because
of the container grid. It is written out in full in
**[INTTRA-INTEGRATION.md](INTTRA-INTEGRATION.md), section 6**: per screen,
the active step tab, the heading, and each filled control with its label;
for Copy Container Details, the grid root, the header row, an empty row, a
populated row, an edited cell, and the six named cells, in that order.

Install captured selectors through the INTTRA Helper's **Diagnostics**,
**INTTRA selectors** editor, same JSON format as ACE. Make them permanent in
`inttra-extension/src/mappings/<screen>.ts`, and the grid's in
`inttra-extension/src/mappings/containerGrid.ts`. Never mark a candidate
verified that was not read off the live DOM.

---

## 6. What is automated and what is not

### Automated

- reading the invoice out of QuickBooks, including custom fields
- unit conversion, currency cleanup, date normalisation, Schedule B
  formatting, country and origin codes, UOM aliases
- writing the ACE-compatible workbook, with an audit trail
- reading booking, containers, seals, vessel and ports out of an email,
  with the evidence for every container-to-seal pairing
- validating container numbers against ISO 6346
- combining the invoice and the email into one package, matching what both
  carry and flagging what they disagree on
- resolving each portal field on the screen you have open, typing the value,
  and reading it back
- writing the container grid one row per container, every cell verified
- recording all of it in a session log you can export

### Not automated, on purpose

- **navigating a portal.** You choose the screen.
- **saving a line, continuing, or adding a row.** ACE's Save Line and Add
  New Line, and INTTRA's Save, Continue and Add Row, are never pressed.
- **submitting, certifying, or accepting a legal declaration.** Never.
- **dismissing a portal warning.** Never.
- **sign-in, MFA, CAPTCHA.** Neither helper ever sees a credential.
- **approving an extraction.** A person reads the review and presses
  Approve; nothing flows into a package or a form before that.
- **choosing between two sources that disagree.** A conflict is shown with
  both values and blocks filling until a person picks.
- **guessing a customs fact, a seal pairing, or a container number.** A
  missing Schedule B stays missing; two lists of containers and seals stay
  unpaired; a failed check digit stays as read.

The switches that get asked for are written down as disabled in
`src/content/automationPolicy.ts` (ACE) and
`inttra-extension/src/content/automationPolicy.ts` (INTTRA) rather than
merely absent, so enabling one is a deliberate edit to a file whose whole
content is the reason not to. The test suites assert every switch is false
and that no content script calls `.click()` at all.

**These are data-entry aids.** They do not validate a filing or a shipping
instruction, do not give customs or shipping advice, and do not replace the
filer's review. The accuracy of every filing remains the filer's legal
responsibility.

---

## 7. Deploying the operator dashboard

Optional. The extensions and the companion do not need it. Full detail:
**[WEB-DASHBOARD.md](WEB-DASHBOARD.md)**.

```bash
npm run verify                                        # builds dist-web/ and checks it
npx wrangler deploy --config web/wrangler.jsonc       # needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
```

or, from GitHub, the **Deploy operator dashboard** workflow with the same two
values stored as repository secrets. What is deployed is a folder of static
files: the page runs in the operator's browser, has `connect-src 'none'`,
and never sends a shipment to the host. Put it behind whatever access
control the office uses for internal pages (Cloudflare Access, an internal
name); the page itself has no login because it holds nothing to protect
until a file is imported, and nothing then leaves it.

To try it without deploying: `npm run dev:web` serves the same page on
`http://127.0.0.1:8788/`.
