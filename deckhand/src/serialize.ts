/**
 * DeckhandShipment <-> JSON, defensively.
 *
 * A .json file is untrusted input like a spreadsheet is. Everything is checked
 * on the way in: shapes, enumerations, sizes. A container's status is always
 * recomputed from its raw number, so a file cannot claim a check digit passed.
 */

import { normalizeContainerNumber, validateContainerNumber } from './iso6346.js';
import {
  DECKHAND_HEADER_FIELDS,
  DECKHAND_SCHEMA_VERSION,
  emptyDeckhandShipment,
  type Confidence,
  type DeckhandContainer,
  type DeckhandField,
  type DeckhandShipment,
  type PairEvidence,
  type SealField,
  type Uncertainty,
  type UncertaintyCode,
} from './model.js';

const MAX_CONTAINERS = 500;
const MAX_TEXT = 200;

const CONFIDENCES = new Set<Confidence>(['high', 'low', 'unsure']);
const EVIDENCE = new Set<PairEvidence>(['same_row', 'same_line', 'same_block']);
const CODES = new Set<UncertaintyCode>([
  'missing-field',
  'low-confidence',
  'ambiguous-field',
  'no-containers',
  'unassigned-seals',
  'unpaired-container',
  'seal-missing',
  'seal-conflict',
  'check-digit',
  'malformed-container',
  'reader',
]);

export class DeckhandParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeckhandParseError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean === '' ? null : clean.slice(0, max);
}

function confidence(value: unknown): Confidence {
  return CONFIDENCES.has(value as Confidence) ? (value as Confidence) : 'unsure';
}

function field(value: unknown): DeckhandField {
  if (!isObject(value)) return { value: null, confidence: 'unsure' };
  const read = text(value['value']);
  const evidence = text(value['evidence']);
  return { value: read, confidence: read === null ? 'unsure' : confidence(value['confidence']), ...(evidence ? { evidence } : {}) };
}

function seal(value: unknown): SealField | null {
  if (!isObject(value)) return null;
  const raw = text(value['raw'], 40);
  if (raw === null) return null;
  const label = text(value['label'], 40);
  return { raw, confidence: confidence(value['confidence']), ...(label ? { label } : {}) };
}

function container(value: unknown, index: number): DeckhandContainer {
  if (!isObject(value) || !isObject(value['containerNumber'])) throw new DeckhandParseError(`containers[${index}] is not a container.`);
  const raw = text(value['containerNumber']['raw'], 40);
  if (raw === null) throw new DeckhandParseError(`containers[${index}] has no container number.`);
  const evidence = EVIDENCE.has(value['evidence'] as PairEvidence) ? (value['evidence'] as PairEvidence) : null;
  const sealConflict = value['sealConflict'] === true;
  const lines = Array.isArray(value['lines']) ? value['lines'].filter((line): line is number => Number.isInteger(line) && line > 0).slice(0, 50) : [];
  return {
    containerNumber: {
      raw,
      normalized: normalizeContainerNumber(raw),
      status: validateContainerNumber(raw),
      confidence: confidence(value['containerNumber']['confidence']),
    },
    carrierSeal: sealConflict ? null : seal(value['carrierSeal']),
    shipperSeal: sealConflict ? null : seal(value['shipperSeal']),
    evidence,
    mentions: Number.isInteger(value['mentions']) && (value['mentions'] as number) > 0 ? (value['mentions'] as number) : 1,
    sealConflict,
    lines,
  };
}

function uncertainty(value: unknown): Uncertainty | null {
  if (!isObject(value)) return null;
  const message = text(value['message'], 400);
  if (message === null) return null;
  const code = CODES.has(value['code'] as UncertaintyCode) ? (value['code'] as UncertaintyCode) : 'reader';
  const severity = value['severity'] === 'error' ? 'error' : 'warning';
  const fieldName = text(value['field'], 40);
  const containerName = text(value['container'], 40);
  return { code, severity, message, ...(fieldName ? { field: fieldName } : {}), ...(containerName ? { container: containerName } : {}) };
}

/** Parse a JSON value (already decoded) into a DeckhandShipment. Throws DeckhandParseError. */
export function parseDeckhandShipment(input: unknown): DeckhandShipment {
  if (!isObject(input)) throw new DeckhandParseError('A Deckhand shipment must be a JSON object.');
  if (input['schemaVersion'] !== DECKHAND_SCHEMA_VERSION) {
    throw new DeckhandParseError(`Unsupported Deckhand schema version "${String(input['schemaVersion'])}" (expected ${DECKHAND_SCHEMA_VERSION}).`);
  }
  const containersRaw = Array.isArray(input['containers']) ? input['containers'] : [];
  if (containersRaw.length > MAX_CONTAINERS) throw new DeckhandParseError(`Too many containers (${containersRaw.length}).`);

  const sourceRaw = isObject(input['source']) ? input['source'] : {};
  const out = emptyDeckhandShipment({
    kind: sourceRaw['kind'] === 'file' ? 'file' : 'text',
    name: text(sourceRaw['name']) ?? 'unknown',
    extractor: text(sourceRaw['extractor'], 40) ?? 'unknown',
    extractedAt: text(sourceRaw['extractedAt'], 40) ?? new Date(0).toISOString(),
    textLength: Number.isInteger(sourceRaw['textLength']) ? (sourceRaw['textLength'] as number) : 0,
  });

  for (const name of DECKHAND_HEADER_FIELDS) out[name] = field(input[name]);
  out.containers = containersRaw.map((item, index) => container(item, index));
  out.unassignedSeals = (Array.isArray(input['unassignedSeals']) ? input['unassignedSeals'] : [])
    .map(seal)
    .filter((item): item is SealField => item !== null)
    .slice(0, MAX_CONTAINERS);
  out.uncertainties = (Array.isArray(input['uncertainties']) ? input['uncertainties'] : [])
    .map(uncertainty)
    .filter((item): item is Uncertainty => item !== null)
    .slice(0, 1000);
  return out;
}

export function parseDeckhandJson(json: string): DeckhandShipment {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new DeckhandParseError('The file is not valid JSON.');
  }
  return parseDeckhandShipment(value);
}

export function serializeDeckhandShipment(shipment: DeckhandShipment): string {
  return `${JSON.stringify(shipment, null, 2)}\n`;
}
