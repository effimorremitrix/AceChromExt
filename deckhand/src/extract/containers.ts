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

/**
 * Seals have no standard shape, so they are only recognised behind a label -
 * or in a column, which is the other thing that names them. See the seal
 * column rules further down.
 */
const SEAL_LABEL_RE = /\b((?:carrier|shipper|customs|line|cntr|container)?\s*seals?)\s*(?:no\.?|number|nos\.?|#|id)?\s*[:\-]\s*([^\n\r|]+)/i;
const SEAL_TOKEN_RE = /^[A-Z0-9][A-Z0-9-]{2,19}$/i;

/** A whole line that is one container number and one other token, in either order. */
const CONTAINER_TOKEN_RE = /^[A-Z]{4}\d{7}$/i;

/**
 * A container number written hard against the number that follows it, which is
 * what a two-column list turns into when the separator is lost in the paste:
 * "TGBU69954017548809" is TGBU6995401 and 7548809. ISO 6346 is fixed at eleven
 * characters, so the cut is not a guess about where the boundary is - but it is
 * only taken when those eleven characters pass their check digit, and only
 * inside a column that other rows have already established.
 */
const RUN_TOGETHER_RE = /^([A-Z]{4}\d{7})(\d{4,12})$/i;

/**
 * Tokens that sit next to a container number without being a seal: the ISO
 * size-type code ("40HC", "22G1"), and a weight with its unit. Everything else
 * that carries a digit is allowed, because a seal number genuinely can be
 * almost anything.
 */
const NOT_A_SEAL_RE = /^(?:\d{2}[A-Z]{2}\d?|\d{2}[A-Z]\d|\d+(?:\.\d+)?(?:KG|KGS|LB|LBS|MT|CBM|M3)|\d{1,3}(?:ST|PCS|PKG|CTN|CTNS|BAG|BAGS|PLT)?)$/i;

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

/**
 * The seal column.
 *
 * A carrier email very often carries no table and no labels at all, just a list:
 *
 *     MSDU7776110  7548801
 *     MEDU7011340  7548805
 *     TGBU6995401  7548809
 *
 * Two columns, no heading. Read line by line that is a container and one
 * unlabelled token, and an unlabelled token is never called a seal, because a
 * seal has no shape to recognise it by. So every one of those seals was lost.
 *
 * What names the second column is the column itself. One line proves nothing;
 * a run of lines that are all one container and all one other token is a
 * two-column list, and the second column is the seal column. That is the same
 * kind of evidence a heading gives, arrived at from the shape of the block
 * rather than from a word above it, and the pairing it produces is still the
 * container and the seal the author wrote on one line together. Nothing here
 * pairs the nth container with the nth seal of a separate list; there is no
 * separate list.
 *
 * The guards are what keep an ordinary two-column list from being read as
 * seals. A block is a seal column only when:
 *
 *   - it is at least two lines, so one stray line cannot make a column;
 *   - every line is exactly one container number and exactly one other token;
 *   - the container is on the same side on every line;
 *   - every other token carries a digit, is not itself a container number, and
 *     is not a size-type code or a weight;
 *   - the tokens are not all the same, because a seal is unique to a container
 *     and a column repeating one value is a booking number or a box type.
 *
 * The seals it finds are marked `low`, never `high`: the review screen shows
 * them with "?" and the words "read, but not certain", because a column that
 * named itself is weaker evidence than a column with a heading over it. They
 * are shown, they are copied, and they are flagged - which is the whole point.
 */

interface ColumnLine {
  container: string;
  seal: string;
  /** Which side the container was on, so a block cannot change its mind halfway. */
  containerFirst: boolean;
}

function looksLikeSeal(token: string): boolean {
  if (!SEAL_TOKEN_RE.test(token)) return false;
  if (!/\d/.test(token)) return false;
  if (CONTAINER_TOKEN_RE.test(token.replace(/[\s-]/g, ''))) return false;
  return !NOT_A_SEAL_RE.test(token);
}

/** One line of a two-column list, or null when the line is anything else. */
export function twoColumnLine(line: string): ColumnLine | null {
  const tokens = line.trim().split(/[\s|\t]+/).filter((token) => token !== '');

  if (tokens.length === 1) {
    // The separator was lost in the paste. Only split where ISO 6346 says the
    // container ends AND the check digit agrees that it really ended there.
    const run = (tokens[0] as string).match(RUN_TOGETHER_RE);
    if (!run) return null;
    const container = run[1] as string;
    const seal = run[2] as string;
    if (validateContainerNumber(container) !== 'valid' || !looksLikeSeal(seal)) return null;
    return { container, seal, containerFirst: true };
  }

  if (tokens.length !== 2) return null;
  const [first, second] = tokens as [string, string];
  const firstIsContainer = CONTAINER_TOKEN_RE.test(first.replace(/[\s-]/g, ''));
  const secondIsContainer = CONTAINER_TOKEN_RE.test(second.replace(/[\s-]/g, ''));
  // Exactly one of the two must be a container; two containers on a line is the
  // "several containers, no evidence" case and stays that way.
  if (firstIsContainer === secondIsContainer) return null;
  const container = firstIsContainer ? first : second;
  const seal = firstIsContainer ? second : first;
  return looksLikeSeal(seal) ? { container, seal, containerFirst: firstIsContainer } : null;
}

/**
 * Every line that belongs to a seal column, by line index. Blank lines are
 * skipped rather than ending a block, because a list pasted out of a mail
 * client often has one between every row.
 */
export function detectSealColumn(lines: string[]): Map<number, ColumnLine> {
  const found = new Map<number, ColumnLine>();
  let index = 0;

  while (index < lines.length) {
    if ((lines[index] as string).trim() === '') {
      index += 1;
      continue;
    }

    const block: Array<{ at: number; parsed: ColumnLine }> = [];
    let at = index;
    let orientation: boolean | null = null;
    while (at < lines.length) {
      const line = lines[at] as string;
      if (line.trim() === '') {
        at += 1;
        continue;
      }
      const parsed = twoColumnLine(line);
      if (!parsed) break;
      if (orientation === null) orientation = parsed.containerFirst;
      else if (orientation !== parsed.containerFirst) break;
      block.push({ at, parsed });
      at += 1;
    }

    if (block.length >= 2) {
      const seals = block.map((item) => item.parsed.seal.toUpperCase());
      // A column that repeats one value is a booking number or a box type, not
      // a set of seals: a seal belongs to exactly one container.
      if (new Set(seals).size === seals.length) {
        for (const item of block) found.set(item.at, item.parsed);
      }
    }

    index = at > index ? at : index + 1;
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
  // Worked out over the whole text first: one line cannot tell you it is part
  // of a column, only the block around it can.
  const sealColumn = detectSealColumn(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const lineNumber = index + 1;

    if (line.trim() === '') {
      // A blank line ends a table.
      header = null;
      continue;
    }

    // A heading row is still better evidence, so the table rules below win
    // wherever there is a heading to win with.
    const column = header ? undefined : sealColumn.get(index);
    if (column) {
      containers.push({
        number: toContainerNumber(column.container),
        carrierSeal: { raw: column.seal, confidence: 'low', label: 'Second column, no heading' },
        shipperSeal: null,
        evidence: 'same_line',
        line: lineNumber,
      });
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
