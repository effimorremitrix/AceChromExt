# ACE field mapping

> **Status: every selector in this repository is a placeholder.**
> No selector here has been captured from the live ACE portal. The mapping
> *architecture* is complete and tested; the *selectors* are the one thing that
> must be verified against the real DOM before ACE Helper fills reliably.
> Until then, expect "no field on this page matched the mapping" warnings, and
> note that nothing is ever written to a field that was not confidently found.

## How the mapping layer works

A field is data, not code. `src/ace/mappings/commodities.ts`:

```ts
defineField({
  key: 'ValueOfGoods',              // stable logical name, shown in diagnostics
  label: 'Value of Goods',          // human label, shown in the preview
  page: 'commodities',              // which ACE step it lives on
  scope: 'commodityLine',           // reads from a commodity, not the invoice
  source: 'commodity.valueOfGoods', // path into the canonical model
  type: 'number',
  transforms: ['money'],            // named transformers, applied in order
  expected: true,                   // empty -> a warning, not a silent skip
  candidates: [                     // tried in this order
    placeholder('id', '#valueOfGoods'),
    placeholder('name', "input[name='valueOfGoods']"),
    byLabel(['Value of Goods', 'Value', 'Commodity Value']),
    byNearby("[data-section='commodityLine']", "input[name*='value' i]"),
  ],
  devtoolsHint: 'Line Details -> inspect the Value of Goods box...',
});
```

### Selector strategy, in priority order

| # | Strategy | Confidence when verified | Notes |
| --- | --- | --- | --- |
| 1 | `id` / `name` | high | exact, captured from live ACE |
| 2 | `attribute` | high | `data-*`, `aria-label`, `formcontrolname`, ... |
| 3 | `label` | medium | the field's visible label text; survives markup changes |
| 4 | `nearby` | low | first writable control inside a named container |
| 5 | `placeholder` | low | last resort |

Rules the detector enforces (`src/content/fieldDetector.ts`):

- a candidate that matches **several** visible, writable controls is
  `AMBIGUOUS`, and the field is **not** written;
- a match from an **unverified** candidate is degraded one confidence level,
  and a low-confidence write is reported as "confirm this is the right field";
- a candidate matching only disabled/hidden controls reports `NOT_WRITABLE`;
- there are **no positional heuristics** anywhere. "The third textbox on the
  page" is never how a field is found. A test asserts this
  (`tests/aceMapping.test.ts`, "no positional selectors").

## Verifying a field against live ACE

You need an ACE account and a filing open in the portal. Nothing below changes
a filing; you are only reading the DOM.

### 1. Turn on Developer mode

Extension panel -> **Settings** -> **Developer mode**. A **Diagnostics** tab
appears.

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

### 3. Put it in the mapping

Replace the placeholder with a verified candidate, keeping the placeholders
below it as fallbacks:

```ts
candidates: [
  verified('id', '#realIdFromAce', 'captured 2026-03-12 from the Commodities step'),
  placeholder('name', "input[name='valueOfGoods']"),
  byLabel(['Value of Goods']),
],
```

`verificationStatus` is derived automatically: one verified candidate flips the
field from `placeholder` to `verified`.

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

Each field below needs one DOM capture. `devtoolsHint` in the mapping file
repeats this inside the Diagnostics panel, next to the field.

### Step 1: Shipment (`src/ace/mappings/shipment.ts`)

| Field | Capture |
| --- | --- |
| `ShipmentReferenceNumber` | the Shipment Reference Number `<input>` |
| `InvoiceDate` | the export-date control; note whether it is a plain input or a date picker, and whether typed `MM/DD/YYYY` is accepted |
| `PONumber` | the PO / reference `<input>` |
| `Destination` | the destination `<select>` **plus two `<option>` tags** |
| `FreightTerms` | the Terms of Sale / INCO Terms control |

### Step 2: Parties (`src/ace/mappings/parties.ts`)

| Field | Capture |
| --- | --- |
| `UltimateConsigneeName` | the consignee Name `<input>` and its panel container |
| `UltimateConsigneeAddress` | Address Line 1, plus how many address boxes exist and whether city/state/postal are separate |

Party EIN/ID numbers are intentionally not mapped: identity data stays manual.

### Step 3: Commodities (`src/ace/mappings/commodities.ts`)

| Field | Capture |
| --- | --- |
| `ExportInformationCode` | `<select>` + sample `<option>` |
| `ScheduleB` | the `<input>`, **and whether ACE accepts `0802.12.0000` or only 10 digits** (if digits only, switch `transforms` to `['scheduleBDigits']`) |
| `CommodityDescription` | `<input>` or `<textarea>`, and its `maxlength` |
| `Quantity1`, `Quantity2` | the quantity `<input>`s |
| `UOM1`, `UOM2` | `<select>` + two `<option>` tags (codes or descriptions?) |
| `Origin` | the control and its options (`D`/`F` values? `Domestic`/`Foreign` labels?) |
| `ValueOfGoods` | the `<input>`, **and whether whole dollars or dollars-and-cents** (whole dollars -> `transforms: ['integer']`) |
| `ShippingWeight` | the `<input>`, and the unit named in its label |
| `ECCN` | the `<input>` (may appear only for certain licence codes) |
| `LicenseCode` | `<select>` + sample `<option>` |
| *line container* | the element that wraps one open Line Details form -> `src/ace/pages.ts` |

### Step 4: Transportation (`src/ace/mappings/transportation.ts`)

| Field | Capture |
| --- | --- |
| `Carrier` | the carrier control; note whether it is an SCAC autocomplete |
| `Vessel` | the Conveyance Name `<input>` |
| `BookingNumber` | the `<input>` |
| `ContainerNumber`, `SealNumber` | the `<input>`s **and the repeating row container** |

### Page detection (`src/ace/pages.ts`)

For each step, capture:

- the active tab/step element and its text (the detector reads
  `[aria-selected="true"]`, `[aria-current="step"]`, `.active`, ...);
- the main heading text;
- the URL path or hash;
- one marker element that only exists on that step.

## If ACE changes its DOM

1. Open **Diagnostics** on the affected step. Any field that stopped resolving
   shows `NOT_FOUND` (or `AMBIGUOUS`) with every candidate that was tried.
2. Re-capture that element.
3. Add the new selector as the first candidate. Keep the old one below it: a
   stale candidate that matches nothing costs nothing and covers the case where
   ACE reverts.
4. **Copy diagnostics JSON** attaches the whole snapshot to a bug report.

## Autocompletes, date pickers, and custom widgets

Some ACE controls are not plain inputs. Writing a value with
`setAceFieldValue` fires `input` and `change`, which is what most frameworks
listen to, but a component that only commits on a keyboard event or a menu
click may not accept it. The write is verified by reading the value back, so
this shows up as an honest "ACE did not keep the value" rather than a
false success. Such fields stay manual until a component-specific writer is
added - the mapping layer has room for one (`AceFieldType` is the hook), and
it is deliberately not in this version.
