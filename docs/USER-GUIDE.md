# The operator's guide: from invoice and email to ACE and INTTRA

One workflow, two portals. An invoice comes out of QuickBooks (or a
spreadsheet), the booking and containers come out of an email, you review
them once as a package, and you fill ACE and INTTRA from it. This guide
follows that order. Setting the tools up, configuring QuickBooks, and
capturing portal selectors are in **[SETUP-GUIDE.md](SETUP-GUIDE.md)**.

**What these tools never do:** they never save a line, continue, submit,
certify, or accept a declaration; never navigate a portal for you, or press
Add Row; never touch a sign-in, MFA or CAPTCHA; never send data anywhere
(no network permission, no server); never store a credential; never pair a
seal with a container by position; never correct a container number. The
last click is always yours, and the accuracy of the filing is always yours.

---

## Contents

0. [The workflow at a glance](#0-the-workflow-at-a-glance)
1. [Get the invoice](#1-get-the-invoice)
2. [Get the identifiers from the email (Deckhand)](#2-get-the-identifiers-from-the-email-deckhand)
3. [Build and check the package](#3-build-and-check-the-package)
4. [Fill ACE](#4-fill-ace)
5. [Fill INTTRA](#5-fill-inttra)
6. [Settings, clearing data, the session log](#6-settings-clearing-data-the-session-log)
7. [Warnings, and what each one means](#7-warnings-and-what-each-one-means)
8. [When something does not work](#8-when-something-does-not-work)

---

## 0. The workflow at a glance

```
  QuickBooks Desktop ──▶ ace-export ──▶ ACE_Invoice_CN-1042.xlsx ─┐
    (or: the template, filled in by hand)                        │
                                                                 ├──▶ Package ──▶ filing-package.json
  Carrier / producer email ──▶ Deckhand ──▶ reviewed, approved ──┘      │
                                                                        ├──▶ ACE Helper    ──▶ ACE     (you submit)
                                                                        └──▶ INTTRA Helper ──▶ INTTRA  (you submit)
```

Three starting points, and none of them needs the others:

| You have | Start at | You can |
| --- | --- | --- |
| a QuickBooks invoice or a spreadsheet | section 1 | fill ACE (sections 4), with or without an email |
| the carrier's email | section 2 | fill INTTRA's booking, vessel, ports, containers and seals (section 5) |
| both | sections 1 and 2 | fill both portals from one package (section 3) |

Nothing leaves your machine at any point. Everything is a local file or a
browser tab.

### The dashboard, if you have one

If your office has deployed the **operator dashboard** (SETUP-GUIDE,
section 7), sections 1b to 3 below can be done on one web page instead of
in the panels: **Import** the workbook from section 1a (or a package),
**Deckhand** the email, **Package** it, then read **ACE readiness**,
**INTTRA readiness** and **Provenance** ("where did this value come from?"),
and on **Overview** the numbered list of what is still to do. Download
`filing-package.json` (or the ACE workbook) and continue at section 4 or 5
with the extensions exactly as written there.

The page runs in your browser and uploads nothing; what you import is gone
when the tab closes, so download the package before you close it. It does
not fill ACE or INTTRA: the extensions do, and you submit.

---

## 1. Get the invoice

### 1a. From QuickBooks Desktop

On the PC that runs QuickBooks, once the companion is set up (SETUP-GUIDE,
section 2):

```bash
node ace-export.mjs gui
```

It prints a `http://127.0.0.1:PORT/?t=...` link. Open it; only this machine
can reach it, and only with that token.

1. **Invoice**: search by invoice number, pick one, press Preview.
2. **Summary**: customer, date, line count, destination.
3. **Supply what QuickBooks does not hold**: vessel, booking, container,
   seal. If the carrier's email holds them, leave these blank; Deckhand
   reads them in section 2 and the package matches them up.
4. **ACE readiness, line by line**:

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

   Editable facts have a box under them. Type the licence code, press
   **Apply and preview**, and the line goes green. What you type applies to
   this export only and is recorded as operator-supplied; put it in the
   configuration's `items` when it should be permanent. Quantity, value and
   weight have no box: they are what the invoice *is*.

5. **Ready to export?** The checklist, then **Export ACE Excel**.

The command line does the same and is easier to repeat:

```bash
node ace-export.mjs show   CN-1042                       # preview, write nothing
node ace-export.mjs export CN-1042 --set-line 1.licenseCode=C33
```

Either way the result is `ACE_Invoice_CN-1042.xlsx`, written to this
machine, with a `Shipment` sheet the extension reads and `Audit` and `Checks`
sheets for you (SETUP-GUIDE, section 3).

### 1b. By hand

Open the ACE Helper panel (toolbar icon, **Open full panel**), **Import**,
**Download the import template**. One row per ACE commodity line;
shipment-level columns only need to be on the first row.

Commodity line: `Line`, `ExportInformationCode`, `ScheduleB`,
`CommodityDescription`, `Quantity1`, `UOM1`, `Quantity2`, `UOM2`, `Origin`,
`ValueOfGoods`, `ShippingWeight`, `ShippingWeightUOM`, `ECCN`, `LicenseCode`.

Shipment level: `CustomerName`, `InvoiceNumber`, `InvoiceDate`, `BillTo`,
`BillToAddress2`, `BillToCity`, `BillToState`, `BillToPostalCode`,
`BillToCountry`, `FreightTerms`, `PaymentTerms`, `PaymentDueDate`, `PONumber`,
`Carrier`, `Vessel`, `BookingNumber`, `ContainerNumber`, `SealNumber`,
`Destination`.

Where they land in ACE: `InvoiceNumber` is the Shipment Reference Number,
`InvoiceDate` the Departure Date and `Destination` the Country of Destination
(Step 1); `CustomerName` and the `BillTo*` columns fill the Ultimate Consignee
panel (Step 2); the commodity columns fill the open Line Details form
(Step 3). `FreightTerms`, `PONumber`, `PaymentTerms` and `PaymentDueDate` have
no box in ACE and are carried for reference (and into the INTTRA package).

Header matching ignores case, spaces and punctuation, and common aliases are
accepted (`Qty 1`, `HTS Number`, `Ultimate Consignee`, `Gross Weight`).
Unrecognised columns are listed in the import notes, not silently dropped.

### What the importer cleans up for you

| Input | Becomes | Note in the preview |
| --- | --- | --- |
| `79,833` | 79833 | separators removed |
| `$633,600.00` | 633600.00 | currency cleanup |
| `(1,200.00)` | -1200 | accounting parentheses read as negative |
| `176,000 lb` | 79832 kg | `lb x 0.45359237` |
| `0802120000` | `0802.12.0000` | Schedule B reformatted |
| `3/12/26` | `03/12/2026` | two-digit year flagged |
| `kilograms` | `KG` | UOM alias |
| `USA` / `domestic` | `D` | origin indicator |
| `Israel` | `IL` | country code |

Weight units are taken, in order, from the cell itself (`176,000 lb`), the
`ShippingWeightUOM` column, then the column name (`ShippingWeightLb`). With no
unit anywhere the value is taken as kilograms and the preview says so.

---

## 2. Get the identifiers from the email (Deckhand)

The booking reference, the container numbers and the seal numbers arrive by
email, from the carrier or from the producer, and used to be retyped. Deckhand
reads them out; you check them and approve.

It is the **Deckhand** tab of either panel (ACE Helper or INTTRA Helper; it
is the same screen). Or, on the QuickBooks PC:
`node ace-export.mjs deckhand booking.eml`, which prints the same review.

1. Paste the email body into the box, including any container and seal
   list. Or load a saved email: in Outlook, **File, Save As**, type
   Outlook Message Format is not readable; choose `.eml` if offered, or
   copy the text. Gmail: the three dots, **Show original**, **Download
   original** gives an `.eml`. A `.txt` works too.
2. Press **Extract**.
3. Read the review against the email:

   ```
   Deckhand - Shipment Extraction                       awaiting your review

   ✓  Booking reference    EBKG18531408     read from the document, "Carrier Booking No" on line 3
   ⚠  Shipment reference   (missing)        missing
   ✓  Vessel               MSC FIRENZE      read from the document
   ✓  Voyage               541W
   ✓  Port of loading      Los Angeles, CA
   ✓  Port of discharge    Derince

   Containers (3)
   1. ✓ Container      MSCU1234566   valid ISO 6346, line 8, 13
      ✓ Carrier seal   SL-4471209    read beside the container (same_row)
      ✓ Shipper seal   SH-001
   2. ✓ Container      MSDU7654322
      ✓ Carrier seal   SL-4471210
      ✓ Shipper seal   (none in the document)
   3. ✓ Container      TGHU7654320
      ✓ Carrier seal   SL-9          read beside the container (same_block)

   Not paired. The document did not show these seals beside a container: SL-99001, SL-99002.
   ```

   | Mark | Meaning |
   | --- | --- |
   | ✓ | read with confidence; a container number that passes its ISO 6346 check |
   | ? | read, but not with confidence; confirm it against the email |
   | ⚠ | missing, failed a check, contradicted, or could not be paired |

4. Press **Approve Shipment Data**.

What Deckhand will not do, and why the review looks the way it does:

- **A seal is attached to a container only when the email showed them
  together**: the same table row, the same line, or a "Container:" line
  followed directly by a "Seal:" line. "Containers: A, B" on one line and
  "Seals: 1, 2" on another is two lists; nothing pairs them, both are shown
  as not paired, and approval is blocked until you match them from the
  source. A seal on the wrong container is worse than a missing one.
- **A container number that fails its check digit is shown as read and
  flagged**, never corrected. Fix it in the email text and extract again.
- **A container the email gave two different seals** has its seal left blank
  and is flagged.
- **Missing is a value.** A missing vessel or port is shown as missing and
  does not block approval; you type it in the package or in the portal.

**Copy review block** and **Copy container rows (TSV)** put the same rows on
the clipboard if you would rather paste than fill. **Save as JSON** keeps the
extraction beside the shipment.

---

## 3. Build and check the package

The package is one shipment with every value from every source, each value
saying where it came from. It is the **Package** tab of either panel, or
`node ace-export.mjs package CN-1042 --deckhand booking.eml` on the
QuickBooks PC, which writes `filing-package-CN-1042_EBKG18531408.json`.

1. With the invoice imported (section 1) and the extraction approved
   (section 2), press **Build filing package**. In the INTTRA Helper, with
   only an extraction, the package holds the transport identifiers and no
   commercial data; that is allowed, and the cargo is typed in INTTRA.
2. Read the header:

   ```
   Ready. Ready to fill INTTRA. Review every field there before you save or submit.

   Booking reference    EBKG18531408      Deckhand, confirmed by QuickBooks
   Vessel               MSC FIRENZE       Deckhand, confirmed by QuickBooks
   Voyage               541W              Deckhand
   Port of loading      Los Angeles, CA   Deckhand
   Carrier              MSC Line          QuickBooks
   Consignee            Aydin Kuruyemis   QuickBooks
   Total weight (kg)    79832             Derived, sum of 1 line weight(s)
   ```

   | Colour | Source |
   | --- | --- |
   | green | QuickBooks, Excel or Deckhand, read with confidence |
   | yellow | derived (a total, an HS code from the Schedule B), or read with low confidence |
   | blue | typed by you |
   | red | missing: no source holds it |

3. **Resolve conflicts.** When the invoice and the email disagree about the
   booking, the vessel, a container or a seal, both values are shown and you
   pick one. Nothing is overwritten; until you pick, the package follows the
   owner of the field (Deckhand for transport identifiers) and **filling is
   blocked**. An invoice container field that reads "See Ocean B/L" is not a
   conflict; it is noted and set aside.
4. **Type what nobody holds.** A red cell is an input: package type, number
   of packages, marks and numbers, a port the email did not name. It is
   recorded as typed by you and survives a rebuild.
5. Read the **Notes**. Two you will see often: with several containers the
   invoice weight is a total and is not split across them; with several
   invoice lines and several containers, which cargo is in which container
   is not in any source, so the cargo columns are left for you.
6. **Save filing-package.json** for the INTTRA Helper (and keep it with the
   shipment), or **Apply to the ACE fields** (section 4).

The package can be loaded by either extension: ACE Helper **Import** accepts
it beside a workbook; INTTRA Helper **Import** takes only it.

---

## 4. Fill ACE

Install per SETUP-GUIDE section 1. ACE Helper fills the step you are looking
at; it does not walk the filing.

### Import

Panel, **Import**, choose the `.xlsx` (or drag it onto the panel from the
folder the export window named), or choose a `filing-package.json`. It is
parsed in the browser; nothing is uploaded. The panel says which kind of file
it opened:

```
QuickBooks export - QuickBooks Desktop (qbXML 16.0) - exported 2026-09-21
Excel workbook - My ACE Shipment.xlsx - read in this browser
Filing package - CN-1042_EBKG18531408 - QuickBooks export, Deckhand approved
```

A package fills ACE's booking, vessel, container and seal from the approved
email instead of from the workbook. With more than one container the two
container fields are left for you, and a "See Ocean B/L" placeholder from
QuickBooks is cleared rather than typed into ACE. The same happens when you
press **Apply to the ACE fields** on the Package tab.

### Overview

```
Invoice
CN-1042
Aydin Kuruyemis San Ve Tic A.S

Status
✓ QuickBooks export loaded
✓ 27 of 27 ACE fields mapped
⚠ 2 fields require review
✓ Deckhand extraction approved
✓ Filing package CN-1042_EBKG18531408 built

Actions
[ Preview ] [ Mapping status ] [ Fill Current Page ] [ Fill Current Line ]
[ Calculator ] [ Clear Data ]
```

### Preview: your review gate

Every field shows a traffic light: **green** mapped and plausible; **yellow**
missing, uncertain or transformed, with the original beside the ACE value;
**red** invalid and **will not be written**. Lines roll up to the worst status
they contain. Read the yellows: they are where an assumption was made for you.

### Mapping status

Panel, **Mapping**: one row per ACE field, answering "where did it come from
and which box is it going into?"

```
Shipping Weight (kg)                                              READY
  Source          QuickBooks export - InvoiceLineRet/Quantity
  Original        176000 lb
  Transformation  lb x 0.45359237
  ACE value       79832
  ACE selector    #shippingWeight
```

**Check against the open ACE page** resolves every selector and writes
nothing.

| Status | Means |
| --- | --- |
| `READY` | value is good and the ACE field was found |
| `NOT CHECKED` | value is good; nobody has looked at an ACE page yet |
| `REVIEW` | written, but something wants an eye |
| `MISSING` | ACE expects it and the data has no value for it |
| `EMPTY` | optional, not supplied |
| `ERROR` | the value cannot be turned into something ACE accepts |
| `NOT FOUND` | not on this page, or the selector is stale |
| `AMBIGUOUS` | several ACE fields matched. Deliberately not written |

### Data quality checks

Ten named checks sit directly above the Fill buttons:

```
Data quality checks                                       2 to review
  ✓ Required values present     ✓ Schedule B on every line
  ✓ Numbers are valid           ⚠ Origin on every line
  ✓ Amounts are positive        ⚠ License code on every line
  ✓ Weights are present         ✓ Dates are valid
  ✓ Units of measure recognised ✓ All columns mapped
```

They report; they do not block. A field with a blocking issue is skipped by
the filler, never guessed, never half-written.

### Fill

1. In ACE, navigate to the step you want (Shipment, Parties, Commodities,
   Transportation). Press **refresh** in the panel header after moving.
2. **Fill Current Page** for the shipment-level fields of that step, or
   **Fill Current Commodity Line** on the Commodities step with a Line Details
   form open. **Dry run** does everything except write.
3. Fields are tinted for a few seconds: green written as imported, yellow
   written but transformed, red failed. **show field** scrolls ACE to one.
4. Read the summary, then read the ACE form.
5. **You** click Save Line, Save, Submit, Certify.

For each commodity line: select the line on the Fill tab (or **Select this
line** in the preview), open that line in ACE, fill it, check it, save it in
ACE yourself, add the next line in ACE, select the next line here.

Safety behaviours: a field ACE already holds a different value in is left
alone and reported unless **Overwrite** is ticked; commodity-line writes are
scoped to the open Line Details container; an unidentified field is skipped
with a warning; both Fill buttons are disabled until the step is identified.

### The F2 calculator

ACE numeric fields reject `*`, `/`, `(` and `)`. Click into the field, press
**F2**, type `176000 * 0.45359237`, press **Enter**: `79832.26` goes in, and
only the result, never a thousands separator. **Escape** leaves the field as
it was. Supported: `+ - * /`, parentheses, decimals, a leading minus,
separators between digits. Invalid input is refused, never guessed. Rounding
is a setting. It works with nothing imported, and there is a second copy on
the panel's **Calculator** tab that writes nothing to ACE.

---

## 5. Fill INTTRA

Install per SETUP-GUIDE section 1. Read this first: **the INTTRA Helper has
not yet seen the live portal.** Until its selectors are captured (SETUP-GUIDE,
section 5), it will report most fields as "not found" on a real screen. That
is by design: a field that does not resolve is never written. Everything
below works today against the package; the selectors are what the first
live session captures.

### Load the package

Panel (toolbar icon, **Open full panel**), **Import**, choose
`filing-package.json`. Or paste the email into **Deckhand**, approve, and
**Build filing package** for a transport-only package. The Overview says
whether it is ready to fill; the Package tab says why not, if not.

### Fill a screen

1. In INTTRA, log in as you always do and open the Shipping Instruction.
   The helper never logs in.
2. Open **General Details**. In the helper, press **refresh** in the header;
   it names the screen it detected.
3. **Fill INTTRA**, **Fill Current Page**. Booking number, shipper's
   reference, carrier, vessel, voyage, port of loading and port of discharge.
   **Dry run** writes nothing.
4. Read every field, then press Save or Continue in INTTRA yourself.
5. **Container & Cargo**: pick the container in the helper's list, fill,
   check, save in INTTRA, pick the next container.
6. **Print Instructions** fills the freight terms; **B/L Documents** fills
   the consignee from the invoice's bill-to address; **Notification Emails**
   has nothing to fill, and the helper says so.

Each outcome in the report names its source ("Deckhand, confirmed by
QuickBooks"), what was written, and what INTTRA holds after the write.

### Copy Container Details, the grid

The live grid opens an editor when a cell is clicked, so nothing can be typed
into it: the route is **Copy rows** and paste, in the INTTRA Helper and in
Quickfill alike.

1. In INTTRA, open **Copy Container Details** and add as many rows as the
   package has containers. The helper never presses Add Row.
2. In the helper, **Containers**. The table shows the rows it will copy. Press
   **refresh** in the header if the pill does not say Copy Container Details;
   the header also names the INTTRA tab the helper is talking to.
3. **Copy rows** (the first button). The status line says what went on the
   clipboard: how many rows, the columns in the grid's own order, and any
   column left blank because no package column matches its heading. If it
   says the default order was used, the grid was not found: open Copy
   Container Details in INTTRA and copy again. If it still says so with the
   modal open, check the default order against the grid's headings and paste
   anyway; then see section 8.
4. In INTTRA, click the **first Container Number cell of the first empty
   row** and press **Ctrl+V**. The block starts at Container Number and has
   one cell per column, so it lines up with the grid.
5. Read the grid. Carrier Seal # stays empty when the source named a seal
   without saying whose: an unattributed seal is the shipper's.
6. **Fill Container Grid** is for a grid whose cells can be typed into; the
   helper leads with it when the INTTRA tab says so. One row per container,
   the container and its seals together on the row, every cell read back:

   ```
   Containers filled: 3 / 3   Verified cells: 13   Warnings: 0   Failed: 0   Unresolved: 0
   ```

   | Cell status | Means |
   | --- | --- |
   | verified | written and read back exactly |
   | filled | written; INTTRA reformatted it |
   | failed | INTTRA did not keep the value; the cell is tinted red |
   | skipped | the package has no value for this column |
   | unresolved | the cell has no control the helper can write; use Copy rows |
   | warning | the cell already held a different value and was left alone |

   If the grid has fewer rows than containers, the report says how many to
   add; fill again afterwards.
7. Continue in INTTRA yourself.

---

## 6. Settings, clearing data, the session log

**ACE Helper settings**

| Setting | Default | Effect |
| --- | --- | --- |
| Calculator rounding / decimals | 2 decimals | rounding applied to calculator results |
| Shipping weight decimals | 0 | ACE files whole kilograms |
| Value of goods decimals | 2 | |
| Highlight duration | 6000 ms | how long fields stay tinted |
| Dispatch blur after writing | on | helps fields that validate on blur |
| Treat unit-less weights as kilograms | on | off makes a unit-less weight a warning |
| Developer mode | off | verbose detection detail and console logging |

**INTTRA Helper settings**: highlight duration, dispatch blur, developer
mode. Neither extension has a setting that enables saving, continuing,
submitting or adding a row.

**Clearing data.** **Clear Data** drops the imported shipment, the Deckhand
extraction, the package and the session log from memory, and clears the
tinting. All of it also disappears when the browser closes: it is held in
session memory and never written to disk. Save the package file first if you
want to keep it.

**The session log.** Panel, **Diagnostics**. Everything that happened, in
order: imports, transformations, extractions, package builds, fills. **Copy
diagnostics** puts the whole picture on the clipboard; **Export diagnostics**
writes it to a file; those two are the complete list of places it can go. It
contains no credential, and an entry that looks like one is refused.

---

## 7. Warnings, and what each one means

| Message | What happened | What to do |
| --- | --- | --- |
| `No field on this page matched the mapping` | the selector did not resolve | you are probably on the wrong step; if not, the selectors need capturing (SETUP-GUIDE, sections 4 and 5) |
| `N fields matched "..."` | the selector is too loose | capture a precise selector |
| `The matching field is disabled or read-only` | the portal has not enabled it yet | fill whatever the portal requires first |
| `ACE already holds "..."` / `INTTRA already holds "..."` | the field is not empty and the values differ | check which is right, then tick **Overwrite** if yours is |
| `Truncated to N characters` | the value is longer than the portal allows | shorten it in the source and re-import |
| `Matched by a structural fallback` | resolved by position within a container, not by name | confirm it is the right box |
| `"..." is not in the local code table` | a country, UOM or ECCN this build does not know | confirm the value; it was passed through, not guessed |
| `Schedule B "..." has N digits` | wrong classification number | fix it at the source |
| `Column "..." is not a recognised ACE field` | an extra spreadsheet column | ignore, or rename it to a template column |
| `fails its ISO 6346 check digit` | a container number was misread or mistyped in the email | retype it from the source; it was not corrected |
| `were not shown next to each other, so they are listed separately and NOT paired` | two lists, nothing tying a seal to a container | match them from the source; approval is blocked until you do |
| `was given two different seals` | the email contradicts itself | fill the seal from the source |
| `The Deckhand extraction has not been approved` | the package carries an unreviewed extraction | review it on the Deckhand tab and approve |
| `Choose one before filling` | the invoice and the email disagree | pick a side on the Package tab |
| `is a total; it was not split across the N containers` | one invoice weight, several containers | enter each container's gross weight from the packing list |
| `No writable control in this cell` | the grid opens an editor on click | use Copy rows and paste |
| `The grid has N row(s) and the package has M container(s)` | not enough rows | add rows in INTTRA and fill again |

---

## 8. When something does not work

| Symptom | Cause and fix |
| --- | --- |
| "No ACE tab detected" / "No INTTRA tab detected" | the portal is not open in this window, or the tab was loaded before the extension. Reload the portal tab, then press **refresh** in the header. |
| "The page could not be identified", both Fill buttons disabled | you are on a page the detector does not recognise (a landing page, a modal). Navigate to a filing step and press refresh. On INTTRA, expected until the screen signatures are captured. |
| Many warnings saying a field was not found | on ACE, Step 4 is uncaptured; on INTTRA, everything is. Open **Diagnostics**, capture the selectors (SETUP-GUIDE, sections 4 and 5), paste them into the selector editor; no rebuild needed. |
| A field is filled with the wrong value | check the yellow note in the preview or the source column in the package: the value was probably transformed or came from the other source. Fix it at the source and re-import, or pick the other side of the conflict. |
| F2 does nothing | the focus must be in a text or number input. Ignored on dropdowns, dates and read-only fields. If it does nothing anywhere, reload the ACE tab. |
| The portal clears the value straight after filling | its own validation rejected it. The report reads "did not keep the value". |
| The import was refused | `.xlsx` / `.xlsm` / `.xltx` under 15 MB and 5000 rows, a real Excel file; or a `filing-package.json` written by these tools. A renamed `.csv` is rejected on purpose. |
| Deckhand found no containers | the email carries none in the ISO 6346 shape (4 letters, 7 digits), or they are in an attachment. Open the attachment, copy the text, paste it. PDFs and images are not read in this version. |
| Deckhand paired nothing | the email lists containers and seals separately. Match them from the source; do not expect the tool to guess. |
| "Cannot approve" | a check digit fails, a seal is contradicted, or a list is unpaired. Fix the text and extract again, or match by hand in INTTRA. |
| The Package tab says not ready | approve the extraction, or resolve the conflict it names. |
| The header names another screen while Copy Container Details is open | press **refresh**. If it still does, the header shows which tab answered (keep the Shipping Instruction in one tab) and the `build ...` stamp: compare it with the build you last loaded, and rebuild and reload the extension if it is older. Then **Diagnostics**: its evidence list says whether the grid and the modal marker were seen. |
| The pill says "INTTRA screen not identified" with Copy Container Details open, or Quickfill shows only **Copy rows** | Copy rows still works: the block is in the default order (Container Number, Carrier Seal #, Shipper Seal #, ...) and the status line says so; check that order against the grid's headings before pasting. Then **Diagnostics**, **Copy diagnostics**, and send it: its **Page structure** block says which frame answered, whether the captured ids are there, and what the grid is built from, which is what is needed to teach the helper its shape. |
| Copy rows pasted the container numbers but not the seals | the status line after Copy rows names the columns and any left blank. If Shipper Seal # is not among the columns, run **Diagnostics** and send the header row (the seal headings are dropdowns; the block reads the option each one shows). |
| Something is wrong and I need to show someone | **Diagnostics**, **Export diagnostics**: one text file with the shipment, the package, the mapping status, the session log and the detection snapshot. Uploaded nowhere. |
