# ACE field mapping

> **Status: every selector in this repository is a placeholder.**
> No selector here has been captured from the live ACE portal. The mapping
> *architecture* is complete and tested; the *selectors* are the one thing that
> must be verified against the real DOM before ACE Helper fills reliably.
> Until then, expect "no field on this page matched the mapping" warnings, and
> note that nothing is ever written to a field that was not confidently found.
>
> **You do not need this document to fix a selector.** Since Phase 3 a captured
> selector can be pasted into the panel as JSON and is in force on the next
> fill, with no rebuild and no developer - see
> [Installing a captured selector without a rebuild](#installing-a-captured-selector-without-a-rebuild).
> This document is how you capture it, and how you make it permanent.

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
  label: 'Value of Goods',          // human label, shown in the preview
  page: 'commodities',              // which ACE step it lives on
  scope: 'commodityLine',           // reads from a commodity, not the invoice
  source: 'commodity.valueOfGoods', // path into the canonical model
  type: 'number',
  transforms: ['money'],            // named transformers, applied in order
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
    byLabel(['Value of Goods', 'Value', 'Commodity Value']),
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
field from `placeholder` to `verified`.

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

Each field below needs one DOM capture. `devtoolsHint` in the mapping file
repeats this inside the Diagnostics panel, next to the field.

### Step 1: Shipment (`src/ace/selectors/shipment.ts`)

| Field | Capture |
| --- | --- |
| `ShipmentReferenceNumber` | the Shipment Reference Number `<input>` |
| `InvoiceDate` | the export-date control; note whether it is a plain input or a date picker, and whether typed `MM/DD/YYYY` is accepted |
| `PONumber` | the PO / reference `<input>` |
| `Destination` | the destination `<select>` **plus two `<option>` tags** |
| `FreightTerms` | the Terms of Sale / INCO Terms control |

### Step 2: Parties (`src/ace/selectors/parties.ts`)

| Field | Capture |
| --- | --- |
| `UltimateConsigneeName` | the consignee Name `<input>` and its panel container |
| `UltimateConsigneeAddress` | Address Line 1, plus how many address boxes exist and whether city/state/postal are separate |

Party EIN/ID numbers are intentionally not mapped: identity data stays manual.

### Step 3: Commodities (`src/ace/selectors/commodities.ts`)

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

### Step 4: Transportation (`src/ace/selectors/transportation.ts`)

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

Some ACE controls are not plain inputs. Writing a value with
`setAceFieldValue` fires `input` and `change`, which is what most frameworks
listen to, but a component that only commits on a keyboard event or a menu
click may not accept it. The write is verified by reading the value back, so
this shows up as an honest "ACE did not keep the value" rather than a
false success. Such fields stay manual until a component-specific writer is
added - the mapping layer has room for one (`AceFieldType` is the hook), and
it is deliberately not in this version.
