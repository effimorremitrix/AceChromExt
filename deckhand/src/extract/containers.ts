/**
 * Containers and seals, line by line.
 *
 * Three shapes of evidence are recognised, and nothing else pairs a seal with
 * a container:
 *
 *   same_row    a table row under a heading row that names a container column
 *               and a seal column, or a row with one container and one
 *               labelled seal
 *   same_line   one line of prose carrying exactly one container and exactly
 *               one labelled seal
 *   same_block  a line carrying one container and no seal, whose next non-blank
 *               line carries a labelled seal and no container
 *
 * Several containers on one line, or several seals on one line, is no
 * evidence at all: they are recorded as mentions with no seal and as
 * unassigned seals, and the review screen says so.
 */

import { normalizeContainerNumber, validateContainerNumber } from '../iso6346.js';
import type { Confidence, ContainerNumberField, PairEvidence, SealField } from '../model.js';

/** 4 letters + 6 digits + check digit, tolerating the spacing people type. */
const CONTAINER_RE = /\b[A-Z]{4}[\s-]?\d{6}[\s-]?\d\b/gi;

/** Seals have no standard shape, so they are only recognised behind a label. */
const SEAL_LABEL_RE = /\b((?:carrier|shipper|customs|line|cntr|container)?\s*seals?)\s*(?:no\.?|number|nos\.?|#|id)?\s*[:\-]\s*([^\n\r|]+)/i;
const SEAL_TOKEN_RE = /^[A-Z0-9][A-Z0-9-]{2,19}$/i;

export type SealKind = 'carrier' | 'shipper';

export interface SealMention {
  seal: SealField;
  kind: SealKind;
}

export interface ContainerMention {
  number: ContainerNumberField;
  carrierSeal: SealField | null;
  shipperSeal: SealField | null;
  evidence: PairEvidence | null;
  line: number;
}

export interface LineScan {
  containers: ContainerMention[];
  unassignedSeals: SealField[];
}

export function toContainerNumber(raw: string, confidence: Confidence = 'high'): ContainerNumberField {
  const trimmed = raw.trim();
  return {
    raw: trimmed,
    normalized: normalizeContainerNumber(trimmed),
    status: validateContainerNumber(trimmed),
    confidence,
  };
}

function findContainers(line: string): string[] {
  return [...line.matchAll(new RegExp(CONTAINER_RE.source, CONTAINER_RE.flags))].map((match) => match[0]);
}

function sealKindOf(label: string): SealKind {
  return /shipper/i.test(label) ? 'shipper' : 'carrier';
}

/**
 * Seals behind a label, split on the separators a list uses. "Seals: SL-1,
 * SL-2" is a list of two, which is why the rest of the line is taken and split
 * rather than one token captured. A container number in the value is not a
 * seal and is dropped here; it is picked up by findContainers.
 */
function findSeals(line: string): SealMention[] {
  const found: SealMention[] = [];
  let rest = line;
  for (let guard = 0; guard < 4; guard += 1) {
    const match = rest.match(SEAL_LABEL_RE);
    if (!match || match.index === undefined) break;
    const label = (match[1] ?? 'seal').trim();
    const value = match[2] ?? '';
    const tokens = value
      .split(/[,;]|\s{2,}|\t|\s+and\s+|\s+\/\s+/i)
      .map((token) => token.trim().split(/\s+/)[0] ?? '')
      .filter((token) => token !== '' && SEAL_TOKEN_RE.test(token) && normalizeContainerNumber(token) === null)
      // Stop at the first token that is itself a label ("Seal: X Vessel: Y").
      .filter((token) => !/^(?:vessel|voyage|container|eta|etd|pol|pod)$/i.test(token));
    for (const token of tokens) {
      found.push({ seal: { raw: token, confidence: 'high', label }, kind: sealKindOf(label) });
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return found;
}

/** A line that looks like a table row: two or more cells separated by | or a tab or a run of spaces. */
export function isTableRow(line: string): boolean {
  return /\|/.test(line) || /\S(?:\t| {2,})\S/.test(line);
}

function splitCells(line: string): string[] {
  const cells = /\|/.test(line) ? line.split('|') : line.split(/\t| {2,}/);
  return cells.map((cell) => cell.trim()).filter((cell, index, all) => !(cell === '' && (index === 0 || index === all.length - 1)));
}

interface TableHeader {
  container: number;
  carrierSeal: number | null;
  shipperSeal: number | null;
  cellCount: number;
}

/**
 * A heading row that names a container column and at least one seal column:
 * "Container | Seal", "Container No.  Carrier Seal  Shipper Seal". Rows under
 * it are read by column, which is the strongest evidence there is.
 */
function parseTableHeader(line: string): TableHeader | null {
  if (!isTableRow(line)) return null;
  if (findContainers(line).length) return null;
  const cells = splitCells(line).map((cell) => cell.toLowerCase());
  const container = cells.findIndex((cell) => /\b(?:container|cntr|equipment|unit)\b/.test(cell) && !/seal/.test(cell));
  if (container === -1) return null;
  const shipperSeal = cells.findIndex((cell) => /shipper/.test(cell) && /seal/.test(cell));
  const carrierSeal = cells.findIndex((cell, index) => /seal/.test(cell) && index !== shipperSeal);
  if (shipperSeal === -1 && carrierSeal === -1) return null;
  return {
    container,
    carrierSeal: carrierSeal === -1 ? null : carrierSeal,
    shipperSeal: shipperSeal === -1 ? null : shipperSeal,
    cellCount: cells.length,
  };
}

function sealCell(cells: string[], index: number | null, label: string): SealField | null {
  if (index === null) return null;
  const text = (cells[index] ?? '').trim();
  if (text === '') return null;
  // A labelled cell ("Seal No: SL-1") carries its label; strip it.
  const labelled = text.match(SEAL_LABEL_RE);
  const raw = (labelled ? (labelled[2] ?? '') : text).trim().split(/\s+/)[0] ?? '';
  if (raw === '' || !SEAL_TOKEN_RE.test(raw) || normalizeContainerNumber(raw) !== null) return null;
  return { raw, confidence: 'high', label };
}

function tableRow(line: string, header: TableHeader, lineNumber: number): ContainerMention | null {
  const cells = splitCells(line);
  const containerText = cells[header.container] ?? '';
  const containers = findContainers(containerText);
  if (containers.length !== 1) return null;
  return {
    number: toContainerNumber(containers[0] as string),
    carrierSeal: sealCell(cells, header.carrierSeal, 'Seal column'),
    shipperSeal: sealCell(cells, header.shipperSeal, 'Shipper seal column'),
    evidence: 'same_row',
    line: lineNumber,
  };
}

function attach(mention: ContainerMention, seals: SealMention[]): void {
  for (const { seal, kind } of seals) {
    if (kind === 'shipper') mention.shipperSeal = seal;
    else mention.carrierSeal = seal;
  }
}

/** One seal of each kind at most on the line is the only shape that proves a pairing. */
function oneOfEachKind(seals: SealMention[]): boolean {
  const carrier = seals.filter((seal) => seal.kind === 'carrier').length;
  const shipper = seals.filter((seal) => seal.kind === 'shipper').length;
  return seals.length >= 1 && carrier <= 1 && shipper <= 1;
}

export function scanLines(lines: string[]): LineScan {
  const containers: ContainerMention[] = [];
  const unassignedSeals: SealField[] = [];
  let header: TableHeader | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const lineNumber = index + 1;

    if (line.trim() === '') {
      // A blank line ends a table.
      header = null;
      continue;
    }

    const parsedHeader = parseTableHeader(line);
    if (parsedHeader) {
      header = parsedHeader;
      continue;
    }

    if (header) {
      const row = tableRow(line, header, lineNumber);
      if (row) {
        containers.push(row);
        continue;
      }
      // A row that does not fit the table falls through to the line rules.
    }

    const found = findContainers(line);
    const seals = findSeals(line);

    if (found.length === 1 && oneOfEachKind(seals)) {
      const mention: ContainerMention = {
        number: toContainerNumber(found[0] as string),
        carrierSeal: null,
        shipperSeal: null,
        evidence: isTableRow(line) ? 'same_row' : 'same_line',
        line: lineNumber,
      };
      attach(mention, seals);
      containers.push(mention);
      continue;
    }

    if (found.length === 1 && seals.length === 0) {
      // One container alone on its line. If the very next non-blank line is a
      // seal line with no container of its own, the two are one labelled
      // block: "Container 1: MSCU... / Seal: SL-1".
      const mention: ContainerMention = {
        number: toContainerNumber(found[0] as string),
        carrierSeal: null,
        shipperSeal: null,
        evidence: null,
        line: lineNumber,
      };
      const next = nextNonBlank(lines, index);
      if (next !== null) {
        const nextLine = lines[next] as string;
        const nextSeals = findSeals(nextLine);
        if (findContainers(nextLine).length === 0 && oneOfEachKind(nextSeals) && !parseTableHeader(nextLine)) {
          attach(mention, nextSeals);
          mention.evidence = 'same_block';
          index = next;
        }
      }
      containers.push(mention);
      continue;
    }

    // Several containers on one line, or several seals: no positional
    // evidence, so nothing is paired.
    for (const raw of found) {
      containers.push({ number: toContainerNumber(raw, 'low'), carrierSeal: null, shipperSeal: null, evidence: null, line: lineNumber });
    }
    for (const { seal } of seals) unassignedSeals.push({ ...seal, confidence: 'low' });
  }

  return { containers, unassignedSeals };
}

function nextNonBlank(lines: string[], from: number): number | null {
  for (let index = from + 1; index < lines.length; index += 1) {
    if ((lines[index] as string).trim() !== '') return index;
  }
  return null;
}
