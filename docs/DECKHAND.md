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

### Whose seal is it?

Only an explicit word decides it:

| The document says | Lands in |
| --- | --- |
| "Shipper seal" | `shipperSeal` |
| "Carrier seal", "Line seal", "Customs seal" | `carrierSeal` |
| "Seal", "Seal No", "SEAL#", an unheaded second column | `shipperSeal` |

**An unattributed seal is the shipper's.** The operator running Deckhand *is*
the shipper: a bare "SEAL#" column on their own loading list holds the seals
their own office applied when it stuffed the boxes. This was corrected on
2026-09-16 after a real loading list came back with its seals filed as the
carrier's; before that, an unqualified seal was read as the carrier's.

It matters because the two do not share a destination. INTTRA's container grid
has a **Carrier Seal #** column and a **Shipper Seal #** column, so the choice
decides which box on a real filing the number is typed into. Nothing is ever
promoted across: a row with one seal leaves the other cell empty, because a
blank cell is fixed in seconds and a wrong seal is not fixed at all.

**The known cost.** A carrier's own email listing seals under a bare "Seal"
heading now reads as shipper seals. Nothing in the text distinguishes that
document from the operator's own list, and inferring it from the sender would
be exactly the kind of guess this module refuses to make about pairings. So
the assumption is recorded instead: the field's label carries
"unattributed, read as a shipper seal", the review screen shows it, and the
operator can move it. If carrier-authored seal lists become common, this is
the decision to revisit first.

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

## Pasting a table, and the seals that went missing

The first real paste from a carrier email was a "DOC CUT" sheet:
`GALCO | Container # | LOT#: | SEAL# | BOOKING# | VERITY`, ten rows. Ten
containers came out of it and not one seal.

The extractor was not at fault. Hand it that sheet with its rows intact and it
returns every container beside its own seal, whether the cells are separated by
tabs, by `|`, or by runs of spaces, and whether or not the mail header sits
above it. The paste was at fault.

A `<textarea>` takes the `text/plain` flavour of a paste. For an HTML table,
that flavour is the mail client's own flattening of it: one cell per line in
some clients, single spaces in others. The `text/html` flavour, which holds the
real `<table>` with real `<tr>` and `<td>`, is discarded by the browser before
anything here sees it. Once the rows are gone, so is the only evidence that
pairs a seal with a container, and the rule that a seal reaches a container
only through the row they share then correctly yields nothing. The containers
still come out, by shape; the seals cannot.

`src/ui/htmlTable.ts` takes the `text/html` flavour on paste, cuts the real
table up by its own rows and cells, and writes it into the box as tab separated
rows. It lives in `src/ui/` and not in `deckhand/` because it needs the DOM,
and `deckhand/` is pure by invariant. It pairs nothing: it only stops the rows
being destroyed, and the existing rules do the rest. The text goes into the
visible box, so what is read and checked before Extract is what is extracted.

## The seal column

Keeping the table was only half of it. The shape a carrier email arrives in more
often than any table is a list with no heading and no labels at all:

```
MSDU7776110  7548801
MEDU7011340  7548805
TGBU6995401  7548809
```

Every seal in that was lost too, and in every separator - tab, pipe and space
alike - because the rule above says an unlabelled token is never called a seal,
and there was no heading to call it one.

What names the second column is the column. One line proves nothing; a run of
lines that are each one container and one other token is a two-column list, and
the second column is the seal column. That is the same kind of evidence a
heading gives, read off the shape of the block instead of a word above it, and
the pair it yields is still the container and the seal the author wrote on one
line together. Nothing pairs the nth container with the nth seal of a separate
list, because there is no separate list; two unrelated lists stay unpaired, as
they always did.

`detectSealColumn` in `deckhand/src/extract/containers.ts`. A block is a seal
column only when all of this holds:

| Guard | Why |
| --- | --- |
| at least two lines | one stray line cannot make a column (one exception: the lone row below) |
| every line is exactly one container and one other token | a third value means it is some other list |
| the container is on the same side throughout | a block may not change its mind halfway |
| every other token carries a digit | rejects `Container MSDU7776110`, `MSDU7776110 Shanghai` |
| no token is itself a container number | two containers on a line is still no evidence |
| no token is a size-type code or a weight | rejects a `40HC` or `24000KG` column |
| the tokens are not all the same | a seal belongs to one container; a repeated value is a booking number or a box type |

### The lone row at the top of a reply chain

Reported on 2026-09-18 from a real producer email: fifteen containers, and the
seal on the first one missing. A quoted reply chain cuts one list into blocks,
newest first, and the newest block is very often a single row - the one
container that came in after the rest:

```
On Wed, Jan 28, 2026 at 11:54 AM Ariana Carrillo wrote:

BEAU5677331    5580622

On Wed, Jan 28, 2026 at 10:49 AM Ariana Carrillo wrote:

MSMU5020644    5580618
CAAU7105810    5580619
...
```

One line is not a column, so that row's seal was the only one of the fifteen
lost. It is not a stray line, though: it is the first row of a column the same
text already makes, four lines further down. So a row on its own joins that
column when, and only when, the rest of the text agrees:

| Guard | Why |
| --- | --- |
| at least one real block (two lines or more) was read | a text with no column in it still makes none |
| every real block puts the container on the same side | a text that cannot agree with itself proves nothing |
| the lone row puts it on that side too | the column decides the orientation, not the row |
| the row's seal is one no other row carries | a repeated value is a booking number, and the same row quoted twice is not two seals |

Every other guard in the table above applies to the row unchanged, so a lone
`MSDU7776110 40HC` still joins nothing. The seal reads `low` like the rest of
the column, and its label says the row stood alone, so the review screen shows
where it came from.

The seals it finds are marked `low`, never `high`. The review screen shows them
with **?** and "read, but not certain", because a column that named itself is
weaker evidence than a column with a heading over it. They are shown, they are
copied into the two-column output, and they are flagged. A heading, where there
is one, still wins and still reads at full confidence.

A separator lost in the paste is recovered in the same place: `TGBU69954017548809`
is one token, but ISO 6346 fixes the container at eleven characters, so the cut
is not a guess about where it ends - and it is taken only when those eleven
characters pass their check digit. Change one digit and the line is left alone
rather than split into something invented.

### What is still not read

| Shape | Result |
| --- | --- |
| one cell per line, no heading | containers, no seals |

Reached only when the `text/html` flavour is absent and the rows have been
flattened to a single stream. Cutting a flat stream into rows of N is pairing by
position, which is the one thing this module may not do, so it is reported
rather than guessed.

## Copying into a container template

`Copy container + seal (2 col)` is the two columns an INTTRA container template
wants: the container number and the seal on it. `Copy grid rows (3 col)` adds
the shipper seal column, for the grid that has one. `Container column` and
`Seal column` are the same rows one column at a time, in the same order, for a
grid that will not take a block.

A shipper seal is never promoted into an empty carrier seal cell. They are
different numbers on different bolts; a blank cell is fixed in seconds and a
wrong seal is not fixed at all. When the two-column copy leaves a cell empty
for that reason it says so, with a count.

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
