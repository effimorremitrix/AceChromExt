# ACE field mapping

> **Status (2026-09-14): Steps 1-3 match the live portal by label wording;
> nothing matches by id yet; Step 4 is uncaptured.**
> The labels of every field on the Shipment, Parties (Ultimate Consignee) and
> Commodities (Line Details) screens were read off live AESDirect screenshots
> and are checked in as `capturedLabel(...)` candidates, so those 22 fields
> resolve at *medium* confidence. What is still missing is listed in
> [Exactly what still needs capturing](#exactly-what-still-needs-capturing):
> the element ids/names (high confidence), the dropdown option values and
> whether the dropdowns are native `<select>`s or combobox widgets, the Parties
> panel and Line Details containers, and the whole Transportation step (5
> fields, still placeholders). Nothing is ever written to a field that was not
> confidently found.
>
> **You do not need this document to fix a selector.** A captured selector can
> be pasted into the panel as JSON and is in force on the next fill, with no
> rebuild and no developer - see
> [Installing a captured selector without a rebuild](#installing-a-captured-selector-without-a-rebuild).
> This document is how you capture it, and how you make it permanent.

## The live screens, as captured

What ACE Helper fills is in **bold**; everything else is either a filer
decision or has no template column yet (the hand-off workbook
`docs/AceTemplateFieldsMapping.xlsx` lists those for the QuickBooks phase).

| Step | Screen | Fields in the order they appear |
| --- | --- | --- |
| 1 | Shipment | Email Response Address(es) · **Shipment Reference Number** · Filing Option · Mode of Transport (MOT) · Port of Export · Port of Unlading · **Departure Date** · Origin State · **Country of Destination** · Inbond Type · Foreign Trade Zone · Import Entry # · Original ITN |
| 2 | Parties → *Ultimate Consignee* panel (the USPPI panel above it repeats the same labels) | Sold En Route? · Consignee Type · ID Number Type · ID Number · **Company Name** · First Name · Last Name · Phone Number · **Address Line 1** · **Address Line 2** · **Country** · **Postal Code** · **City** · **State** |
| 3 | Commodities → *Line Summary* (table; **Add New Line**, Edit \| Delete) → *Line Details*, headed "Line N Details" | **Export Information Code** · **Schedule B or HTS Number** · **Commodity Description** · **1st Quantity** · **1st UOM** (read-only, derived from Schedule B) · **2nd Quantity** · **2nd UOM** · **Origin of Goods** · **Value of Goods (whole US Dollars)** · **Shipping Weight (whole Kilograms)** · **ECCN** · **License Type Code/License Exemption Code** · PGA data required? |
| 4 | Transportation | *not captured* |

Three facts from the screens changed the mappings:

- the Shipment step has **no PO Number and no INCO Terms** box, so the
  `PONumber` and `FreightTerms` template columns are reference data only;
- **Value of Goods is whole dollars** (`wholeDollars` transform) and Shipping
  Weight is whole kilograms, which the importer already produced;
- **1st UOM / 2nd UOM are derived by ACE** from the Schedule B number and shown
  read-only, so the filler reads them back and compares instead of writing
  (`aceDerived` on the mapping; a mismatch is reported as a warning).

Dropdowns render `CODE – DESCRIPTION` (`TR – TURKIYE`, `C33 – NLR ...`) with a
"Please Select" placeholder. The writer matches by value, then exact text,
then code prefix, so ISO codes such as `TR` select the right option **if** the
control is a native `<select>`. If ACE uses a combobox widget over a hidden
`<select>`, those fields will report "not writable" until the widget is
captured - see the last section.

## How the mapping layer works

A field mapping is split across four files, because the four things change at
four different rates:

| What | Where | Changes |
| --- | --- | --- |
| canonical field | `src/models/CanonicalInvoice.ts` | ~never |
| transformation | `src/ace/transformers/` | with ACE's rules |
| validation rule | `src/excel/validator.ts` (shared with the companion) | with ACE's rules |
| **ACE selector** | **`src/ace/selectors/`** | **whenever CBP redeploys the portal** |

The volatile one lives on its own, so fixing a broken field means editing a
table of strings.

`src/ace/mappings/commodities.ts` - what to fill:

```ts
defineField({
  key: 'ValueOfGoods',              // stable logical name, shown in diagnostics
  label: 'Value of Goods (whole US Dollars)', // human label, shown in the preview
  page: 'commodities',              // which ACE step it lives on
  scope: 'commodityLine',           // reads from a commodity, not the invoice
  source: 'commodity.valueOfGoods', // path into the canonical model
  type: 'number',
  transforms: ['wholeDollars'],     // named transformers, applied in order
  expected: true,                   // empty -> a warning, not a silent skip
  selectors: COMMODITY_SELECTORS,   // candidates looked up by `key`
});
```

`src/ace/selectors/commodities.ts` - where to find it:

```ts
ValueOfGoods: {
  candidates: [                     // tried in this order
    placeholder('id', '#valueOfGoods'),
    placeholder('name', "input[name='valueOfGoods']"),
    byFrameworkName('valueOfGoods'),   // formcontrolname / ng-reflect-name / data-*
    byIdSuffix('valueOfGoods'),        // for portals that namespace control ids
    capturedLabel(['Value of Goods (whole US Dollars)']), // read off the live screen
    byLabel(['Value of Goods', 'Value', 'Commodity Value']),   // guesses, kept as fallbacks
    byNearby("[data-section='commodityLine']", "input[name*='value' i]"),
  ],
  devtoolsHint: 'Line Details -> inspect the Value of Goods box...',
},
```

A mapping with no selector entry is a build error, not a field that silently
never fills.

### Selector strategy, in priority order

| # | Strategy | Confidence when verified | Notes |
| --- | --- | --- | --- |
| 1 | `id` / `name` | high | exact, captured from live ACE |
| 2 | `attribute` | high | `data-*`, `aria-label`, `formcontrolname`, ... |
| 3 | `label` | medium | the field's visible label text; survives markup changes. `capturedLabel(...)` = wording read off the live screen (verified, medium); `byLabel(...)` = a guess (degraded to low). A label candidate may carry `section: ['Ultimate Consignee']` to look only inside the panel with that heading |
| 4 | `nearby` | low | first writable control inside a named container |
| 5 | `placeholder` | low | last resort |

Rules the detector enforces (`src/content/fieldDetector.ts`):

- a candidate that matches **several** visible, writable controls is
  `AMBIGUOUS`, and the field is **not** written;
- a match from an **unverified** candidate is degraded one confidence level,
  and a low-confidence write is reported as "confirm this is the right field";
- a candidate matching only disabled/hidden controls reports `NOT_WRITABLE`;
- label text is compared after stripping everything that is not a letter or
  a digit, so the required star, the conditional diamond, the info icon and a
  bracketed link (`[Schedule B Search Engine]`) never get in the way, and the
  comparison is otherwise exact: `1st Quantity` never matches `Quantity`;
- a `section`-scoped label looks only inside the panel headed by that text
  (the heading's nearest ancestor that contains a form control). No heading on
  the page means no match, never a guess between the USPPI and the consignee;
- there are **no positional heuristics** anywhere. "The third textbox on the
  page" is never how a field is found. A test asserts this
  (`tests/aceMapping.test.ts`, "no positional selectors").

## Verifying a field against live ACE

You need an ACE account and a filing open in the portal. Nothing below changes
a filing; you are only reading the DOM.

### 1. Open Diagnostics

Extension panel -> **Diagnostics** -> **Run field detection on the ACE tab**.
Every field that did not resolve is listed with each candidate that was tried.
(**Settings -> Developer mode** additionally turns on console logging.)

### 2. Capture the real element

1. Open the ACE step that has the field.
2. Right-click the field -> **Inspect**.
3. In Elements, right-click the highlighted node -> **Copy** -> **Copy outerHTML**.
4. Paste it somewhere you can read it.

What to look for, in order of usefulness:

| Attribute | Use as |
| --- | --- |
| `id="..."` (stable, not `id="mat-input-27"`) | `verified('id', '#thatId')` |
| `name="..."` | `verified('name', "input[name='thatName']")` |
| `formcontrolname`, `ng-reflect-name`, `data-*`, `aria-label` | `verified('attribute', "[formcontrolname='x']")` |
| the associated `<label>` text | `byLabel([...])` |

**Beware generated ids.** Angular Material (`mat-input-27`), React
(`:r3:`), and similar produce ids that change between renders. If an id looks
generated, reload the page twice and compare. If it changes, do not use it -
prefer `formcontrolname`/`name`, then the label.

For a **dropdown**, also copy two `<option>` tags. The writer needs to know
whether option values are codes (`value="KG"`) or descriptions
(`value="Kilograms"`); it matches by value, then by exact option text, then by
a code prefix such as `C33 - ...`.

For a **commodity-line** field, also capture the container that wraps one open
Line Details form, and add it to `lineContainerSelectors` in
`src/ace/pages.ts`. This is what stops a write landing on another line.

### 3. Put it in the selector table

Replace the placeholder with a verified candidate in
`src/ace/selectors/<page>.ts`, keeping the placeholders below it as fallbacks:

```ts
ValueOfGoods: {
  candidates: [
    verified('id', '#realIdFromAce', 'captured 2026-03-12 from the Commodities step'),
    placeholder('name', "input[name='valueOfGoods']"),
    byLabel(['Value of Goods']),
  ],
  devtoolsHint: '...',
},
```

`verificationStatus` is derived automatically: one verified candidate flips the
field from `placeholder` to `verified`. A `capturedLabel([...])` counts too -
that is how Steps 1-3 are verified today - but keep the distinction honest in
the note: *label read off the screen* is not *element copied from the DOM*.

**Or skip this step entirely** and paste the selector into the panel instead -
next section. Editing the file is how a selector becomes permanent for everyone
who installs the build; pasting is how it works on this machine in a minute.

## Installing a captured selector without a rebuild

Panel -> **Diagnostics** -> **ACE selectors** -> **Starter for unresolved
fields** gives a JSON skeleton containing only the fields that failed:

```json
{
  "version": 1,
  "capturedAt": "2026-09-24",
  "fields": {
    "ScheduleB": [
      { "strategy": "id", "selector": "#filingForm\\:lineDetails\\:scheduleB" }
    ],
    "LicenseCode": [
      { "strategy": "label", "labelText": ["License Code/License Exemption"] }
    ]
  }
}
```

Press **Save selectors**. They take effect on the next fill; reload the ACE tab
if it was already open.

| | |
| --- | --- |
| Where they are stored | `chrome.storage.local` in this browser profile. They contain CSS selectors and label text read off a public form - no shipment, customer or credential data |
| Precedence | tried **first**, and counted as verified, because a human read them off the live DOM |
| Failure mode | the built-in candidates stay behind them, so a wrong paste degrades to today's behaviour rather than breaking the field |
| Validation | strategy, selector syntax, field key, sizes and `__proto__` are all checked on save. Anything unusable is refused with a message and nothing is stored |
| Sharing | **Export** writes the JSON file; paste it into another machine's panel |
| Undo | **Remove all** goes back to the built-ins |

`strategy` is one of `id`, `name`, `attribute`, `label`, `nearby`,
`placeholder`. `label` takes `labelText` (an array); `placeholder` takes
`placeholder`; the rest take `selector`. `nearby` may also take `within`.

### 4. Check it

```bash
npm run typecheck && npm test && npm run build
```

Reload the extension, reload the ACE tab, open **Diagnostics**, and click
**Run field detection on the ACE tab**. The field should read:

```
ValueOfGoods   FOUND
  matched by: id -> #realIdFromAce (confidence high)
```

Then use **Dry run** on the Fill tab before filling for real.

### 5. Keep the fixture honest

`tests/fixtures/*.html` are mock screens, not captures. Once you have real
markup, replace a fixture with a trimmed real snippet (remove session tokens,
names, and any other filing content first). The fill tests then run against the
real shape of ACE.

## Exactly what still needs capturing

The label wording of Steps 1-3 is done. Each field below still needs one DOM
capture to go from medium to high confidence; `devtoolsHint` in the selector
table repeats this inside the Diagnostics panel, next to the field.

### Step 1: Shipment (`src/ace/selectors/shipment.ts`)

| Field | Label (verified) | Still to capture |
| --- | --- | --- |
| `ShipmentReferenceNumber` | Shipment Reference Number | the `<input>` id/name |
| `InvoiceDate` | Departure Date | the `<input>` (it shows `MM/DD/YYYY` and a calendar button); confirm a typed date is kept on blur |
| `Destination` | Country of Destination | the `<select>` **plus two `<option>` tags**, and whether a combobox widget sits over it |

### Step 2: Parties (`src/ace/selectors/parties.ts`)

All seven are scoped to the panel headed **Ultimate Consignee**.

| Field | Label (verified) | Still to capture |
| --- | --- | --- |
| `UltimateConsigneeName` | Company Name | the `<input>`, and the panel container element (`[data-section='ultimateConsignee']` is a guess) |
| `UltimateConsigneeAddress`, `UltimateConsigneeAddress2` | Address Line 1 / 2 | the `<input>`s and their `maxlength` |
| `UltimateConsigneeCity` | City | the `<input>` |
| `UltimateConsigneeState` | State | the control, with a US consignee selected (it is greyed out for TR), plus two `<option>` tags |
| `UltimateConsigneePostalCode` | Postal Code | the `<input>`, with a country that requires it |
| `UltimateConsigneeCountry` | Country | the `<select>` plus two `<option>` tags (`TR – TURKIYE`: are values ISO codes?) |

Sold En Route, Consignee Type and the ID numbers are intentionally not mapped:
identity data and filing decisions stay manual.

### Step 3: Commodities (`src/ace/selectors/commodities.ts`)

Open a line first (Edit on the Line Summary table, or Add New Line); the form
is headed "Line N Details".

| Field | Label (verified) | Still to capture |
| --- | --- | --- |
| `ExportInformationCode` | Export Information Code | `<select>` + sample `<option>` (`OS – ALL OTHER EXPORTS`) |
| `ScheduleB` | Schedule B or HTS Number | the `<input>`; the screen shows the dotted form `0802.12.0000`, so the dotted transform stays |
| `CommodityDescription` | Commodity Description | `<input>` or `<textarea>`, and its `maxlength` |
| `Quantity1`, `Quantity2` | 1st Quantity, 2nd Quantity | the `<input>`s (2nd Quantity is disabled until the Schedule B needs a second unit) |
| `UOM1`, `UOM2` | 1st UOM, 2nd UOM | the read-only element ACE fills from the Schedule B number, so the read-back comparison has a verified target |
| `Origin` | Origin of Goods | the control and its options (`D – DOMESTIC`) |
| `ValueOfGoods` | Value of Goods (whole US Dollars) | the `<input>` |
| `ShippingWeight` | Shipping Weight (whole Kilograms) | the `<input>` |
| `ECCN` | ECCN | the `<input>` |
| `LicenseCode` | License Type Code/License Exemption Code | `<select>` + sample `<option>` (`C33 – NLR ...`) |
| *line container* | "Line N Details" heading (verified) | the element that wraps the open form -> `lineContainerSelectors` in `src/ace/pages.ts` |

### Step 4: Transportation (`src/ace/selectors/transportation.ts`) - **not captured**

Everything: a screenshot of the step first (labels), then the elements.

| Field | Capture |
| --- | --- |
| `Carrier` | the carrier control; note whether it is an SCAC autocomplete |
| `Vessel` | the Conveyance Name `<input>` |
| `BookingNumber` | the `<input>` |
| `ContainerNumber`, `SealNumber` | the `<input>`s **and the repeating row container** |

### Page detection (`src/ace/pages.ts`)

The tab texts ("Step 1: Shipment" ... "Step 4: Transportation"), the
Commodities sub-tabs ("Line Summary" / "Line Details") and the "Line N
Details" heading are verified. Still to capture, per step: the active tab
element's markup (the detector reads `[aria-selected="true"]`,
`[aria-current="step"]`, `.active`, ...), the URL path or hash, and one marker
element that only exists on that step.

## If ACE changes its DOM

1. Open **Diagnostics** on the affected step. Any field that stopped resolving
   shows `NOT_FOUND` (or `AMBIGUOUS`) with every candidate that was tried. The
   **Mapping** tab says the same thing per field, with the selector in force.
2. Re-capture that element.
3. Paste it into **ACE selectors** and save. Filing can continue immediately.
4. When it has proven itself, move it into `src/ace/selectors/<page>.ts` as a
   `verified(...)` candidate so the next build carries it. Keep the old one
   below it: a stale candidate that matches nothing costs nothing and covers
   the case where ACE reverts.
5. **Export diagnostics** attaches the whole picture - mapping status, session
   log and detection snapshot - to a bug report.

## Autocompletes, date pickers, and custom widgets

The live dropdowns ("Please Select" placeholder, `CODE – DESCRIPTION`
options, a truncated `...` in long entries) look like combobox widgets. Until
the DOM is captured it is unknown whether a native `<select>` sits underneath.
If it does, the writer selects the option; if the native control is hidden,
the field reports "not writable" and stays manual.

Some ACE controls are not plain inputs. Writing a value with
`setAceFieldValue` fires `input` and `change`, which is what most frameworks
listen to, but a component that only commits on a keyboard event or a menu
click may not accept it. The write is verified by reading the value back, so
this shows up as an honest "ACE did not keep the value" rather than a
false success. Such fields stay manual until a component-specific writer is
added - the mapping layer has room for one (`AceFieldType` is the hook), and
it is deliberately not in this version.
