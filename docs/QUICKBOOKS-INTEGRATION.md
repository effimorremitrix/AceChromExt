# QuickBooks Desktop integration

Phase 2. Turns

> read the QuickBooks invoice on one screen, retype it into ACE on the other

into

> `ace-export export CN-1042` -> review -> import into the extension -> fill.

**Tested status, stated plainly:** every stage below is covered by tests that
run on any machine, against saved qbXML. **The one hop that has not been run
against a real QuickBooks is the COM call itself** - there is no Windows machine
with QuickBooks Desktop in this project's toolchain. [What still needs testing
on the QuickBooks PC](#11-what-still-needs-testing-on-the-quickbooks-pc) says
exactly what to run and what you should see.

---

## 1. Chosen integration method

**The QuickBooks Desktop SDK (qbXML), through the `QBXMLRP2` request
processor, driven locally.**

```
QuickBooks Desktop Pro Plus 2024  (Windows, company file open)
        ^
        |  COM: QBXMLRP2.RequestProcessor
        |  32-bit Windows PowerShell  (companion/powershell/QbxmlRequest.ps1)
        |
   ace-export  (Node, this repository)
        |  InvoiceQueryRq / HostQueryRq  (reads)   companion/src/qbxml/
        |
        |  ^  BillQueryRq -> BillAddRq  (the one write, "bill --write" only;
        |  |  section 6b)                          companion/src/bill/
        v
   QbInvoice                                       companion/src/qbxml/types.ts
        |  adapter + configuration                 companion/src/mapping/
        v
   CANONICAL SHIPMENT MODEL  ..................... src/models/CanonicalInvoice.ts
        |  (the same model the spreadsheet importer produces)
        v
   ACE_Invoice_CN-1042.xlsx                        companion/src/excel/
        |
        v
   ACE Helper extension -> preview -> fill -> you submit
```

## 2. Why, and why not the alternatives

| Option | Verdict |
| --- | --- |
| **SDK / qbXML** | **Chosen.** The only supported route that returns *structured* invoice data, including line items and custom fields, from a local company file with no cloud hop. |
| Web Connector | Rejected. QBWC is built for *hosted* applications: you write a SOAP web service, QuickBooks polls it on a schedule, and data leaves the machine. It would add a web service, a scheduler and an outbound hop to a tool whose entire premise is that shipment data stays local. It also cannot do "export the invoice I am looking at, now". |
| Built-in export / reports | Rejected as the primary route, kept as a fallback. An invoice report exported to Excel loses the custom fields that carry vessel, booking, container and seal, and IIF is a write format. It is still useful in one case: if the SDK cannot be installed, a report can be reshaped into the Phase 1 template by hand - the importer's column aliases already accept several QuickBooks header spellings. |
| UI automation | Rejected. qbXML exposes everything needed except custom fields that were never defined, and no amount of screen-reading conjures a Schedule B number. Automating the QuickBooks UI would be fragile, unsupported, and would not solve the one problem that is actually hard. |

**Why PowerShell in the middle.** `QBXMLRP2.RequestProcessor` is a **32-bit
in-process COM server**. A 64-bit Node process cannot create it. The choices
were a native Node addon (a compiler on every install) or the 32-bit Windows
PowerShell that ships with Windows. The script takes file paths as parameters
and reads the request from a file, so nothing out of a company file is ever
concatenated into a command.

## 3. Prerequisites

On the Windows PC that runs QuickBooks:

| | |
| --- | --- |
| QuickBooks Desktop | Pro Plus 2024 (any Desktop edition from 2019 works) |
| QuickBooks Desktop SDK | 16.0, from the Intuit Developer site. Installs `QBXMLRP2.dll` and registers the COM server. |
| Node.js | 20 or newer |
| PowerShell | The 32-bit one Windows already has: `C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe` |
| Permission | You must be able to sign in to the company file as **Admin**, once, to grant the certificate |

Nothing needs to reach the internet at any point.

## 4. Installation

On a machine with this repository:

```bash
npm install
npm run build:companion      # -> dist-companion/
```

Copy the whole `dist-companion/` folder to the QuickBooks PC. It contains two
files that matter: `ace-export.mjs` (everything bundled, no `npm install` at
the far end) and `QbxmlRequest.ps1` (the COM bridge, which must stay beside it).

```
> node ace-export.mjs --help
> node ace-export.mjs init          # writes ace-export.config.json
```

## 5. Authorization

QuickBooks grants access per application, per company file, and the grant is
stored *inside* the company file.

1. Sign in to QuickBooks as **Admin**, in **single-user mode**, with the
   company file open.
2. Run `node ace-export.mjs probe`.
3. QuickBooks shows an authorization dialog naming `ACE Export Helper` (the
   `appName` from your configuration) and your company file. A signed
   application gets the **Application Certificate** dialog; an unsigned one
   gets **Application permission**, headed *"... without a certificate is
   requesting your permission ..."*. **The companion is unsigned, so the
   second one is what you will see.** It is a local Node program driving the
   COM request processor through an unsigned PowerShell script, so there is
   no publisher for QuickBooks to validate. The warning is about the absent
   signature, not about anything being wrong with the installation.
4. Choose **Yes, whenever my QuickBooks company file is open**.
5. Leave the **personal data** checkbox (Social Security Number, customer
   credit card information) **unchecked**. The companion queries invoice
   headers, lines and custom fields; it asks for neither.
6. On the unsigned dialog, type `yes` in the confirmation box. **Continue
   stays greyed out until you do** - this is the step that strands people.
7. **Continue**, then **Done**.
8. `probe` prints the product name and the qbXML versions on offer.

Afterwards, review or revoke it in QuickBooks under
**Edit > Preferences > Integrated Applications > Company Preferences**.

Notes that save an afternoon:

- The grant is tied to the pair (`appId`, `appName`). Changing `appName` in the
  configuration asks for authorization again.
- **No password is ever asked for, stored or read.** The certificate is the
  whole mechanism; this tool never sees a QuickBooks credential.
- Authorizing needs single-user mode. Everyday use does not.
- The fourth option, **always allow access even when my QuickBooks isn't
  running**, is for an unattended run and also wants a login user set under
  Integrated Applications; the everyday flow does not need it. `--launch` uses
  `localQBDLaunchUI`, which starts QuickBooks with its interface, so it works
  under the "whenever the company file is open" grant.
- Multi-user/hosted files: run the companion on the machine hosting the file.

## 6. How invoices are queried

Requests are built in `companion/src/qbxml/requests.ts` and look like this:

```xml
<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="16.0"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <InvoiceQueryRq requestID="1">
      <RefNumber>CN-1042</RefNumber>
      <IncludeLineItems>true</IncludeLineItems>
      <OwnerID>0</OwnerID>
    </InvoiceQueryRq>
  </QBXMLMsgsRq>
</QBXML>
```

Two details are load-bearing:

- **`<OwnerID>0</OwnerID>` is what makes custom fields appear at all.** Without
  it, QuickBooks returns no `DataExtRet` elements and the vessel, booking,
  container and seal are simply absent. This is the single most common reason
  an integration "cannot see" a field that is plainly printed on the invoice.
- **Element order is part of the schema.** qbXML is validated against a
  sequence, so filters must appear in schema order and `IncludeLineItems` and
  `OwnerID` must come last. The builder enforces this, and refuses combinations
  the schema forbids - a `RefNumber` or `TxnID` lookup is an *alternative* to
  the filters, never an addition to them, and mixing them is rejected before
  the request is sent.

Searching (`ace-export list`) uses `MaxReturned`, `TxnDateRangeFilter`,
`EntityFilter` and `RefNumberFilter`, with `IncludeLineItems` set to false so a
date-range search does not drag every line of every invoice back.

`HostQueryRq` (`ace-export probe`) touches no company data, which makes it the
safe way to test the connection.

## 6b. How a bill is written

`ace-export bill <invoice>` builds the supplier's **Bill** that mirrors a
customer invoice: same goods amount, the invoice's terms and dates, the
invoice number as the bill's Ref. No., and a negative **commission** line so
the bill total is what is actually owed to the vendor. It is the one place the
companion changes the company file, and it is gated three ways: nothing is
sent without `--write`; every write is preceded by three reads that refuse a
duplicate, an unknown vendor or an unknown account; and the request type is
pinned by `tests/invariants.test.ts` so no `Mod`, `Del` or other `Add` can be
added quietly.

The requests, in order, one PowerShell spawn each:

| Step | Request | What it settles |
| --- | --- | --- |
| 1 | `InvoiceQueryRq` | the invoice, with lines |
| 2 | `BillQueryRq` by `RefNumber` | is there already a bill with this number for this vendor? (a refusal). The same number under another vendor is only noted |
| 3 | `VendorQueryRq` by `FullName` | the vendor exists and is active |
| 4 | `AccountQueryRq` by `FullName` | every account on the bill exists and is active |
| 5 | `BillAddRq` | only with `--write`, only when 2 to 4 passed |

The bill is built from the invoice and the `bill` block of the configuration
(section 9) by `companion/src/bill/billPlan.ts`, which is pure and refuses
rather than guesses: an item with no vendor rule, lines that name two vendors,
a pending invoice, an invoice with no number or no terms, lines that do not
add up to the invoice subtotal, all stop it before step 2. The request looks
like this:

```xml
<BillAddRq requestID="1">
  <BillAdd>
    <VendorRef><FullName>Blue Diamond Growers</FullName></VendorRef>
    <TxnDate>2026-09-21</TxnDate>
    <DueDate>2027-01-19</DueDate>
    <RefNumber>CN-1042</RefNumber>
    <TermsRef><FullName>Net 120</FullName></TermsRef>
    <ExpenseLineAdd>
      <AccountRef><FullName>Cost of Goods Sold:Almonds</FullName></AccountRef>
      <Amount>651217.60</Amount>
      <Memo>176000 Almond Kernels, Monterey SSR 23/25, new crop, 50 lb cartons to Aydin</Memo>
    </ExpenseLineAdd>
    <ExpenseLineAdd>
      <AccountRef><FullName>Commissions Income</FullName></AccountRef>
      <Amount>-13024.35</Amount>
      <Memo>Commission 2% on invoice CN-1042</Memo>
    </ExpenseLineAdd>
  </BillAdd>
</BillAddRq>
```

**The commission is rounded once, on the goods subtotal**, in integer cents,
exactly as a person with a calculator does it: 651,217.60 x 2% = 13,024.352
-> 13,024.35, posted as -13,024.35, bill total 638,193.25. The rate is fixed
at six decimals so the product is an exact integer and `Math.round` never
sees a 0.4999... (`commissionCents` in `billPlan.ts`).

**Two schema facts are not yet confirmed on a live QuickBooks** and are what
section 11 step f exists to confirm: that the SDK accepts a negative `Amount`
on an `ExpenseLineAdd` as the Enter Bills window does, and the exact position
of `Memo` in the `BillAdd` sequence. If QuickBooks rejects the negative line,
record its status and message there and stop: the sign of the commission is a
decision to revisit, not something to patch around.

`DueDate` is copied from the invoice when it has one; left out, QuickBooks
derives it from the terms. With `tagLinesWithCustomer` the goods lines also
carry the invoice's customer as `CustomerRef` (`NotBillable`), which is how
QuickBooks' job reports tie the purchase to the sale.

## 7. Fields supported

Four categories, and the preview labels every value with which one it is.

### Direct QuickBooks fields

Present on every invoice, no configuration needed.

| Canonical field | qbXML source |
| --- | --- |
| `invoiceNumber` | `InvoiceRet/RefNumber` |
| `invoiceDate` | `InvoiceRet/TxnDate` |
| `customerName` | `InvoiceRet/CustomerRef/FullName` |
| `billTo` | `InvoiceRet/BillAddress/Addr1` (the printed `BillAddressBlock` only when the address has no structured parts) |
| `billToAddress2` | `InvoiceRet/BillAddress/Addr2` (Addr2-Addr5, joined) |
| `billToCity`, `billToState`, `billToPostalCode`, `billToCountry` | `InvoiceRet/BillAddress/City`, `/State`, `/PostalCode`, `/Country` |
| `poNumber` | `InvoiceRet/PONumber` |
| `freightTerms` | `InvoiceRet/FOB` - the built-in field, which is where "FOB dock" already lives |
| `paymentTerms` | `InvoiceRet/TermsRef/FullName` |
| `paymentDueDate` | `InvoiceRet/DueDate` |
| `carrier` | `InvoiceRet/ShipMethodRef/FullName` |
| `destination` | `InvoiceRet/ShipAddress/Country` |
| `description` | `InvoiceLineRet/Desc`, falling back to the item's full name |
| `valueOfGoods` | `InvoiceLineRet/Amount` |

### Custom fields

Configured by name in `customFields`. Defaults cover the usual spellings:

| Canonical field | Typical custom field |
| --- | --- |
| `vessel` | Vessel |
| `bookingNumber` | Booking |
| `containerNumber` | Container |
| `sealNumber` | Seal |
| `destination` | Destination |
| `freightTerms` | Freight Terms |

### Derived fields

Computed from QuickBooks values, and always shown with the arrow:

| Canonical field | How |
| --- | --- |
| `shippingWeight` | The line quantity converted to kilograms: `176000 lb x 0.45359237 = 79832.25712` -> **79,832 kg**. The original pounds are kept for the audit trail. |
| `quantity1` | The shipping weight expressed in the item's ACE unit (`aceUom1`), or the QuickBooks quantity when `quantity1From` is `quantity`. |
| `valueOfGoods` | `Quantity x Rate`, only when the line carries no `Amount`. |

### Manually supplied fields

**No accounting system holds these, and nothing here invents them.**

| Canonical field | Where it comes from |
| --- | --- |
| `scheduleB` | `items."<item>".scheduleB` |
| `origin` | `items."<item>".origin` (D or F) |
| `licenseCode` | `items."<item>".licenseCode` |
| `eccn` | `items."<item>".eccn` |
| `exportInformationCode` | `items."<item>".exportInformationCode` |
| anything else | `manual` in the configuration, `--set field=value`, or the form |

A missing Schedule B produces a blank Schedule B, a red mark in the preview and
a validation error. It never produces a guess.

## 8. Custom fields, and what QuickBooks will and will not give you

This is the part that surprises people, so it is worth being exact.

**A field printed on an invoice is not automatically available to qbXML.**
What is available is what QuickBooks stores as a *custom field* (`DataExt`).

**What works:**

- Custom fields defined on a **name list** (Customer:Job, Vendor, Employee) and
  added to the invoice template. The value defaults from the customer record but
  is editable per invoice, and the per-invoice value comes back as a
  `DataExtRet` on `InvoiceRet` when the query asks for `OwnerID` 0.
- Custom fields defined on an **item** and added to the template's columns.
  Those come back as `DataExtRet` on `InvoiceLineRet` - map them with
  `itemCustomFields`.
- The built-in free-text fields `InvoiceRet/Other` (header) and
  `InvoiceLineRet/Other1` / `Other2` (line). Map them with `otherFields`.
  They are ordinary elements, not custom fields, and need no `OwnerID`.

**What does not work:**

- Text typed directly onto a **template layout** (a label, a static block of
  text, a field that exists only in the print layout) is not transaction data
  and is not returned by any query.
- A custom field that was defined but never added to the invoice template will
  have no value on the transaction.
- QuickBooks Desktop Pro caps how many custom fields a file may define. The
  **Define Fields** dialog tells you when you have reached it; if you have, the
  remaining values are better supplied through `manual`, `--set`, or the form
  than by rearranging the company file.

**Find out what your file actually returns** rather than guessing:

```
> node ace-export.mjs fields CN-1042

Custom fields QuickBooks returned:
  Vessel     ->  vessel
  Booking    ->  bookingNumber
  Container  ->  containerNumber
  Seal       ->  sealNumber
  Broker     (not mapped)
```

Then map the ones you want in `ace-export.config.json`:

```json
{
  "customFields": { "Vessel": "vessel", "Booking No": "bookingNumber" },
  "itemCustomFields": { "Schedule B": "scheduleB" },
  "otherFields": { "Other": "bookingNumber" }
}
```

If a value cannot be reached at all, supply it per export:

```
> node ace-export.mjs export CN-1042 --set vessel="MSC FIRENZE V.541W" --set sealNumber=SL-99401
```

## 9. Configuration

`ace-export init` writes a starter file. The whole schema:

```jsonc
{
  "qbxmlVersion": "16.0",          // must be one QuickBooks offers; probe prints the list
  "appId": "",                     // optional; the certificate is granted to appId + appName
  "appName": "ACE Export Helper",  // shown in the authorization prompt - changing it re-prompts
  "companyFile": "",               // empty = whatever file is open in QuickBooks

  "customFields": { "Vessel": "vessel" },        // DataExt name -> canonical invoice field
  "otherFields": { "Other": "bookingNumber" },   // Other / Other1 / Other2 -> canonical field
  "itemCustomFields": { "Schedule B": "scheduleB" },  // line DataExt -> commodity field

  "items": {
    "Shelled Almonds": {
      "scheduleB": "0802.12.0000",
      "origin": "D",                 // D domestic, F foreign
      "licenseCode": "C33",
      "eccn": "EAR99",
      "exportInformationCode": "OS",
      "quantityUom": "lb",           // unit of the QuickBooks quantity, when the line does not say
      "aceUom1": "KG",               // the unit ACE reports this Schedule B number in
      "quantity1From": "weight",     // "weight" or "quantity"
      "unitWeight": 25,              // for items sold by the case: weight of one unit...
      "unitWeightUom": "lb"          // ...in this unit
    }
  },

  "itemDefaults":    { "quantity1From": "weight", "aceUom1": "KG" },
  "invoiceDefaults": { "carrier": "MSC Line" },   // used only when nothing else supplies it
  "manual":          { "vessel": "" },            // wins over every QuickBooks value

  "output": {
    "directory": ".",
    "fileNamePattern": "ACE_Invoice_{refNumber}.xlsx",  // {refNumber} {txnId} {date} {customer}
    "weightUom": "kg",               // "kg" writes the converted weight, "lb" the QuickBooks pounds
    "includeAuditSheet": true
  },

  "bill": {                                        // for "ace-export bill", section 6b / 10c
    "items": {                                     // item FullName -> who it is bought from, where it posts
      "Shelled Almonds": { "vendor": "Blue Diamond Growers", "account": "Cost of Goods Sold:Almonds" },
      "Dried Fruit": { "vendor": "Blue Diamond Growers" },          // vendor for every child...
      "Dried Fruit:Dried Prunes": { "account": "Cost of Goods Sold:Prunes" }  // ...account per child
    },
    "vendors": {
      "Blue Diamond Growers": {
        "commission": { "account": "Commissions Income", "rate": 0.02 }   // 0.02 = 2%, posted negative
      }
    },
    "customers": { "Aydin Kuruyemis San Ve Tic A.S": { "shortName": "Aydin" } },  // for memos
    "memoTemplate": "{quantity} {description} to {customerShortName}",   // each goods line
    "commissionMemoTemplate": "Commission {ratePercent}% on invoice {refNumber}",
    "billMemoTemplate": "",                        // bill header memo; empty writes none
    "tagLinesWithCustomer": false,                 // CustomerRef (NotBillable) on each goods line
    "excelFileNamePattern": "Bill_{refNumber}.xlsx" // "bill --excel"
  }
}
```

Item names are hierarchical, and so are profiles: a profile on `Dried Fruit`
applies to `Dried Fruit:Dried Prunes` unless the child has its own.

The `bill.items` rules are hierarchical too, but **per field**: the vendor
may sit on `Dried Fruit` and the account on `Dried Fruit:Dried Prunes`, and
each resolves to the nearest name that sets it (`billRuleForItem`). A vendor
with no `commission` gets a bill of goods lines only, and the preview says
so. Memo placeholders: `{quantity}`, `{description}`, `{item}`,
`{unitOfMeasure}`, `{customerName}`, `{customerShortName}`, `{refNumber}`,
`{rate}`, `{ratePercent}`; an unknown one is a configuration error, not a
memo that reads "{custmer}".

**Precedence**, highest first: `--set` / the form, then `manual`, then a custom
field, then `Other`, then the built-in qbXML field, then `invoiceDefaults`.
The preview shows which one won, for every field.

## 10. Exporting to ACE Excel

```
> node ace-export.mjs list --contains CN- --limit 10
> node ace-export.mjs show CN-1042              # preview only, writes nothing
> node ace-export.mjs export CN-1042
```

or the window:

```
> node ace-export.mjs gui
ACE Export Helper is running locally.

  http://127.0.0.1:51734/?t=8f1c...

Only this machine can reach it. Press Ctrl+C to stop.
```

Either way you get the same review gate before anything is written:

```
Ready to export?
  v Invoice number         CN-1042
  v Customer               Aydin Kuruyemis San Ve Tic A.S
  v Invoice date           2026-09-21
  v Commodity description  1/1 line(s) described
  v Amount                 651,217.60 total
  v Weight                 79,832 kg total

  0 errors, 1 warning(s).
```

and, when the customs facts are not configured, exactly the warnings the job
needs:

```
  ! Schedule B missing    line(s) 1
  ! Origin not set        line(s) 1
  ! License Code not set  line(s) 1
```

The workbook is the Phase 1 import template:

| Sheet | What |
| --- | --- |
| **Shipment** | The import sheet. One row per ACE commodity line, shipment columns on the first row. This is the sheet the extension reads. |
| **Audit** | Every field, its origin, the QuickBooks element, the original value, the transformation, and what was written. |
| **Checks** | The validation result at the moment of export. |

Then, in Chrome: open the ACE Helper panel, **Import**, choose the file, review
the preview, and fill. As always the extension never saves a line, submits, or
certifies - [docs/USER-GUIDE.md](USER-GUIDE.md).

Exit codes: `0` clean, `1` the export found validation errors (the workbook is
still written, so it can be corrected in Excel), `2` the command line was wrong.

## 10b. Correcting the ACE-only fields before export

Schedule B, origin and licence code are customs facts. No accounting system
holds them, so there are exactly three places they can come from, and the
export screen shows which:

| Source | When to use it |
| --- | --- |
| `items` in the configuration | the normal case - the fact is about the item and is true every time |
| a QuickBooks line custom field (`itemCustomFields`) | your company already keeps it in QuickBooks |
| supplied at export time | you need to ship today and the configuration is not up to date |

The **ACE readiness** panel in `ace-export gui` lists every line and marks each
fact:

```
Line 1: Almond Kernels, Monterey SSR 23/25              needs attention
  ✓ Schedule B         0802.12.0000
  ✓ Origin             D
  ⚠ License Code       missing
  ✓ Quantity 1         79,832
  ✓ Value of Goods     651,217.60
  ✓ Shipping Weight    79,832 kg
```

The customs facts have a box under them. Type the value, press **Apply and
preview**, and the line goes green. On the command line the same thing is:

```bash
node ace-export.mjs export CN-1042 --set-line 1.licenseCode=C33
```

Either way the value applies to **this export only** and is recorded in the
audit trail as `supplied for this export`, not as something QuickBooks said.
Put it in `items` when you want it to be permanent.

**Quantity 1, the value and the shipping weight have no box, and `--set-line`
refuses them.** They are what the invoice line *is*. An ACE filing that
disagrees with its own invoice is a worse problem than one that is late, so the
only way to change them is to change the invoice. `uom1` is refused for a
narrower reason: Quantity 1 and UOM 1 are derived together from the weight, so
changing the unit alone would make ACE report 79,832 *pounds*. The unit belongs
in the item profile's `aceUom1`, where the quantity is derived to match it.

## 10c. Creating the vendor bill

```
> node ace-export.mjs bill CN-1042
Bill from invoice CN-1042 (TxnID 2AB4-1758412800)
  Vendor      Blue Diamond Growers            [bill.items."Shelled Almonds".vendor]
  Date        2026-09-21                      [invoice date]
  Due         2027-01-19                      [invoice due date]
  Terms       Net 120                         [invoice terms]
  Ref number  CN-1042                         [invoice number]
  Customer    Aydin Kuruyemis San Ve Tic A.S (Aydin)  [invoice customer]

  #  Account                     Amount      Memo
  1  Cost of Goods Sold:Almonds  651,217.60  176000 Almond Kernels, Monterey SSR 23/25, new crop, 50 lb cartons to Aydin
  C  Commissions Income          -13,024.35  Commission 2% on invoice CN-1042
     Goods subtotal              651,217.60
     Commission 2%               -13,024.35  [bill.vendors."Blue Diamond Growers".commission]
     Bill total                  638,193.25

Checks
  v no bill numbered CN-1042 for Blue Diamond Growers
  v vendor "Blue Diamond Growers" is in the company file
  v account "Cost of Goods Sold:Almonds" exists: (CostOfGoodsSold)
  v account "Commissions Income" exists: (Income)

Preview only: nothing was written to QuickBooks. Re-run with --write to add this bill.
```

`--write` sends the `BillAddRq` after the same checks and prints the TxnID
QuickBooks assigned. `--excel` also writes `Bill_CN-1042.xlsx`: an **Invoice**
sheet (the lines and totals as QuickBooks returned them), a **Bill** sheet
where the goods subtotal, the commission (`=-ROUND(subtotal*rate,2)`) and the
bill total are live formulas beside the values the companion computed, plus a
tie-out row (`goods = invoice subtotal`), and a **Checks** sheet. Run with
`--write --excel` the file also records the TxnID. The local window has the
same three buttons: **Preview bill**, **Write bill to QuickBooks** (enabled
only after a preview whose checks passed, and it asks first), **Save
calculation (.xlsx)**.

Exit codes: `0` previewed with every check passing, or written; `1` a rule
refused the bill, a check failed, or `--write` was combined with
`--from-file` (a saved response cannot answer four request types, so a replay
stops at the duplicate check with "no `<BillQueryRs>`"; that is expected).

What stops it, and the fix: no `bill.items` rule for an item (add one, on the
item or a parent); lines that resolve to two vendors (split the invoice);
a pending invoice, or one with no number or no terms (fix the invoice); lines
that do not add up to the invoice subtotal (a discount or subtotal line the
rules do not cover); a bill already numbered like this for the vendor (it
was done); a vendor or account QuickBooks does not have, or has made inactive
(spelling, including the parent account).

## 11. What still needs testing on the QuickBooks PC

Everything from `QbInvoice` onwards is covered by tests against saved qbXML
(`tests/qbxml.test.ts`, `tests/qbMapping.test.ts`, `tests/qbExport.test.ts`,
`tests/qbCompanion.test.ts`). **The COM hop is not**, because it needs Windows,
QuickBooks and a granted certificate. Run this on the QuickBooks PC:

**a. The bridge answers at all.**

```
> node ace-export.mjs probe
Connected: QuickBooks Desktop Pro Plus 2024 (US)
  product: QuickBooks Desktop Pro Plus 2024
  qbXML versions: 13.0, 14.0, 15.0, 16.0
```

If `qbXML versions` does not include the one you asked for, set
`qbxmlVersion` to one that is listed.

**b. Confirm the values against the invoice on screen.** Open the same invoice
in QuickBooks, run `ace-export show <number>`, and check every "QuickBooks" and
"custom field" row against what is printed. The two worth staring at:

- **`FOB`** - does your file really keep the freight terms there? On some
  templates it holds something else, in which case map a custom field instead.
- **The line quantity's unit.** The export assumes the quantity is in pounds
  when the line says so or when `quantityUom` says so. If your file sells by
  the carton, set `unitWeight`, and check the resulting kilograms by hand once.

**c. Custom fields.** `ace-export fields <number>` should list the vessel,
booking, container and seal. If it lists nothing, the fields are not defined as
custom fields in the company file - section 8.

**d. Capture a response for the record.** Once it works, save a real response
and keep it: `--from-file` replays it, so mapping problems can be reproduced
later without QuickBooks. Remove customer details first if it is going to leave
the machine.

**e. The round trip.** Export, import the workbook into the extension, and
check the preview shows the same numbers. (Filling ACE itself is still blocked
by Phase 1's placeholder selectors - [docs/ACE-MAPPING.md](ACE-MAPPING.md).)

**f. The bill write.** This is the companion's only write, and it has never
run against a real QuickBooks either. In order, on a **backup or a copy of the
company file** first (File > Back Up Company):

1. `probe`, as in step a.
2. `bill <number>` for an invoice whose item has a `bill.items` rule: every
   check must show a tick. If the vendor or account check fails, fix the
   spelling in the configuration until it passes; nothing has been sent.
3. `bill <number> --write --excel`. Expect `Added bill: TxnID ...` and a
   `Bill_<number>.xlsx` beside it.
4. In QuickBooks, Vendors > Vendor Center > the vendor > the bill. Confirm the
   vendor, date, terms, Ref. No., every expense line and memo, **that the
   negative commission line was accepted**, and that the Amount Due equals the
   preview's bill total. If QuickBooks rejected the negative line (the
   companion prints its status and message), record them here, in section
   6b, and stop: the sign rule is a decision to revisit.
5. `bill <number> --write` again: it must refuse as a duplicate, sending no
   `BillAddRq`. The `Bill_<number>.xlsx` from step 3 is the record of what was
   posted.
6. Misspell one account in the configuration and run `bill <number>` without
   `--write`: the account check must fail before anything is sent.
7. Save the `BillAddRs` and a `BillQueryRs` as fixtures (strip customer data)
   and replace the hand-written ones in `tests/fixtures/qbxml/`.

Until step 4 has been done, the negative commission line is a schema
assumption, and CLAUDE.md's "Current state" says so.

## 12. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `QuickBooks SDK not reachable: QBXMLRP2.RequestProcessor could not be created` | Either the SDK is not installed, or you are on 64-bit PowerShell. The request processor is 32-bit; the companion picks `C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe` when it exists. |
| `The application certificate has not been granted` | Sign in as Admin in single-user mode and answer the prompt - section 5. |
| **Continue** is greyed out on the permission dialog | The unsigned dialog wants the word `yes` typed into its confirmation box first - section 5. |
| `QuickBooks denied access to this application` | Edit > Preferences > Integrated Applications > Company Preferences, allow it, re-run. |
| `No company file is open` | Open the file in QuickBooks, or set `companyFile`, or pass `--launch` to let QuickBooks start itself. |
| `2 invoices are numbered "CN-1042"` | QuickBooks does not enforce unique invoice numbers. The message lists the TxnIDs; re-run with `txn:<id>`. |
| `No invoice numbered "..."` | Check the number, or search: `ace-export list --contains 104`. |
| No custom fields in the output | The query must ask for `OwnerID` 0 (it does by default - do not set `ownerIds` to `[]`), and the fields must be defined in the company file. Run `ace-export fields`. |
| `does not list qbXML 16.0` | Set `qbxmlVersion` to a version `probe` reports. 13.0 is a safe floor for anything from 2019. |
| Weight is blank | The line quantity is not in a weight unit and the item has no `unitWeight`. Section 9. |
| Schedule B / origin / licence blank | They are not in QuickBooks. Put them in `items`, once per item. |
| `Destination "DERINCE" is not a two-letter ISO country code` | The custom field holds a port, not a country. ACE wants the country of ultimate destination: `--set destination=TR`, or point `destination` at `ShipAddress/Country`. |
| `"..." already exists` | A workbook for that invoice is already there. `--force` replaces it. |
| `No bill was built from this invoice: ... No vendor for item "..."` | Add `bill.items."<item>".vendor` (and `.account`), on the item or a parent - section 9. |
| `Lines name 2 vendors (...)` | One bill has one vendor. Split the invoice, or fix the item rules. |
| `a bill numbered CN-1042 already exists for ...` | It was done. `bill` never writes the same number twice for one vendor; find it in Vendor Center. |
| `vendor "..." is not in the company file` / `account "..." is not in the chart of accounts` | Spelling, including the parent account (`Cost of Goods Sold:Almonds`). Nothing was sent. |
| `QuickBooks did not accept the bill (status 3140 ...)` | QuickBooks rejected the `BillAddRq` after the checks passed; its message names the element. Section 11 step f, especially for a negative amount. |
| `--write needs QuickBooks; --from-file replays a saved response` | A bill can only be written to a running QuickBooks. Drop one flag or the other. |
| The window will not open | `--port` may be taken; omit it and one is chosen. The URL must include the `?t=` token the command printed. |

## 13. Security

Restating what [docs/SECURITY.md](SECURITY.md) says, for this component:

- **No network egress.** The companion makes no outbound connection of any
  kind. Its only listener is the optional window, bound to `127.0.0.1`, gated
  by a per-run token, serving a page whose CSP is `default-src 'none'`.
- **No credentials.** QuickBooks authorization is the certificate mechanism.
  No password is read, stored or transmitted.
- **Nothing lingers.** Request and response travel through a private temporary
  directory created per request and deleted in a `finally`.
- **Nothing is invented.** Missing customs data stays missing, and is flagged.
- **One write, gated.** `bill --write` sends a single `BillAddRq`, after three
  reads that refuse a duplicate, an unknown vendor or an unknown account, and
  never without the flag. No `Mod`, `Del` or other `Add` exists in the code;
  `tests/invariants.test.ts` pins the list.
