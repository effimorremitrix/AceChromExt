/**
 * A saved email (.eml, RFC 5322 with MIME): the text/plain part, decoded.
 *
 * Outlook's "Save as" and Gmail's "Show original" both produce this. Only the
 * body is read; headers are reduced to the Subject line, because a subject
 * often carries the booking reference ("RE: SHPX-99121 - container list").
 *
 * Deliberately small: no HTML rendering, no attachments, no nested
 * message/rfc822. A multipart with no text/plain part falls back to a
 * tag-stripped text/html part with a note saying so.
 */

import { decodeUtf8, extensionOf, type DocumentReader, type ReadFailure, type ReadResult } from '../input.js';

interface Part {
  headers: Record<string, string>;
  body: string;
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

function splitMessage(text: string): Part {
  const separator = text.search(/\r?\n\r?\n/);
  if (separator === -1) return { headers: parseHeaders(text), body: '' };
  const headerBlock = text.slice(0, separator);
  const body = text.slice(separator).replace(/^\r?\n\r?\n/, '');
  return { headers: parseHeaders(headerBlock), body };
}

function parameter(headerValue: string, name: string): string | null {
  const match = headerValue.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|([^;\\s]+))`, 'i'));
  if (!match) return null;
  return (match[2] ?? match[3] ?? '').trim();
}

function decodeQuotedPrintable(text: string): string {
  const bytes: number[] = [];
  const joined = text.replace(/=\r?\n/g, '');
  for (let index = 0; index < joined.length; index += 1) {
    const character = joined[index] as string;
    if (character === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(index + 1, index + 3))) {
      bytes.push(parseInt(joined.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(character.charCodeAt(0) & 0xff);
    }
  }
  return decodeUtf8(Uint8Array.from(bytes));
}

function decodeBase64(text: string): string {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    if (character === '=') break;
    buffer = (buffer << 6) | table.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return decodeUtf8(Uint8Array.from(bytes));
}

function decodeBody(part: Part): string {
  const encoding = (part.headers['content-transfer-encoding'] ?? '7bit').toLowerCase();
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(part.body);
  if (encoding === 'base64') return decodeBase64(part.body);
  return part.body;
}

function stripHtml(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<\s*\/td\s*>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}

interface Collected {
  plain: string[];
  html: string[];
}

function collect(part: Part, into: Collected, depth = 0): void {
  const type = (part.headers['content-type'] ?? 'text/plain').toLowerCase();
  if (type.startsWith('multipart/') && depth < 6) {
    const boundary = parameter(part.headers['content-type'] ?? '', 'boundary');
    if (!boundary) return;
    const pieces = part.body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*(?:\\r?\\n|$)`));
    for (const piece of pieces.slice(1)) {
      if (piece.trim() === '') continue;
      collect(splitMessage(piece), into, depth + 1);
    }
    return;
  }
  if (type.startsWith('text/plain')) into.plain.push(decodeBody(part));
  else if (type.startsWith('text/html')) into.html.push(stripHtml(decodeBody(part)));
}

export function readEml(bytes: Uint8Array): ReadResult | ReadFailure {
  const message = splitMessage(decodeUtf8(bytes));
  const collected: Collected = { plain: [], html: [] };
  collect(message, collected);

  const notes: string[] = [];
  let body: string;
  if (collected.plain.length) {
    body = collected.plain.join('\n\n');
  } else if (collected.html.length) {
    body = collected.html.join('\n\n');
    notes.push('The email had no plain-text part; the HTML part was read with its tags removed.');
  } else {
    return { ok: false, reason: 'No readable text part was found in this email.' };
  }

  const subject = message.headers['subject'];
  const text = subject ? `Subject: ${subject}\n\n${body}` : body;
  return { ok: true, text, reader: 'eml', notes };
}

export const EmlReader: DocumentReader = {
  id: 'eml',
  label: 'Saved email (.eml)',
  available: true,
  accepts: (name, mediaType) => extensionOf(name) === 'eml' || mediaType === 'message/rfc822',
  read: (bytes) => readEml(bytes),
};
