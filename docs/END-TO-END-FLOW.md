# End-to-end flow: QuickBooks + email -> one package -> ACE and INTTRA

```
        INPUTS                                  DESTINATIONS

  QuickBooks Desktop ──▶ companion ──▶ CanonicalShipment ─┐
                          (ace-export)                     │
                                                           ├──▶ FilingPackage ──▶ filing-package.json
  Email / document ────▶ Deckhand ───▶ DeckhandShipment ───┘         │
                                        (reviewed, approved)         ├──▶ ACE Helper   ──▶ ACE (you submit)
                                                                     └──▶ INTTRA Helper ─▶ INTTRA (you submit)
```

Everything is a local file or a browser tab on the operator's machine. No
server, no network permission, no credential anywhere in the chain.

## The three workflows that must keep working on their own

These existed before the package and do not depend on it. Tests assert each.

| Workflow | Path |
| --- | --- |
| **ACE from Excel** | template `.xlsx` -> ACE Helper Import -> Preview -> Fill Current Page / Fill Current Commodity Line |
| **ACE calculator** | F2 beside a numeric ACE field -> expression -> Enter -> only the result is inserted |
| **ACE from QuickBooks** | `ace-export export CN-1042` -> `ACE_Invoice_CN-1042.xlsx` -> ACE Helper Import -> Fill |

## The workflows the package adds

| Workflow | Path |
| --- | --- |
| **Deckhand** | paste the email (or load `.eml`/`.txt`) -> Extract -> review -> Approve -> `DeckhandShipment` |
| **Combined** | QuickBooks/Excel invoice + approved Deckhand extraction -> `buildFilingPackage` -> `FilingPackage` |
| **INTTRA** | `filing-package.json` -> INTTRA Helper Import -> Package (resolve conflicts) -> Fill Current Page |
| **Containers** | the same package -> Copy Container Details -> Fill Container Grid, or Copy rows (TSV) and paste |
| **ACE from the package** | `filing-package.json` -> ACE Helper Import -> the same preview, checks and fill, with booking, vessel, container and seal from the approved extraction |

## Three ways to make the package

**A. On the QuickBooks PC, from the command line.**

```
node ace-export.mjs package CN-1042 --deckhand booking.eml
```

Prints the invoice preview, the Deckhand review block, the merged package
with each value's source and any conflict, and writes
`filing-package-CN-1042_EBKG18531408.json` beside the workbook. The Deckhand
half is written as *pending review*: the Approve click happens in the
extension, in front of the form.

**B. In the ACE Helper panel.** Import the workbook (or `ace-export`'s
workbook), paste the email in **Deckhand**, approve, then **Package -> Build
filing package**. Save it as `filing-package.json` for the INTTRA Helper, or
**Apply to the ACE fields** to fill ACE from it.

**C. In the INTTRA Helper panel, Deckhand only.** Paste the email, approve,
build. The package then holds the transport identifiers and nothing
commercial: cargo, weights and the consignee are typed in INTTRA by hand.
Loading a package made in A or B is the normal case.

**D. In the operator dashboard.** Import the workbook from A (or the package
from A, B or C), paste the email, approve, build, resolve, and download
`filing-package.json`. The same builder, the same file; the dashboard adds
the readiness and provenance screens and holds several shipments side by
side. `docs/WEB-DASHBOARD.md`.

## The package, in one screen

```
Filing package CN-1042_EBKG18531408          QuickBooks export, Deckhand approved

Booking reference    EBKG18531408      Deckhand, confirmed by QuickBooks
Vessel               MSC FIRENZE       Deckhand, confirmed by QuickBooks
Voyage               541W              Deckhand
Port of loading      Los Angeles, CA   Deckhand
Port of discharge    Derince           Deckhand
Carrier              MSC Line          QuickBooks
Consignee            Aydin Kuruyemis   QuickBooks
Total weight (kg)    79832             Derived, sum of 1 line weight(s)

Containers (3)
 1. MSCU1234566   carrier seal SL-4471209   shipper seal SH-001    Deckhand, line 8
    cargo         Almond Kernels ...                              QuickBooks
    HS code       0802.12                                         Derived, first six digits of the Schedule B number
    gross weight  (missing: the invoice weight is a total across 3 containers)
    package type  (missing: not held by any source; enter it)
 2. MSDU7654322   carrier seal SL-4471210
 3. TGHU7654320   carrier seal SL-9

Notes
  The invoice weight (79,832 kg) is a total; it was not split across the 3 containers.
```

