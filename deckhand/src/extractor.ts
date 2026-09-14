/**
 * The extraction entry point.
 *
 *   DeckhandInput  ->  reader (bytes -> text)  ->  extractor (text -> shipment)
 *
 * Both halves are registries so a mailbox adapter or a model-based extractor
 * can be added later without the review screen, the filing package or either
 * browser extension noticing. Today there is one extractor, the rules-based
 * one, and it is what every test exercises.
 */

import { EmlReader } from './readers/eml.js';
import { ImageReader, PdfReader, PlainTextReader, type DeckhandInput, type DocumentReader, type ReadFailure, type ReadResult } from './input.js';
import { emptyDeckhandShipment, type DeckhandShipment } from './model.js';
import { extractWithRules, RULES_EXTRACTOR_ID } from './extract/rulesExtractor.js';

export interface Extractor {
  readonly id: string;
  readonly label: string;
  extract(text: string, source: { kind: 'text' | 'file'; name: string }): DeckhandShipment;
}

export const RulesExtractor: Extractor = {
  id: RULES_EXTRACTOR_ID,
  label: 'Rules (offline, deterministic)',
  extract: (text, source) => extractWithRules(text, source),
};

/** Readers in claim order. The plain-text reader is last so a specific format wins. */
export const DOCUMENT_READERS: DocumentReader[] = [EmlReader, PdfReader, ImageReader, PlainTextReader];

export function readerFor(name: string, mediaType: string): DocumentReader | null {
  return DOCUMENT_READERS.find((reader) => reader.accepts(name, mediaType)) ?? null;
}

/** Turn any input into text, or say why it cannot be. */
export function readInput(input: DeckhandInput): ReadResult | ReadFailure {
  if (input.kind === 'text') {
    if (input.text.trim() === '') return { ok: false, reason: 'Paste the email text first.' };
    return { ok: true, text: input.text, reader: 'text', notes: [] };
  }
  const reader = readerFor(input.name, input.mediaType);
  if (!reader) {
    return {
      ok: false,
      reason: `"${input.name}" is not a file type Deckhand can read (.eml, .txt). Paste the text instead.`,
    };
  }
  if (!reader.available) return reader.read(input.bytes, input.name);
  return reader.read(input.bytes, input.name);
}

/** Read, then extract. Never throws: a file that cannot be read yields an empty shipment carrying the reason. */
export function extractShipment(input: DeckhandInput, extractor: Extractor = RulesExtractor): DeckhandShipment {
  const name = input.kind === 'text' ? input.name ?? 'pasted text' : input.name;
  const read = readInput(input);
  if (!read.ok) {
    const empty = emptyDeckhandShipment({ kind: input.kind, name, extractor: extractor.id, extractedAt: new Date().toISOString() });
    empty.uncertainties.push({ code: 'reader', severity: 'error', message: read.reason });
    return empty;
  }
  const shipment = extractor.extract(read.text, { kind: input.kind, name });
  for (const note of read.notes) shipment.uncertainties.unshift({ code: 'reader', severity: 'warning', message: note });
  return shipment;
}
