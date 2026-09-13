# ACE Helper - the whole thing, one guide

Everything an operator needs, in the order they need it. The other documents in
`docs/` go deeper on one topic each; this one is the path from a QuickBooks
invoice to a filled ACE form and back out again when something goes wrong.

**What ACE Helper does not do, ever:** it does not save a commodity line, does
not submit, does not certify, does not accept a legal declaration, and does not
dismiss an ACE warning. It types values into a form you already have open. The
last click is always yours, and the accuracy of the filing is always yours.

---

## Contents

1. [The workflow, end to end](#1-the-workflow-end-to-end)
2. [QuickBooks setup](#2-quickbooks-setup)
3. [Exporting an invoice](#3-exporting-an-invoice)
4. [The Excel file](#4-the-excel-file)
5. [Installing the Chrome extension](#5-installing-the-chrome-extension)
6. [The calculator](#6-the-calculator)
7. [Filling ACE](#7-filling-ace)
8. [Warnings, and what each one means](#8-warnings-and-what-each-one-means)
9. [Troubleshooting](#9-troubleshooting)
10. [Updating the ACE selectors](#10-updating-the-ace-selectors)
11. [What is automated and what is not](#11-what-is-automated-and-what-is-not)

---

## 1. The workflow, end to end

```
QuickBooks Desktop
   |  ace-export gui   (or: ace-export export CN-1042)
   v
Canonical invoice        <- one model, shared by both halves
   |
   v
ACE_Invoice_CN-1042.xlsx <- written to this machine
   |  Chrome: ACE Helper panel -> Import
   v
Preview + data quality checks
   |
   v
ACE, one step at a time:  Fill Current Page / Fill Current Line
   |
   v
You review every field
   |
   v
You save and submit in ACE
```

Nine steps, of which two are typing and one is a decision. Everything else is a
click, and nothing leaves this machine at any point.

If you do not use QuickBooks, start at step 4: fill in the template yourself and
import it. That path needs no QuickBooks, no companion and no server, and it is
the path ACE Helper was originally built for.

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

`probe` is the one that needs QuickBooks open and an Admin login: QuickBooks
asks once whether this application may read the company file, and remembers the
answer. Nothing is written back to QuickBooks - the companion only ever issues
Query requests, and a test asserts that.

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
are customs facts and they are yours. Configure them per item and they are right
every time; supply them at export time and they are right this time. Nothing
guesses one. A blank Schedule B exports as blank and is reported as an error.

### Choosing `output.weightUom`

| Setting | The workbook holds | The extension shows |
| --- | --- | --- |
| `"kg"` (default) | the converted kilograms | `79832`, with the pounds on the Audit sheet |
| `"lb"` | the QuickBooks pounds | `176000 lb -> lb x 0.45359237 -> 79832` |

Both file the same kilograms - it is the same conversion code either way. Choose
`"lb"` if you want the whole chain visible in the extension's own preview and
mapping status, which is the more useful default for anyone reviewing a filing.

---

## 3. Exporting an invoice

Two ways. The window:

```bash
node ace-export.mjs gui
```

It prints a `http://127.0.0.1:PORT/?t=...` link. Open it. Only this machine can
reach it, and only with that token.

1. **Invoice** - search by invoice number, pick one, press Preview.
2. **Summary** - customer, date, line count, destination.
3. **Supply what QuickBooks does not hold** - vessel, booking, container, seal.
4. **ACE readiness, line by line** - the point of the screen:

   ```
   Line 1: Almond Kernels, Monterey SSR 23/25              needs attention
     ✓ Schedule B         0802.12.0000
     ✓ Origin             D
     ⚠ License Code       missing
     ✓ Quantity 1         79,832
     ✓ UOM 1              KG
     ✓ Value of Goods     651,217.60
     ✓ Shipping Weight    79,832 kg
   ```

   The editable ones have a box under them. Type the licence code, press
   **Apply and preview**, and the line goes green. What you type applies to this
   export only and is recorded in the audit trail as operator-supplied - it does
   not silently become a permanent fact about the item. Put it in `items` when
   you want it to be permanent.

   Quantity, value and weight have no box. They are what the invoice *is*, and
   an ACE filing that disagrees with its own invoice is worse than one that is
   late.

5. **Ready to export?** - the six-fact checklist, then **Export ACE Excel**.

Or the command line, which does the same thing and is easier to repeat:

```bash
node ace-export.mjs show   CN-1042                 # preview, write nothing
node ace-export.mjs export CN-1042 \
  --set vessel="MSC FIRENZE V.541W" \
  --set containerNumber=MSCU1234567 \
  --set-line 1.licenseCode=C33
```

`--dry-run` previews and validates without writing. The exit code is non-zero
when validation found an error, so it can be used in a script.

---

## 4. The Excel file

`ACE_Invoice_<invoice-number>.xlsx`, with three sheets:

| Sheet | For | Read by the extension? |
| --- | --- | --- |
| `Shipment` | the data | **yes** - one row per ACE commodity line |
| `Audit` | every field, its origin, its original value and its transformation | no |
| `Checks` | validation at the moment of export | no |

The `Shipment` sheet is the Phase 1 import template, unchanged: same columns,
same order, shipment-level values on the first row. Which means a workbook you
filled in by hand and a workbook QuickBooks wrote are the same kind of file, and
the extension reads them with the same code.

To fill one in by hand instead: open the panel, **Download the import
template**, and use one row per ACE commodity line. Column headers are matched
case- and punctuation-insensitively and a generous set of aliases is accepted
(`HTS`, `Gross Weight`, `Amount`, `Consignee`, ...). A column nobody recognises
is reported rather than ignored.

The panel tells you which kind of file it opened:

```
QuickBooks export - QuickBooks Desktop (qbXML 16.0) via ... - exported 2026-09-21
```

or

```
Excel workbook - My ACE Shipment.xlsx - read in this browser
```

---

## 5. Installing the Chrome extension

Full detail: **[INSTALLATION.md](INSTALLATION.md)**.

```bash
npm install
npm run verify      # typecheck + tests + template + build + bundle check
```

Then `chrome://extensions` -> **Developer mode** on -> **Load unpacked** ->
choose the `dist/` folder. Reload any ACE tab that was already open; a content
script is only injected into pages loaded after the extension.

Check it took: the toolbar icon opens a popup that says **No ACE tab detected**
when you are not on one, and names the filing step when you are.

The extension asks for exactly one permission (`storage`) and exactly three
hosts, all `cbp.dhs.gov`. It has no network permission, and its content security
policy pins `connect-src` to `'none'`, so it cannot send anything anywhere even
if it wanted to. `npm run check:bundle` asserts that against the built files on
every build, dependencies included.

---

## 6. The calculator

ACE numeric fields reject `*`, `/`, `(` and `)`. So:

1. Click into any numeric ACE field.
2. Press **F2**.
3. Type `176000 * 0.45359237`.
4. Press **Enter**.

`79832.26` goes into the field. Only the result - never the expression, never a
thousands separator. **Escape** closes it and leaves the field exactly as it was.

The calculator is independent of everything else. It works with nothing
imported, no QuickBooks, no workbook and no configuration, and it does not
interfere with import or auto-fill: it lives in a shadow root, so ACE's DOM -
and therefore field detection - cannot see inside it.

There is a second copy on the panel's **Calculator** tab for checking a number
while you are reading the preview. It writes nothing to ACE.

Rounding is a setting (**Settings -> Calculator rounding**): N decimals, whole
numbers, or none.

There is no `eval` anywhere. Expressions go through a hand-written parser that
can only produce a number, and the build fails if `eval`, `new Function`, or a
network API appears in any shipped file.

---

## 7. Filling ACE

### Import

Panel -> **Import** -> choose the `.xlsx`. It is parsed in the browser. Nothing
is uploaded.

### Overview

```
Invoice
CN-1042
Aydin Kuruyemis San Ve Tic A.S

Status
✓ QuickBooks export loaded
✓ 24 of 24 ACE fields mapped
⚠ 2 fields require review

Actions
[ Preview ] [ Mapping status ] [ Fill Current Page ] [ Fill Current Line ]
[ Calculator ] [ Clear Data ]

Diagnostics
[ Open ]
```

### Preview

Traffic lights per field, with the original cell value beside the ACE value
wherever something was transformed. Green is mapped and plausible; yellow means
an assumption was made for you; red cannot be filed as imported and **will not
be written**.

Read this before you fill. It is the review gate.

### Mapping status

The same information asked the other way round - one row per ACE field:

```
Shipping Weight (kg)                                              READY
  Source          QuickBooks export - InvoiceLineRet/Quantity
  Original        176000 lb
  Transformation  lb x 0.45359237
  ACE value       79832
  ACE selector    #shippingWeight
```

**Check against the open ACE page** resolves every selector against the page you
have open and writes nothing. Statuses:

| Status | Means |
| --- | --- |
| `READY` | value is good and the ACE field was found |
| `NOT CHECKED` | value is good; nobody has looked at an ACE page yet |
| `REVIEW` | written, but something wants an eye - a truncation, an unrecognised code |
| `MISSING` | ACE expects this field and the data has no value for it |
| `EMPTY` | optional, and not supplied. Nothing to do |
| `ERROR` | the value cannot be turned into something ACE accepts |
| `NOT FOUND` | the ACE field is not on this page, or the selector is stale |
| `AMBIGUOUS` | several ACE fields matched. Deliberately not written |

### Data quality checks

Immediately above the Fill buttons, ten named checks:

```
Data quality checks                                       2 to review
  ✓ Required values present     1 line(s) checked
  ✓ Numbers are valid           1 line(s) checked
  ✓ Amounts are positive        1 line(s) checked
  ✓ Weights are present and non-zero
  ✓ Schedule B on every line
  ⚠ Origin on every line        line 1: No origin indicator; ACE requires D or F
  ⚠ License code on every line  line 1: No licence code / exemption
  ✓ Dates are valid
  ✓ Units of measure recognised
  ✓ All columns mapped
```

They report; they do not block. A field with a blocking issue is skipped by the
filler anyway - never guessed, never half-written - so you may legitimately want
the good fields typed while you go and find the missing one.

### Fill

1. In ACE, navigate to the step you want. ACE Helper never navigates for you.
2. In the panel, press **refresh** in the header if you have just moved.
3. **Fill Current Page** for the shipment-level fields on that step, or
   **Fill Current Commodity Line** on the Commodities step with a Line Details
   form open.
4. **Dry run** does everything except write, if you would rather look first.

Filled fields are tinted for a few seconds: green for a plain copy, yellow for a
transformed value, red for a failure. The fill report lists every field, and
"show field" scrolls ACE to one.

**Overwrite existing values** is off by default: a field ACE already holds a
different value in is left alone and reported, rather than being replaced.

5. Check every field in ACE.
6. **You** save the line. **You** submit. **You** certify.

---

## 8. Warnings, and what each one means

| Message | What happened | What to do |
| --- | --- | --- |
| `No field on this page matched the mapping` | the selector did not resolve | you are probably on the wrong ACE step; if not, see [section 10](#10-updating-the-ace-selectors) |
| `N fields matched "..."` | the selector is too loose for this page | capture a precise selector, section 10 |
| `The matching field is disabled or read-only` | ACE has not enabled it yet | fill whatever ACE requires first - often a licence code before ECCN |
| `ACE already holds "..."` | the field is not empty and the values differ | check which is right, then tick **Overwrite** if yours is |
| `Truncated to N characters for ACE` | the value is longer than ACE allows | shorten it in the source and re-import if the truncation loses meaning |
| `Matched by a structural fallback` | resolved by position within a container, not by name | confirm it is the right box before trusting it |
| `"..." is not in the local code table` | a country, UOM or ECCN this build does not know | confirm the ACE value; it was passed through unchanged, not guessed |
| `Schedule B "..." has N digits; ACE requires 10` | wrong classification number | fix it at the source |
| `Value is ... AES has no negative value` | a credit line reached an export filing | that line does not belong on this filing |
| `Column "..." is not a recognised ACE field` | an extra spreadsheet column | fine to ignore, or rename it to a template column |

---

## 9. Troubleshooting

**The panel says "No ACE tab detected."**
The ACE tab must be open in the same window, on an `https://*.cbp.dhs.gov` URL.
Press **refresh** in the panel header.

**Nothing happens when I press Fill.**
The button is disabled until a filing step is detected. Navigate to a step in
ACE, then press **refresh**. If the header still says "ACE page not identified",
the page signature needs updating - same procedure as a selector, section 10.

**F2 does nothing.**
The field must be focused and must be a writable text or number input. F2 is
ignored on selects, disabled fields, and read-only fields. If it does nothing
anywhere, reload the ACE tab: the content script is only injected into pages
loaded after the extension was installed or updated.

**The import was refused.**
Only `.xlsx` / `.xlsm` / `.xltx`, under 15 MB, under 5000 rows, and it must be a
real Excel file - a `.csv` renamed to `.xlsx` is rejected on purpose.

**Every field says NOT FOUND.**
Either you are on a different ACE step than you think, or the portal changed.
Run **Diagnostics -> Run field detection on the ACE tab** to see which. Section
10 is the fix for the second.

**Something is wrong and I need to show someone.**
Panel -> **Diagnostics** -> **Export diagnostics**. You get one text file: the
invoice, the workbook and its source, validation, the full mapping status table,
the session log, and the field-detection snapshot.

```
20:01:12  import      Loaded ACE_Invoice_CN-1042.xlsx - 1 line(s) from "Shipment" via QuickBooks export
20:01:12  transform   Line 1 shippingWeight: 176000 lb -> 79,832 kg
                      lb x 0.45359237
20:03:44  fill        Filled Shipment page (shipment): filled 4, skipped 1, warnings 0, errors 0
20:05:09  fill        Filled Commodity line 1 (commodities): filled 10, skipped 1, warnings 1, errors 0
```

It contains no credential - ACE Helper never sees one - and entries matching a
credential pattern are refused rather than stored. It is never uploaded
anywhere: **Copy** puts it on your clipboard, **Export** writes a file to this
machine, and that is the complete list of places it can go.

The log lives in memory for the browsing session only. **Clearing the imported
data clears the log with it**, because the log holds values derived from the
shipment - so export it first if you want the trail.

---

## 10. Updating the ACE selectors

**Read this first: every selector that ships with this build is a placeholder.**
The mapping architecture is complete and tested; the selectors have not been
captured from the live portal, because that has to happen in front of the real
ACE with a real filing open. Until they are, expect `NOT FOUND` - and note that
nothing is ever written to a field that was not confidently found.

It is about a minute per field, and it does **not** need a developer or a
rebuild.

### Capture

1. Open the ACE step in Chrome. Open DevTools (F12).
2. Right-click the box you want -> **Inspect**.
3. Copy the whole opening tag, e.g.
   `<input id="filingForm:lineDetails:scheduleB" name="scheduleB" ...>`.
4. For a `<select>`, copy two `<option>` tags as well: the writer needs to know
   whether the values are codes (`KG`) or descriptions (`Kilograms`).

`docs/ACE-MAPPING.md` lists exactly what to capture for each of the 24 fields,
and the panel shows the same hint beside any field that did not resolve.

### Install

Panel -> **Diagnostics** -> **Run field detection on the ACE tab** -> open
**ACE selectors** -> **Starter for unresolved fields**. You get a JSON skeleton
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

**Save selectors.** They take effect on the next fill; reload the ACE tab if it
was already open.

- Captured selectors are tried **first** and count as verified.
- The built-in candidates stay behind them, so a wrong paste degrades to today's
  behaviour instead of breaking the field.
- The JSON is validated on save: a bad strategy, a malformed CSS selector or an
  unknown field key is refused with a message, and nothing is stored.
- **Export** writes the file so it can be shared with another machine;
  **Remove all** goes back to the built-ins.

### Make them permanent

When a set of selectors has proven itself, move it into
`src/ace/selectors/<page>.ts` and change `placeholder(...)` to `verified(...)`.
That is the only code change, and it is deliberately the only one: mappings
(`src/ace/mappings/`), transformations (`src/ace/transformers/`) and validation
(`src/excel/validator.ts`) are separate files for exactly this reason - the
selectors change on CBP's schedule, and nothing else has to move when they do.

---

## 11. What is automated and what is not

### Automated

- reading the invoice out of QuickBooks, including custom fields
- unit conversion (pounds to kilograms), currency cleanup, date normalisation,
  Schedule B formatting, country and origin codes, UOM aliases
- writing the ACE-compatible workbook, with an audit trail
- recognising which kind of workbook was opened
- parsing it, validating it, and previewing every field with its original value
- resolving each ACE field on the page you have open
- typing the values into that page's fields
- recording all of it in a session log you can export

### Not automated, on purpose

- **navigating ACE.** You choose the step.
- **saving a commodity line.** ACE's own Save Line is never pressed.
- **adding a line.** ACE's own Add New Line is never pressed.
- **submitting.** Never.
- **certifying, or accepting a legal declaration.** Never.
- **dismissing an ACE warning.** Never.
- **ACE sign-in, MFA, CAPTCHA.** ACE Helper never sees a credential of any kind.
- **guessing a customs fact.** A missing Schedule B stays missing and is
  reported. There is no default classification anywhere in this codebase.

The two that get asked for - Save Line and Add New Line - are written down as
disabled in `src/content/automationPolicy.ts` rather than merely absent, so
enabling one would be a deliberate edit to a file whose whole content is the
reason not to. The test suite asserts both are false and that no content script
calls `.click()` at all.

**ACE Helper is a data-entry aid.** It does not validate a filing, does not give
customs advice, and does not replace the filer's review. The accuracy of every
AES filing remains the filer's legal responsibility.
