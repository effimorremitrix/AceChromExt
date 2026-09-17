/**
 * The one input.
 *
 * Quickfill has a single box. Whatever is in it is read without asking the
 * operator what it is: a filing package, a saved Deckhand extraction,
 * spreadsheet rows, or the carrier's email. Detection is by shape, first match
 * wins, and the result is always the same pair - a FilingPackage for the
 * INTTRA side and a CanonicalShipment for the ACE side - so the two fillers
 * never need to know which branch produced them.
 *
 * Pure: no DOM, no chrome.*, no file reading. The popup hands it a string.
 *
 * What this deliberately does NOT do, and what the other two extensions do:
 * no preview, no data quality checks, no Deckhand review, no Approve click, no
 * conflict screen, no readiness gate. Conflicts are resolved the moment they
 * appear (see `autoResolve`) and the Deckhand half is approved on arrival. The
 * operator checks the form before submitting; that is the whole contract.
 */

import { emptyCommodity, emptyInvoice, emptyProvenance, type CanonicalShipment } from '../../src/models/CanonicalInvoice.js';
import { mapSheetToCanonical } from '../../src/excel/canonicalMapper.js';
import { extractShipment } from '../../deckhand/src/extractor.js';
import { parseDeckhandJson } from '../../deckhand/src/serialize.js';
import type { DeckhandShipment } from '../../deckhand/src/model.js';
import { buildFilingPackage, rebuildFilingPackage } from '../../shared/src/builder.js';
import { looksLikeFilingPackage, parseFilingPackageJson } from '../../shared/src/serialize.js';
import { emptyDecisions, type FilingPackage, type PackageDecisions } from '../../shared/src/filingPackage.js';
import { aceShipmentFrom } from './aceShipment.js';

export type PasteKind = 'package' | 'deckhand' | 'rows' | 'containers' | 'email';

export interface Parsed {
  kind: PasteKind;
  /** The INTTRA side fills from this. Always present. */
  pkg: FilingPackage;
  /** The ACE side fills from this. Always present. */
  ace: CanonicalShipment;
  /** The one line shown under the box. Not a report; a sentence. */
  summary: string;
}

export interface ParseFailure {
  error: string;
}

export function isFailure(result: Parsed | ParseFailure): result is ParseFailure {
  return 'error' in result;
}

const KIND_LABELS: Record<PasteKind, string> = {
  package: 'filing package',
  deckhand: 'saved extraction',
  rows: 'spreadsheet rows',
  containers: 'container table',
  email: 'carrier email',
};

/** A shipment with no commercial data, so the package always has an invoice half. */
export function emptyCanonicalShipment(): CanonicalShipment {
  return {
    invoice: emptyInvoice(),
    commodities: [emptyCommodity(1)],
    provenance: emptyProvenance(),
    source: { fileName: 'pasted', sheetName: 'pasted', importedAt: new Date().toISOString(), rowCount: 0, headers: [], unknownHeaders: [] },
  };
}

/**
 * Every conflict resolved the same way, without asking.
 *
 * The carrier's own booking confirmation is what the carrier will check the
 * shipping instruction against, so when it disagrees with the invoice about a
 * booking number, a vessel, a container or a seal, the email wins. That is a
 * rule rather than a judgement, which is exactly why it can be applied without
 * a screen. The invoice half still owns everything commercial; the builder
 * never raises a conflict about those.
 */
export function autoResolve(pkg: FilingPackage): PackageDecisions {
  const decisions: PackageDecisions = {
    resolutions: { ...pkg.decisions.resolutions },
    manualHeader: { ...pkg.decisions.manualHeader },
    manualContainers: { ...pkg.decisions.manualContainers },
  };
  for (const conflict of pkg.conflicts) {
    if (conflict.resolution === 'unresolved') decisions.resolutions[conflict.id] = 'deckhand';
  }
  return decisions;
}

/** Build, then resolve whatever the build raised, then rebuild. Two passes, no questions. */
function packageFrom(invoice: CanonicalShipment, shipment: DeckhandShipment | null, now?: Date): FilingPackage {
  const first = buildFilingPackage({
    invoice,
    shipment,
    deckhandApproved: shipment !== null,
    decisions: emptyDecisions(),
    ...(now ? { now } : {}),
  });
  if (first.conflicts.every((conflict) => conflict.resolution !== 'unresolved')) return first;
  return rebuildFilingPackage(first, { decisions: autoResolve(first) });
}

/** Tab-separated or comma-separated text into the grid mapSheetToCanonical reads. */
export function splitRows(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim() !== '');
  const separator = (lines[0] ?? '').includes('\t') ? '\t' : ',';
  return lines.map((line) => line.split(separator).map((cell) => cell.trim().replace(/^"(.*)"$/, '$1')));
}