### How the two halves are merged

| Rule | Behaviour |
| --- | --- |
| Ownership | commercial data owns invoice, customer, cargo, quantities, weights, descriptions, PO, terms, carrier; Deckhand owns booking, shipment reference, containers, seals, vessel, voyage, ports |
| Agreement | when both carry the same identifier, the owner's value is used and marked `confirmedBy` the other |
| Disagreement | a `Conflict` with both values; the owner's value is followed until the operator picks a side; a material conflict (booking, vessel, containers, seal) blocks filling |
| A placeholder | a commercial container field that is not a container number ("See Ocean B/L") is noted and set aside, not raised as a conflict |
| Missing | `source: 'missing'` with the reason; never inferred, never zero |
| Cargo per container | attributed only when it needs no guess: one invoice line, or one container. Several lines across several containers are left to the operator |
| Weight per container | the invoice total for a single container; otherwise missing, with a note |
| Manual values | recorded as `source: 'manual'`, kept in `decisions`, applied on every rebuild |
| Approval | the Deckhand half is `pending` until approved; filling is blocked until then |

The merged values are **derived** from the two halves and the operator's
decisions. `filing-package.json` carries all three, and reading the file
rebuilds the merge; a hand-edited merged value in the file is ignored. Every
value carries a `Provenanced` record: source, detail, original, transform,
Deckhand confidence, confirming source.

## Provenance, end to end

| Value | Source | Detail |
| --- | --- | --- |
| Booking `EBKG18531408` | Deckhand | `"Carrier Booking No" on line 3`, confirmed by QuickBooks |
| Weight `79832` | QuickBooks | original `176000 lb`, transform `lb x 0.45359237` |
| Container `MSCU1234566` | Deckhand | `line 8, 13`, ISO 6346 valid, confirmed by QuickBooks |
| Description `Almond Kernels ...` | QuickBooks | `InvoiceRet/InvoiceLineRet/Desc` |
| HS code `0802.12` | Derived | first six digits of Schedule B `0802.12.0000` |
| Package type `CT` | Manual | typed by the operator |

The ACE Helper's mapping status screen and the INTTRA Helper's fill reports
both show it.

## Human review points

1. **Deckhand review** before an extraction is approved (either panel, or the
   printed block from the companion).
2. **Package review** before filling: conflicts resolved, missing values seen.
3. **The form**, after filling and before saving: every field, in ACE or
   INTTRA.
4. **Submission**, always by the operator.

## The hosted UI

The package is the contract, and the operator dashboard (`web/`) is the
hosted UI built on it: it takes the companion's workbook or package and the
email, runs the same `buildFilingPackage`, and hands `filing-package.json` to
the extensions as a downloaded file. It changed nothing in `deckhand/`,
`shared/`, or either extension, and it is hosted as static files only: the
page runs in the browser and sends nothing anywhere.

The extensions' `WebSource` stays declared and unavailable. A channel from
the dashboard straight into an extension would mean giving an extension a
network permission or an `externally_connectable` entry, and that remains a
decision about the security posture of the whole tool rather than a code
change. When it is made, it replaces the download-and-import step and
nothing else; see `docs/WEB-DASHBOARD.md` section 4.

## Tests

`tests/web/workflow.test.ts` runs the qbXML fixture through the companion
into its workbook, imports that in the dashboard, extracts the sanitized
booking email, approves, builds, writes `filing-package.json`, re-imports it
and asserts every canonical value is unchanged; then writes the ACE workbook
and reads it back through the ACE Helper's reader with the same assertion.

`tests/filingPackageEndToEnd.test.ts` runs the whole chain with nothing
stubbed: the qbXML fixture through the real adapter, the sanitized booking
confirmation through the real extractor, the package written to disk and read
back, then the ACE Commodities and Transportation fixtures and the INTTRA
General Details and container-grid fixtures filled from it. The ACE
Transportation and INTTRA ids are placeholders, so what it proves is that one
package feeds both fill paths correctly, not that the live selectors are
right.
