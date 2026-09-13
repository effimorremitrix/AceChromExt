# ACE Helper - user guide

ACE Helper types values you have already reviewed into the ACE filing form you
have open. It does four things:

1. **F2 calculator** beside any numeric ACE field.
2. **Excel import** into a canonical shipment model, in your browser.
3. **Preview** with traffic lights, before anything is written.
4. **Fill Current Page** / **Fill Current Commodity Line**, on your click.

## What it will never do

- It never saves a commodity line, submits, or certifies a filing.
- It never navigates ACE for you; you move between steps yourself.
- It never touches ACE sign-in, MFA, CAPTCHA, or any other security control.
- It never sends shipment or customer data anywhere. There is no server.
- It never stores your ACE credentials, because it never sees them.

The last click is always yours. Treat everything the extension writes as a
draft that you are responsible for checking.

---

## 1. The F2 calculator

ACE numeric fields reject `*`, `/`, `(` and `)`, so you cannot type a formula
into them. The calculator does the arithmetic beside the field and inserts only
the result.

1. Click into the ACE field (Value of Goods, Shipping Weight, Quantity...).
2. Press **F2**. A small panel opens beside the field.
3. Type an expression. The result updates as you type:

   | Expression | Result |
   | --- | --- |
   | `20 * 4` | 80 |
   | `79833 * 7.94` | 633,874.02 |
   | `(12000 + 3500) / 2` | 7,750 |
   | `633600 / 79833` | 7.94 |

4. Press **Enter** to insert the result, or **Escape** to close and leave the
   field exactly as it was.

Details worth knowing:

- Supported: `+ - * /`, parentheses, decimals, a leading minus, and thousands
  separators between digits (`79,833 * 2` works).
- The inserted value never contains thousands separators, because ACE rejects them.
- Invalid input is refused, never guessed: bad syntax, unmatched parentheses,
  division by zero, and anything that is not a finite number. Enter does
  nothing while the result line is red.
- Rounding is configurable in **Settings** (2 decimals by default; whole
  numbers and "no rounding" are the other options).
- If the field already holds a plain number, it is pre-loaded as the starting
  expression, so `+ 500` style adjustments are quick.
- There is no `eval()` anywhere: expressions are parsed by a hand-written
  parser that can only ever produce a number.

## 2. Importing a spreadsheet

> **Working from QuickBooks Desktop?** You do not have to fill the spreadsheet
> in by hand. The companion writes it for you from an invoice:
> `ace-export export CN-1042` produces `ACE_Invoice_CN-1042.xlsx`, which you
> then import exactly as below. It reads what QuickBooks holds, converts pounds
> to kilograms, and flags the customs facts QuickBooks does not hold rather
> than guessing them. See
> **[QUICKBOOKS-INTEGRATION.md](QUICKBOOKS-INTEGRATION.md)**.

Import happens in the **panel**, not the popup: Chrome closes a popup as soon as
a file picker opens.

1. Click the toolbar icon, then **Open full panel**.
2. On the **Import** tab, click **Download the import template** the first
   time - it has the canonical columns, a worked example, and per-column notes.
3. Fill the template in: **one row per ACE commodity line**. Shipment-level
   columns (invoice number, customer, carrier, container...) only need to be on
   the first row.
4. Choose the file. If the workbook has several sheets, pick the sheet.

The workbook is parsed inside the browser. Nothing is uploaded.

### Columns

Commodity line: `Line`, `ExportInformationCode`, `ScheduleB`,
`CommodityDescription`, `Quantity1`, `UOM1`, `Quantity2`, `UOM2`, `Origin`,
`ValueOfGoods`, `ShippingWeight`, `ShippingWeightUOM`, `ECCN`, `LicenseCode`.

Shipment level: `CustomerName`, `InvoiceNumber`, `InvoiceDate`, `BillTo`,
`FreightTerms`, `PaymentTerms`, `PaymentDueDate`, `PONumber`, `Carrier`,
`Vessel`, `BookingNumber`, `ContainerNumber`, `SealNumber`, `Destination`.

Header matching ignores case, spaces, and punctuation, and common aliases are
accepted (`Qty 1`, `HTS Number`, `Ultimate Consignee`, `Gross Weight`, ...).
Unrecognised columns are ignored and listed in the import notes.

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
unit anywhere, the value is taken as kilograms and the preview says so.

## 3. The preview: your review gate

Every field shows a traffic light:

- **green** - mapped and plausible
- **yellow** - missing, uncertain, or transformed; the original is shown beside
  the ACE value so you can check the conversion
- **red** - invalid or unusable; it will not be written to ACE

Lines roll up to the worst status they contain. Read the yellows: they are
where an assumption was made on your behalf.

## 4. Filling ACE

ACE Helper fills the step you are looking at. It does not walk the filing.

1. In ACE, navigate to the step you want (Shipment, Parties, Commodities,
   Transportation).
2. Click the ACE Helper icon. The header shows the detected step. Use
   **refresh** in the header after navigating in ACE.
3. Click:
   - **Fill Current Page** - the shipment-level fields for that step, or
   - **Fill Current Commodity Line** - one commodity line into the Line Details
     form you have open (Commodities step only).
4. Read the summary, then read the ACE form.
5. **You** click Save Line / Save / Submit in ACE.

