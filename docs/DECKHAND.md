# Deckhand: shipment-document extraction

> **Status:** built, tested against sanitized fixtures, not yet used on a real
> inbox. The rules-based extractor reads the shapes it was written against
> (labelled fields, tables with a header row, "Container: X / Seal: Y" blocks)
> and says "missing" or "not paired" for everything else. That is the intended
> floor for a tool that reads legal identifiers. It has never been shown a real
> carrier's email, and the first three of those will change the rules.

A deckhand is the junior crew member who handles the routine deck work so the
officers can navigate. That is the design intent: **Deckhand does the copying,
the operator keeps the judgment.**

## The problem it answers

Booking references, container numbers and seal numbers arrive by email, from
the carrier or the producer, and somebody retypes them into INTTRA and ACE.
Every time. Deckhand reads them out of the text, shows them beside a mark, and
hands them on as data only after a person has approved them.

## Where it lives

```
deckhand/src/
  model.ts              DeckhandShipment: fields, containers, uncertainties
  iso6346.ts            container number validation (check digit)
  input.ts              what Deckhand accepts, and the reader registry
  readers/eml.ts        a saved email (.eml): the text/plain part, decoded
  extract/labels.ts     "Booking Ref: X", "Vessel: X   Voyage: Y", "Vessel/Voyage: X / Y"
  extract/containers.ts containers and seals, line by line, with the evidence
  extract/assemble.ts   mentions -> containers: merge repeats, detect conflicts
  extract/rulesExtractor.ts  the deterministic extractor
  extractor.ts          input -> reader -> extractor; the seam a model plugs into
  review/reviewModel.ts the review screen as data: rows, marks, approval
  review/format.ts      the review block, container rows as TSV / CSV
  serialize.ts          JSON in and out, defensively
```

Deckhand is a **source adapter**. Nothing under `deckhand/` may import from
`src/content`, `inttra-extension/` or `companion/`, and nothing there touches
a DOM, a socket or `chrome.*`. `tests/invariants.test.ts` and
`tests/independence.test.ts` assert it. Both browser extensions and the
QuickBooks companion import from it; it imports from none of them.

## The four rules

1. **A seal reaches a container only through evidence.** A pairing is built
   only when the document showed the two together: the same table row under a
   header that names the columns (`same_row`), one line of text with exactly
   one container and one labelled seal (`same_line`), or a container line
   followed directly by a seal line (`same_block`). The evidence is part of the
   type. There is no code path that pairs the nth container with the nth seal,
   and a test asserts there is none.
2. **Missing is a value.** A field the document did not carry is
   `{ value: null, confidence: 'unsure' }` and is still printed. Nothing is
   dropped.
3. **Confidence is per field.** `high` means read directly behind an
   unambiguous label or from a table cell under a recognised heading; `low`
   means recognised by shape only, or read from a line carrying several
   candidates; `unsure` means not found. There is no overall score, because a
   rules extractor cannot honestly produce one.
4. **Nothing is corrected.** A container number that fails its ISO 6346 check
   digit is carried exactly as read, marked `invalid`, and blocks approval
   until the person retypes it from the source.

## The model

```ts
interface DeckhandShipment {
  schemaVersion: '1.0';
  bookingReference:  DeckhandField;   // { value: string | null, confidence, evidence? }
  shipmentReference: DeckhandField;
  vessel:            DeckhandField;
  voyage:            DeckhandField;
  portOfLoading:     DeckhandField;
  portOfDischarge:   DeckhandField;
  containers: Array<{
    containerNumber: { raw, normalized, status: 'valid' | 'invalid' | 'malformed', confidence };
    carrierSeal: { raw, confidence, label? } | null;
    shipperSeal: { raw, confidence, label? } | null;
    evidence: 'same_row' | 'same_line' | 'same_block' | null;
    mentions: number;      // > 1 when the document named the container more than once
    sealConflict: boolean; // two different seals claimed; neither used
    lines: number[];       // where in the source
  }>;
  unassignedSeals: SealField[];   // seals shown beside no container; never zipped in
  uncertainties: Uncertainty[];   // typed, with severity; 'error' blocks approval
  source: { kind, name, extractor, extractedAt, textLength };
}
```

A seal labelled "Shipper seal" lands in `shipperSeal`; "Seal", "Seal No",
"Carrier seal" land in `carrierSeal`, because that is what the trade means by
an unqualified seal. The label is kept on the field so the review can show it.

