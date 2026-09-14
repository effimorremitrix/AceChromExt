/**
 * What Deckhand accepts, and how each kind becomes text.
 *
 * The extraction engine reads text. Everything else - a pasted email, a body
 * handed over by a future mailbox adapter, a saved .eml, a .txt - is turned
 * into text by a reader first, so the engine has one input and one behaviour.
 *
 * Readers that need a capability this build does not have are declared and
 * marked unavailable, in the same spirit as the extension's WebSource: the
 * seam is visible, and the message says what to do instead ("paste the text").
 * PDF text extraction and image OCR both need either a large dependency that
 * would fail the extension's no-dynamic-code bundle check, or a network
 * service, which the extension has no permission for by design.
 */

export type DeckhandInput =
  | { kind: 'text'; text: string; name?: string }
  | { kind: 'file'; name: string; mediaType: string; bytes: Uint8Array };

export interface ReadResult {
  ok: true;
  text: string;
  /** How the bytes were turned into text, for the source record. */
  reader: string;
  notes: string[];
}

export interface ReadFailure {
  ok: false;
  /** Why, in words the operator can act on. */
  reason: string;
}

export interface DocumentReader {
  readonly id: string;
  readonly label: string;
  /** False for a reader that is declared but not built in this environment. */
  readonly available: boolean;
  /** Does this reader claim the file? */
  accepts(name: string, mediaType: string): boolean;
  read(bytes: Uint8Array, name: string): ReadResult | ReadFailure;
}

/** Bytes -> string, UTF-8 with a BOM stripped. Latin-1 is not guessed at. */
export function decodeUtf8(bytes: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(bytes).replace(/^﻿/, '');
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export const TEXT_EXTENSIONS = new Set(['txt', 'text', 'md', 'csv', 'tsv', 'log']);

export const PlainTextReader: DocumentReader = {
  id: 'text',
  label: 'Plain text',
  available: true,
  accepts: (name, mediaType) => TEXT_EXTENSIONS.has(extension(name)) || mediaType.startsWith('text/plain'),
  read: (bytes) => ({ ok: true, text: decodeUtf8(bytes), reader: 'text', notes: [] }),
};

export const PdfReader: DocumentReader = {
  id: 'pdf',
  label: 'PDF (not available in this build)',
  available: false,
  accepts: (name, mediaType) => extension(name) === 'pdf' || mediaType === 'application/pdf',
  read: () => ({
    ok: false,
    reason:
      'PDF text extraction is not built into this version. Open the PDF, select all, copy, and paste the text into the box instead. Deckhand reads the pasted text exactly as it would read the email body.',
  }),
};

export const ImageReader: DocumentReader = {
  id: 'image',
  label: 'Image / scan (not available in this build)',
  available: false,
  accepts: (name, mediaType) => ['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff', 'webp'].includes(extension(name)) || mediaType.startsWith('image/'),
  read: () => ({
    ok: false,
    reason:
      'Reading identifiers off a photograph or scan needs OCR, which this version does not include (it would need either a network service or a large bundled model). Type or paste the identifiers instead.',
  }),
};

export function extensionOf(name: string): string {
  return extension(name);
}
