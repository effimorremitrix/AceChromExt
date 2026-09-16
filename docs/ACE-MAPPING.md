# ACE field mapping

> **Status (2026-09-16): six ids captured from the live DOM; every field
> matches by label; Step 4 turned out to have three fields, not five.**
>
> On 2026-09-14 the labels of Steps 1-3 were read off live AESDirect
> screenshots. On 2026-09-16 a second pass added Step 4's labels, the first
> real element ids, and two structural facts that change how everything here
> should be read:
>
> 1. **ACE ids are Spring binding paths**, not the plain names this project
>    guessed: `commodityLines[0].quantity1.stringField`,
>    `shipmentInfo.conveyanceName.stringField`. Every guess of the form
>    `#quantity1` was wrong, and so was the `byIdSuffix` fallback, because the
>    real ids end in `.stringField` rather than in the field name. Use
>    `bindingPath(...)` / `bindingSuffix(...)` from
>    `src/ace/selectors/types.ts`. Note also that
>    `#commodityLines[0].quantity1.stringField` is **not valid CSS** - the
>    brackets and dots parse as attribute and class selectors - so it has to be
>    written as an attribute match.
> 2. **Every dropdown is a Select2 3.x combobox** over a hidden `<select>`.
>    This was the open question in the 2026-09-14 status and the answer is the
>    awkward one. See [Select2 dropdowns](#select2-dropdowns).
>
> Six ids are now `verified(...)` or `bindingPath(...)`: Departure Date,
> 1st Quantity, Value of Goods, Shipping Weight, Conveyance Name and
> Transportation Reference Number. Twenty fields still match by label only;
> `fieldsWithoutCapturedSelector()` in `src/ace/mappings/index.ts` is the live
> list and `tests/aceMapping.test.ts` pins it, so it can only get shorter.
> Nothing is ever written to a field that was not confidently found.
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
| 1 | Shipment | Email Response Address(es) · **Shipment Reference Number** · Filing Option · Mode of Transport (MOT) · Port of Export · Port of Unlading · **Departure Date** · **Origin State** · **Country of Destination** · Inbond Type · Foreign Trade Zone · Import Entry # · Original ITN · Routed Transaction? · USPPI and Consignee related? · Hazardous material? |
| 2 | Parties → *Ultimate Consignee* panel (the USPPI panel above it repeats the same labels) | Sold En Route? · Consignee Type · ID Number Type · ID Number · **Company Name** · First Name · Last Name · Phone Number · **Address Line 1** · **Address Line 2** · **Country** · **Postal Code** · **City** · **State** |
| 3 | Commodities → *Line Summary* (table; **Add New Line**, Edit \| Delete) → *Line Details*, headed "Line N Details" | **Export Information Code** · **Schedule B or HTS Number** · **Commodity Description** · **1st Quantity** · **1st UOM** (read-only, derived from Schedule B) · **2nd Quantity** · **2nd UOM** · **Origin of Goods** · **Value of Goods (whole US Dollars)** · **Shipping Weight (whole Kilograms)** · **ECCN** · **License Type Code/License Exemption Code** · PGA data required? |
| 4 | Transportation | **Carrier SCAC/IATA** · **Conveyance Name/Carrier Name** · **Transportation Reference Number** |

Facts from the screens that changed the mappings:

- the Shipment step has **no PO Number and no INCO Terms** box, so the
  `PONumber` and `FreightTerms` template columns are reference data only;
- **Step 4 has no Container Number and no Seal Number box.** Confirmed in edit
  mode on 2026-09-16 with Mode of Transport set to `11 - VESSEL,
  CONTAINERIZED`, the case where a container panel would appear if ACE had
  one. They were never ACE fields: container and seal are carrier booking
  data, which is what the INTTRA Helper fills. Both stay in the canonical
  model and the spreadsheet; neither is mapped to an ACE field;
- **the booking number is filed as Transportation Reference Number**
  (`refNbrValue`, maxlength 30). For a vessel shipment they are the same AES
  data element, so the mapping is keyed `TransportationReferenceNumber` and
  still sourced from `invoice.bookingNumber`;
- **Carrier SCAC/IATA takes a code, not a name.** The live value is `MSCU`,
  MSC's SCAC. The mapping upper-cases it and the validator warns when the
  spreadsheet supplies anything longer than four characters. The element's own
  maxlength has not been captured, so no length is claimed on the mapping;
- **Conveyance Name/Carrier Name is `maxlength="23"`**, and the live value
  `MSC JULIE V. MC732R` packs the vessel name AND the voyage number into that
  budget;
- **Origin State is the US state the goods come from**, not the state of the
  export port and not the consignee's state. Pecans grown in Texas and shipped
  through Savannah file `TX`, not `GA`; almonds railed from northern
  California to Norfolk file `CA`, not `VA`. It is a new canonical field
  (`invoice.originState`), a new template column (`OriginState`) and a
  `usState` transform that converts a state name to its code. ACE takes one
  per filing, not one per commodity line;
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

All four steps' label wording is done. Each field below still needs one DOM
capture to go from medium to high confidence; `devtoolsHint` in the selector
table repeats this inside the Diagnostics panel, next to the field.
`fieldsWithoutCapturedSelector()` is the same list in code, pinned by
`tests/aceMapping.test.ts`.

**Capture dropdowns with the list closed.** Inspecting an open Select2
dropdown lands on `<div id="select2-drop-mask">`, a page-wide transparent
overlay that belongs to no field. See
[Select2 dropdowns](#select2-dropdowns).

### Step 1: Shipment (`src/ace/selectors/shipment.ts`)

| Field | Label (verified) | Still to capture |
| --- | --- | --- |
| `ShipmentReferenceNumber` | Shipment Reference Number | the `<input>` id/name |
| `InvoiceDate` | Departure Date | **done**: `id="estExportDate"`, `maxlength="10"`, `placeholder="MM/DD/YYYY"`. Still confirm a typed date survives blur |
| `OriginState` | Origin State | the backing `<select class="select2-offscreen">` **plus two `<option>` tags**. The 2026-09-16 attempt caught Select2's own label (`s2id_autogen4_search`), which suggests the source `<select>` has no id of its own |
| `Destination` | Country of Destination | the backing `<select>` **plus two `<option>` tags** (`TR – TURKIYE`: are values ISO codes?) |

**Deliberately not mapped** (decided 2026-09-16): **Port of Export**
(required; `2811 – METROPOLITAN OAKLAND INT` on the captured filing) and
**Port of Unlading** (conditional; `48942 – DERINCE,DERINDJE,DERINCE BURNA`).
Both change with the routing, so a saved template cannot carry them, but they
are two dropdowns the filer picks in seconds and neither is worth a canonical
field and a spreadsheet column yet. Revisit if the filing volume rises. They
are Select2 dropdowns over long coded lists, so if they are ever mapped,
capture two `<option>` tags with them.

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
| `Quantity1` | 1st Quantity | **done**: `commodityLines[0].quantity1.stringField`, `nonNegativeIntegersOnly`, `maxlength="10"` |
| `Quantity2` | 2nd Quantity | the `<input>` (disabled until the Schedule B needs a second unit) |
| `UOM1`, `UOM2` | 1st UOM, 2nd UOM | the read-only element ACE fills from the Schedule B number, so the read-back comparison has a verified target |
| `Origin` | Origin of Goods | the control and its options (`D – DOMESTIC`) |
| `ValueOfGoods` | Value of Goods (whole US Dollars) | **done**: `commodityLines[0].goodsValue.stringField` (note `goodsValue`, not `valueOfGoods`), `nonNegativeIntegersOnly`, `maxlength="10"` |
| `ShippingWeight` | Shipping Weight (whole Kilograms) | **done**: `commodityLines[0].shipmentWeight.stringField` (note `shipmentWeight`, not `shippingWeight`) |
| `ECCN` | ECCN | the `<input>` |
| `LicenseCode` | License Type Code/License Exemption Code | `<select>` + sample `<option>` (`C33 – NLR ...`) |
| *line container* | "Line N Details" heading (verified) | the element that wraps the open form -> `lineContainerSelectors` in `src/ace/pages.ts` |

### Step 4: Transportation (`src/ace/selectors/transportation.ts`)

The step holds three controls and nothing else.

| Field | Label (verified) | Still to capture |
| --- | --- | --- |
| `Carrier` | Carrier SCAC/IATA | the `<input>` id/name **and its `maxlength`**; the live value is the 4-letter SCAC `MSCU`. **Open question (2026-09-16):** nobody has confirmed whether the spreadsheet carries a SCAC or only a carrier name, so the mapping upper-cases whatever it gets and the validator warns on anything longer than four characters rather than guessing a lookup |
| `Vessel` | Conveyance Name/Carrier Name | **done**: `shipmentInfo.conveyanceName.stringField`, `maxlength="23"` |
| `TransportationReferenceNumber` | Transportation Reference Number | **done**: `id="refNbrValue"`, `maxlength="30"`. The odd one out: a bare name with no binding path and no `.stringField` wrapper |

There is no Container Number and no Seal Number on this step.

### Page detection (`src/ace/pages.ts`)

The tab texts ("Step 1: Shipment" ... "Step 4: Transportation"), the
Commodities sub-tabs ("Line Summary" / "Line Details") and the "Line N
Details" heading are verified. Still to capture, per step: the active tab
element's markup (the detector reads `[aria-selected="true"]`,
`[aria-current="step"]`, `.active`, ...), the URL path or hash, and one marker
element that only exists on that step.

## Select2 dropdowns

Every ACE dropdown is a [Select2](https://select2.org) 3.x combobox. Select2
leaves the real `<select>` in the form, tagged `select2-offscreen`, and builds
a parallel widget beside it:

```html
<select name="originState" class="select2-offscreen" tabindex="-1">…</select>
<div class="select2-container" id="s2id_autogen4">
  <a class="select2-choice"><span class="select2-chosen" id="select2-chosen-3">Please Select</span>…</a>
</div>
<!-- appended to <body>, away from the field: -->
<div class="select2-drop">
  <label for="s2id_autogen4_search" class="select2-offscreen">Origin State * </label>
  <input class="select2-input" id="s2id_autogen4_search" role="combobox">
  <ul class="select2-results" id="select2-results-4"></ul>
</div>
<div id="select2-drop-mask"></div>
```

Four consequences, all handled by `resolveSelect2` in
`src/content/fieldDetector.ts`:

1. **The widget's ids are positional.** `select2-chosen-3`,
   `select2-results-4` and `s2id_autogen4` are numbered from one global
   counter, so they move whenever CBP adds or reorders a dropdown anywhere on
   the page. Never write one into a selector table.
2. **`s2id_autogen<n>` means the source `<select>` has no id.** Select2 builds
   the container id as `s2id_` + the original element's id, falling back to
   `autogen<n>`. So `s2id_autogen4` on Origin State says there is no
   `#originState` to find. The detector strips the `s2id_` prefix when it can
   and otherwise walks up to the form group and takes the
   `select.select2-offscreen` inside it; if a group holds more than one, all
   are returned and the field is reported AMBIGUOUS rather than guessed.
3. **Select2 copies the field's label** onto its own offscreen label for the
   search box, so a label search finds two controls and the field would be
   refused as AMBIGUOUS. Resolution collapses both onto the one `<select>`.
4. **`select2-drop-mask` is a page-wide overlay**, which is what an Inspect
   click lands on while a dropdown is open. It belongs to no field and
   resolves to nothing.

**Still untested against the live portal.** `setAceFieldValue` writes the
`<select>` and dispatches `input` and `change`. jQuery listens to native
events, so Select2 3.x should repaint `.select2-chosen` from its own
`change.select2` handler, but this has never been run against ACE. Two ways it
can still fail, both worth checking on the first live fill:

- the visible box keeps saying "Please Select" while the `<select>` holds the
  right value;
- the `<option>` does not exist yet, because Select2 is loading the list over
  AJAX. This is likeliest on Port of Export and Port of Unlading, whose lists
  are long. The writer already reports `No dropdown option matches "..."`
  rather than typing anything, so this fails loudly.

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