/** Two or more lines whose first line holds tabs, or at least two commas. */
function looksTabular(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) return false;
  const first = lines[0] ?? '';
  return first.includes('\t') || (first.match(/,/g)?.length ?? 0) >= 2;
}

function summaryFor(kind: PasteKind, pkg: FilingPackage): string {
  const parts = [KIND_LABELS[kind]];
  const booking = pkg.header.bookingReference.value;
  if (booking) parts.push(booking);
  const containers = pkg.containers.length;
  if (containers) parts.push(`${containers} container${containers === 1 ? '' : 's'}`);
  // An email-only paste still carries the blank placeholder commodity that
  // `emptyCanonicalShipment` supplies so the package always has an invoice
  // half. Counting it would tell the operator there is a cargo line when there
  // is not, so only lines that actually say something are counted.
  const lines = pkg.cargo.filter((line) => line.description.value.trim() !== '' || line.scheduleB.value.trim() !== '').length;
  if (lines) parts.push(`${lines} line${lines === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** Deckhand found something worth filling: a container, or a booking reference. */
function deckhandFound(shipment: DeckhandShipment): boolean {
  return shipment.containers.length > 0 || (shipment.bookingReference?.value ?? '') !== '';
}

/** The Deckhand branch, which is also where the tabular branch falls through to. */
function fromDeckhandText(text: string, kind: PasteKind, now?: Date): Parsed {
  const shipment = extractShipment({ kind: 'text', text, name: 'pasted text' });
  const pkg = packageFrom(emptyCanonicalShipment(), shipment, now);
  return { kind, pkg, ace: aceShipmentFrom(pkg), summary: summaryFor(kind, pkg) };
}

/**
 * Read the box.
 *
 * Detection order, first match wins:
 *   1. JSON that says it is a filing package  -> the package, as it is
 *   2. any other JSON object                  -> a saved Deckhand extraction
 *   3. two or more delimited lines            -> spreadsheet rows, and if those
 *      are not an invoice, Deckhand reads the same rows as a container table
 *   4. anything else                          -> the carrier email
 *
 * Step 3's fallthrough is the lesson of the first real paste against the live
 * INTTRA portal (2026-09-17). The operator pasted the container manifest the
 * office actually works from:
 *
 *   GALCO  Container #  LOT#:  SEAL#  BOOKING#  VARIETY  CONSIGNEE
 *   3994   TLLU7564971  PK00181  UL-8546727  EBKG18531463  CA STD 5%  Aydin ...
 *
 * That is tabular, so it went to the invoice reader, which correctly said it
 * holds no commodity rows - and the whole paste was thrown away with an error,
 * even though Deckhand reads that exact shape (it is the DOC CUT table in
 * tests/deckhand/pastedTable.test.ts) and returns every container beside its
 * own seal. A ladder that stops on the first rung it cannot climb is the bug;
 * a tabular paste that is not an invoice is a container table, so it keeps
 * descending.
 */
export function parsePaste(text: string, now?: Date): Parsed | ParseFailure {
  const trimmed = text.trim();
  if (trimmed === '') return { error: 'Paste the email, the package, or the rows first.' };

  try {
    if (trimmed.startsWith('{')) {
      if (looksLikeFilingPackage(trimmed)) {
        const pkg = parseFilingPackageJson(trimmed);
        const resolved = pkg.conflicts.some((conflict) => conflict.resolution === 'unresolved')
          ? rebuildFilingPackage(pkg, { decisions: autoResolve(pkg), deckhandApproved: pkg.shipment !== null })
          : pkg;
        return { kind: 'package', pkg: resolved, ace: aceShipmentFrom(resolved), summary: summaryFor('package', resolved) };
      }
      const shipment = parseDeckhandJson(trimmed);
      const pkg = packageFrom(emptyCanonicalShipment(), shipment, now);
      return { kind: 'deckhand', pkg, ace: aceShipmentFrom(pkg), summary: summaryFor('deckhand', pkg) };
    }

    if (looksTabular(trimmed)) {
      try {
        const result = mapSheetToCanonical({ name: 'pasted', rows: splitRows(trimmed) }, { fileName: 'pasted' });
        const pkg = packageFrom(result.shipment, null, now);
        return { kind: 'rows', pkg, ace: aceShipmentFrom(pkg), summary: summaryFor('rows', pkg) };
      } catch (invoiceError) {
        // Not an invoice sheet. Deckhand reads the same rows as a container
        // table; only if it finds nothing either is the paste really unusable,
        // and then the invoice reader's message is the more specific one.
        const containers = fromDeckhandText(trimmed, 'containers', now);
        if (deckhandFound(containers.pkg.shipment as DeckhandShipment)) return containers;
        return { error: (invoiceError as Error).message };
      }
    }

    return fromDeckhandText(trimmed, 'email', now);
  } catch (error) {
    return { error: (error as Error).message };
  }
}