### Choosing the commodity line

Pick the line on the **Fill** tab, or press **Select this line** on the line in
the preview. Then, for each line: open that line in ACE, click **Fill Current
Commodity Line**, check it, save it in ACE yourself, add the next line in ACE,
select the next line here. Saving, adding, and advancing are deliberately not
automated in this version.

### What the colours on the ACE page mean

After a fill, fields are tinted for a few seconds (configurable):

- light green - written as imported
- yellow - written, but transformed or calculated; check it
- red - the write failed

### The summary

```
Filled: 8    Skipped: 2    Warnings: 1
```

- **Filled** - written successfully.
- **Skipped** - nothing to write (the spreadsheet cell was empty).
- **Warnings** - written but worth a look, or deliberately not written: an
  ACE field that could not be identified, a value ACE already held, an
  ambiguous match, a required value that was missing.
- **Errors** - the value could not be produced or ACE rejected it.

Click **show field** next to any warning to scroll to and focus that field in
the ACE tab.

### Safety behaviours

- A field ACE already holds a *different* value in is left alone, and reported.
  Tick **Overwrite ACE fields that already have a different value** to replace.
- **Dry run** resolves and transforms everything and writes nothing, so you can
  see what would happen.
- Commodity-line writes are scoped to the open Line Details container, so a
  write cannot land on another line.
- If a field cannot be identified with confidence, it is skipped with a
  warning - never guessed at.
- If the ACE step cannot be identified, both Fill buttons are disabled.

## 4b. The mapping status screen

Panel -> **Mapping**. The preview asks "is this value right?"; this screen asks
"where did it come from, and which ACE box is it going into?" - one row per ACE
field:

```
Shipping Weight (kg)                                              READY
  Source          QuickBooks export - InvoiceLineRet/Quantity
  Original        176000 lb
  Transformation  lb x 0.45359237
  ACE value       79832
  ACE selector    #shippingWeight
```

It works with no ACE tab open. **Check against the open ACE page** resolves
every selector against the page you have open and **writes nothing** - which is
how you find out that a field says `NOT FOUND` before you rely on it.

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

## 4c. Data quality checks

Ten named checks sit directly above the Fill buttons, because that is the last
thing read before the first thing clicked:

```
Data quality checks                                       2 to review
  ✓ Required values present     ✓ Schedule B on every line
  ✓ Numbers are valid           ⚠ Origin on every line
  ✓ Amounts are positive        ⚠ License code on every line
  ✓ Weights are present         ✓ Dates are valid
  ✓ Units of measure recognised ✓ All columns mapped
```

They report; they do not block. A field with a blocking issue is skipped by the
filler anyway - never guessed, never half-written - so the good fields can be
typed while you go and find the missing one.

## 4d. The session log

Panel -> **Diagnostics**. Everything that happened, in order:

```
20:01:12  import      Loaded ACE_Invoice_CN-1042.xlsx - 1 line(s) via QuickBooks export
20:01:12  transform   Line 1 shippingWeight: 176000 lb -> 79,832 kg   (lb x 0.45359237)
20:03:44  fill        Filled Shipment page: filled 4, skipped 1, warnings 0, errors 0
20:05:09  fill        Filled Commodity line 1: filled 10, warnings 1, errors 0
```

**Copy diagnostics** puts the whole picture on the clipboard; **Export
diagnostics** writes it to a file. Those two are the complete list of places it
can go - the extension has no network permission and nothing is uploaded.

It lives in memory for the browsing session only, contains no credential, and is
cleared along with the imported data when you press **Clear Data**. Export it
first if you want the trail.

## 5. Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Calculator rounding / decimals | 2 decimals | rounding applied to calculator results |
| Shipping weight decimals | 0 | ACE files whole kilograms |
| Value of goods decimals | 2 | |
| Highlight duration | 6000 ms | how long ACE fields stay tinted |
| Dispatch blur after writing | on | helps ACE fields that validate on blur |
| Treat unit-less weights as kilograms | on | off makes a unit-less weight a warning |
| Developer mode | off | verbose field-detection detail and console logging. The Diagnostics tab itself is always available |

## 6. Clearing data

**Clear Imported Data** on the Import tab drops the shipment from memory and
clears the highlighting. Imported data also disappears when the browser closes:
it is held in session memory and never written to disk.

## 7. When something does not work

| Symptom | Cause and fix |
| --- | --- |
| "No ACE tab detected" | ACE is not open, or the tab was loaded before the extension. Reload the ACE tab. |
| "The ACE page could not be identified" | You are on a page the detector does not recognise (a landing page, a modal, an iframe). Navigate to a filing step and press refresh. |
| Both Fill buttons disabled | Same as above; the page must be identified first. |
| Many warnings saying a field was not found | Expected until the ACE selectors are verified. Open **Diagnostics**, capture the real selectors (`docs/ACE-MAPPING.md`), and paste them into **ACE selectors** - no rebuild needed. |
| A field is filled with the wrong value | Check the yellow note in the preview: the value was probably transformed. Fix the spreadsheet, re-import. |
| F2 does nothing | The focus must be in a text/number input. It is ignored on dropdowns, dates, and read-only fields. |
| ACE clears the value straight after filling | ACE's own validation rejected it. The summary reports "ACE did not keep the value". |