## Inputs

| Input | How |
| --- | --- |
| Pasted text | the panel's Deckhand tab, or `{ kind: 'text', text }` |
| A saved email (`.eml`) | the `text/plain` part is decoded (quoted-printable and base64), the subject line is prepended; a mail with only HTML is read with its tags removed and a note says so |
| A text file (`.txt`, `.md`, `.csv`) | read as UTF-8 |
| PDF | **declared, not available.** The reader says so and asks for the text to be pasted. Bundling a PDF parser would fail the extension's no-dynamic-code bundle check |
| Image / scan | **declared, not available.** OCR needs either a network service or a large bundled model; the extension has no network permission by design |

The reader registry (`DOCUMENT_READERS`) and the extractor registry
(`RulesExtractor`) are the seams. A mailbox adapter is a reader; a
model-based extractor is an extractor. Neither changes the model, the review,
the filing package or the extensions.

## Review and approval

`buildReview(shipment)` turns the model into rows with a mark each:

| Mark | Meaning |
| --- | --- |
| ✓ | read with confidence; for a container number, ISO 6346 valid |
| ? | read, but not with confidence; confirm it against the source |
| ⚠ | missing, failed a check, contradicted, or could not be paired |

Approval (`approveShipment`) is refused while any uncertainty has severity
`error`: a failed check digit, a contradicted seal, a list of containers and a
list of seals that nothing ties together. A missing value never blocks: it is
filled by hand. Nothing flows into a filing package, and from there into a
form, before this approval. The ACE Helper and the INTTRA Helper both render
this review from the same module, and the companion prints the same rows as
text (`ace-export deckhand booking.eml`).

## Outputs

- **The review block**, for reading against the source (`formatBlock`).
- **Container rows** as TSV (`formatTsv`), one row per container, seals only
  where the document paired them, CRLF-separated so a portal grid or Excel
  splits them into rows. Unassigned seals appear in no row.
- **The model as JSON** (`serializeDeckhandShipment`), read back with
  `parseDeckhandShipment`, which recomputes every container's status rather
  than trusting the file.
- **A filing package**, once approved: see `docs/END-TO-END-FLOW.md`.

## What the extractor handles, and what it does not

Handled, with a fixture in `tests/fixtures/deckhand/`:

- `Booking Ref: X`, `Carrier Booking No: X`, `Shipment ID: X`, `Vessel: X   Voyage: Y`,
  `Vessel/Voyage: X / Y`, `POL:` / `Port of loading:`, `POD:` / `Port of discharge:`
- `Container | Seal` tables, with or without a shipper-seal column, delimited
  by `|`, tabs, or runs of spaces
- `MSCU1234566 | Seal No: SL-1` on one line; `Container 3: TGHU7654320` then
  `Seal: SL-9` on the next
- a container named twice (depot list, then prose): one entry, seal kept
- container numbers written with spaces or dashes
- a subject line carrying the booking reference

Not handled, on purpose, and reported as such: several containers on one
line, several seals on one line, containers in one list and seals in another,
a seal with no label (seals have no shape, so an unlabelled token is never
called a seal), a container number that fails its check digit.

Adding a shape means adding a rule in `deckhand/src/extract/` and a fixture
beside it. Never widen a rule so that it pairs by position.

## Verifying it on a real inbox

1. Save three real emails per side (carrier and producer) as `.eml`.
2. `node dist-companion/ace-export.mjs deckhand <file> --dry-run` for each, or
   paste into the Deckhand tab.
3. Read every block against the email. Every ⚠ is either a real gap in the
   email or a shape the extractor does not read yet. Note which.
4. Time one booking with and without it, and write the numbers down.
5. Any seal that is paired wrongly is a bug of the highest severity. Any seal
   reported unpaired that a person could pair is a rule to add.

## Origin

Deckhand was first built inside the retired Tidelane repository
(`effimorremitrix/Yigal`, `worker/deckhand/`), as a page in a hosted
application with a model-based extractor behind an API key. The ISO 6346
validation, the evidence-typed pairing, the duplicate-mention merge and the
seal-conflict rule, the block and TSV outputs, the unit tests and the three
fictional demo emails were migrated here and extended; the hosted worker, the
React page and the model-based extractor were not, because this codebase runs
locally with no network permission. `tests/independence.test.ts` asserts that
nothing here reaches back to that repository.
