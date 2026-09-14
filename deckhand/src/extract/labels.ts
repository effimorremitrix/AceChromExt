/**
 * Labelled header fields: "Booking Ref: SHPX-99120", "Vessel: X   Voyage: 12E".
 *
 * A value is read only from behind a label. Nothing here recognises a booking
 * reference by shape, because there is no shape: every carrier has its own.
 */

import type { Confidence, DeckhandField } from '../model.js';

export interface LabelSpec {
  /** Regular-expression source for the label text, case-insensitive. */
  labels: string[];
}

/**
 * Labels that can follow a value on the same line, so the first value stops
 * before the second label: "Vessel: X    Voyage: 12E".
 */
const TRAILING_LABEL =
  /\b(?:voyage|voy|vessel|vsl|seal|seals|container|containers|cntr|eta|etd|pod|pol|port of (?:loading|discharge)|booking|shipment|b\/l|bl no)\b\s*(?:no\.?|number|#|ref\.?|reference|id)?\s*[:\-]/i;

export const HEADER_LABELS = {
  bookingReference: [
    'carrier\\s*booking\\s*(?:ref(?:erence)?|no\\.?|number|#)?',
    'booking\\s*(?:ref(?:erence)?|no\\.?|number|#|confirmation)?',
    'bkg\\s*(?:ref|no\\.?|number|#)?',
  ],
  shipmentReference: [
    'shipment\\s*(?:ref(?:erence)?|id|no\\.?|number|#)',
    'shipper\\s*(?:\'s)?\\s*ref(?:erence)?(?:\\s*no\\.?)?',
    'our\\s*ref(?:erence)?',
    'file\\s*(?:no\\.?|number|ref)',
  ],
  vessel: ['vessel\\s*(?:name)?', 'vsl', 'ship', 'm/?v', 'ocean\\s*vessel'],
  voyage: ['voyage\\s*(?:no\\.?|number|#)?', 'voy(?:\\.|age)?\\s*(?:no\\.?|#)?'],
  portOfLoading: ['port\\s*of\\s*loading', 'pol', 'load(?:ing)?\\s*port', 'origin\\s*port', 'origin'],
  portOfDischarge: ['port\\s*of\\s*discharge', 'pod', 'discharge\\s*port', 'destination\\s*port', 'destination'],
} as const;

function cleanValue(text: string): string {
  return text
    .split(/\s{2,}|\t/)[0]!
    .split(TRAILING_LABEL)[0]!
    .trim()
    .replace(/[.,;]+$/, '')
    .trim();
}

interface Hit {
  value: string;
  line: number;
  label: string;
}

/** Every value found behind any of the labels, in document order. */
export function findLabelled(lines: string[], labels: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  for (const label of labels) {
    // The label must start a line or follow a run of spaces / a separator, so
    // "Vessel" inside "Ocean Vessel" is not matched twice and "pol" is not
    // found inside "policy".
    const pattern = new RegExp(`(?:^|[\\s|,;(])(${label})\\s*[:\\-]\\s*([^\\n\\r|]{1,80})`, 'i');
    lines.forEach((line, index) => {
      const match = line.match(pattern);
      if (!match) return;
      const value = cleanValue(match[2] ?? '');
      if (value === '' || /^(?:n\/?a|none|tbd|tba|-+)$/i.test(value)) return;
      hits.push({ value, line: index + 1, label: (match[1] ?? label).trim() });
    });
  }
  return hits.sort((a, b) => a.line - b.line);
}

export interface LabelledResult {
  field: DeckhandField;
  /** Distinct values seen, when more than one, so the caller can flag the ambiguity. */
  alternatives: string[];
}

export function labelledField(lines: string[], labels: readonly string[]): LabelledResult {
  const hits = findLabelled(lines, labels);
  if (!hits.length) return { field: { value: null, confidence: 'unsure' }, alternatives: [] };

  const first = hits[0] as Hit;
  const distinct = [...new Set(hits.map((hit) => hit.value.toUpperCase().replace(/\s+/g, ' ')))];
  const confidence: Confidence = distinct.length === 1 ? 'high' : 'low';
  return {
    field: { value: first.value, confidence, evidence: `"${first.label}" on line ${first.line}` },
    alternatives: distinct.length === 1 ? [] : hits.map((hit) => hit.value),
  };
}

/**
 * "Vessel/Voyage: MSC FIRENZE / 541W" and "Vessel / Voy: MAERSK OHIO 123W":
 * one label carrying both values. The split is at the slash, or at the last
 * token when it looks like a voyage number (digits with an optional letter).
 */
export function vesselVoyageCombined(lines: string[]): { vessel: DeckhandField; voyage: DeckhandField } | null {
  const pattern = /(?:^|[\s|,;(])(vessel\s*\/\s*voy(?:age)?(?:\s*no\.?)?)\s*[:\-]\s*([^\n\r|]{2,80})/i;
  for (let index = 0; index < lines.length; index += 1) {
    const match = (lines[index] as string).match(pattern);
    if (!match) continue;
    const text = cleanValue(match[2] ?? '');
    const evidence = `"${(match[1] ?? '').trim()}" on line ${index + 1}`;
    const slash = text.split(/\s*\/\s*/);
    if (slash.length === 2 && slash[0] && slash[1]) {
      return {
        vessel: { value: slash[0].trim(), confidence: 'high', evidence },
        voyage: { value: slash[1].trim(), confidence: 'high', evidence },
      };
    }
    const tokens = text.split(/\s+/);
    const last = tokens[tokens.length - 1] ?? '';
    if (tokens.length >= 2 && /^\d{2,5}[A-Z]{0,2}$/i.test(last)) {
      return {
        vessel: { value: tokens.slice(0, -1).join(' '), confidence: 'low', evidence },
        voyage: { value: last, confidence: 'low', evidence },
      };
    }
    return { vessel: { value: text, confidence: 'low', evidence }, voyage: { value: null, confidence: 'unsure' } };
  }
  return null;
}
