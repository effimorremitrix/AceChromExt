/**
 * Fill orchestration for the INTTRA screens that are forms rather than a
 * grid: General Details, Container & Cargo, Print Instructions, B/L Documents.
 *
 * Same discipline as the ACE filler: only the detected screen's fields, no
 * guessed field, nothing clicked, every write verified by read-back.
 */

import { detectField } from '../../../src/content/fieldDetector.js';
import { highlightField } from '../../../src/content/highlight.js';
import { describeCandidate } from '../../../src/ace/selectors/types.js';
import { runTransforms } from '../../../src/ace/transformers/index.js';
import { truncate } from '../../../src/ace/transformers/text.js';
import { DEFAULT_SETTINGS } from '../../../src/core/settings.js';
import { ROW_TOKEN, withRowNumber, type SelectorOverrides } from '../../../src/ace/selectors/overrides.js';
import type { FilingPackage, PackageContainer, PackageContainerField, PackageHeaderField } from '../../../shared/src/filingPackage.js';
import { describeProvenance, type Provenanced } from '../../../shared/src/provenance.js';
import { normalizedContainerNumber } from '../../../shared/src/builder.js';
import { emptyInttraFillReport, tallyInttraReport, type InttraFieldMapping, type InttraFieldScope, type InttraFillOutcome, type InttraFillReport, type InttraPageId } from '../models/InttraField.js';
import { resolveInttraFields } from '../mappings/index.js';
import { readInttraFieldValue, setInttraFieldValue } from './fieldWriter.js';

export interface InttraFillRequest {
  pkg: FilingPackage;
  page: InttraPageId;
  scope: InttraFieldScope;
  /** Which package container feeds container-scoped fields. Defaults to the first. */
  containerIndex?: number;
  dryRun?: boolean;
  overwrite?: boolean;
  overrides?: SelectorOverrides | null;
  highlightDurationMs?: number;
  dispatchBlur?: boolean;
}

/** Resolve `header.x` or `container.x` against the package. */
export function resolvePackageSource(source: string, pkg: FilingPackage, container: PackageContainer | null): Provenanced | null {
  const [root, field] = source.split('.');
  if (!root || !field) return null;
  if (root === 'header') {
    const value = pkg.header[field as PackageHeaderField];
    return value ?? null;
  }
  if (root === 'container') {
    if (!container) return null;
    if (field === 'containerNumber') return { ...container.containerNumber, value: normalizedContainerNumber(container) };
    const value = container[field as PackageContainerField];
    return value ?? null;
  }
  return null;
}

/**
 * A container-scoped mapping, aimed at one row.
 *
 * INTTRA's Particulars section gives every control of container N the same
 * `-N` suffix, numbered from 1 upward (captured 2026-09-20), so a selector is
 * written once with `{n}` and pointed at a row here. Substituting before
 * detection is what keeps a write inside its own row: a row-numbered id
 * resolves to exactly one control, so container 2's seal can never land in
 * container 1's box, and a row INTTRA does not have yet resolves to nothing
 * and is reported rather than written into the wrong row.
 *
 * Rows are 1-based, matching what the portal numbers them.
 *
 * Beyond the first row, a candidate that carries no row number is DROPPED
 * rather than tried. This is the trap the filter exists for: filling
 * container 2 on a draft that has one block would otherwise fall through the
 * ladder to a label or a class, match the one control on the screen, and
 * write container 2's number into container 1's box. A selector that cannot
 * name a row cannot be aimed at one, so for row 2 and beyond only the
 * row-numbered selectors are tried, and a row the screen does not have is
 * reported instead of written.
 */
export function mappingsForRow(mappings: InttraFieldMapping[], row: number): InttraFieldMapping[] {
  return mappings.map((mapping) => ({
    ...mapping,
    candidates: mapping.candidates
      .filter((candidate) => row === 1 || carriesRowToken(candidate))
      .map((candidate) => ({
        ...candidate,
        ...(candidate.selector === undefined ? {} : { selector: withRowNumber(candidate.selector, row) }),
        ...(candidate.within === undefined ? {} : { within: withRowNumber(candidate.within, row) }),
      })),
  }));
}

function carriesRowToken(candidate: InttraFieldMapping['candidates'][number]): boolean {
  return (candidate.selector ?? '').includes(ROW_TOKEN) || (candidate.within ?? '').includes(ROW_TOKEN);
}

function detectionMessage(status: string, matchedWith: string | null, count?: number, row?: number): string {
  if (status === 'AMBIGUOUS') {
    return `${count ?? 2} controls matched "${matchedWith}". Not written. Copy the right one's id from the list below into Diagnostics -> selector overrides, and this field resolves on the next fill.`;
  }
  if (status === 'NOT_WRITABLE') return 'The matching control is disabled or read-only right now.';
  // A container-scoped field is aimed at one numbered row, and the commonest
  // reason it resolves to nothing is that the row is not on the screen: every
  // draft carries a different number of containers, and the helper never
  // presses Add Container (automationPolicy.ts).
  if (row !== undefined) {
    return `Nothing on this screen matched row ${row}. Either INTTRA has fewer container blocks than the package has containers - add them in INTTRA, the helper never presses Add Container - or this field's selector is still a placeholder (see Diagnostics).`;
  }
  return 'No control on this screen matched the mapping. Its selectors are placeholders until captured from the live portal (see Diagnostics).';
}

/**
 * The message for a container field that has no row-numbered selector at all.
 *
 * `mappingsForRow` leaves such a mapping with an empty candidate list beyond
 * row 1, which would otherwise be reported as "nothing matched row 2" - true,
 * but it reads as an INTTRA problem when it is ours. Three container fields
 * carry a captured `-{n}` id (Container Number and the two seals); the rest
 * are label wordings, and a label cannot name a row.
 */
function noRowSelectorMessage(label: string, row: number): string {
  return `${label} has no row-numbered selector yet, so it can only be filled in container block 1; row ${row} was left alone rather than written into another row. Capture this field's id from the live DOM (it should end in "-${row}", the shape the seals have) and paste it into Diagnostics -> selector overrides.`;
}

/**
 * The location code inside a port value, when it carries one.
 *
 * Deckhand hands over "OAKLAND, CA, UNITED STATES (USOAK)". INTTRA's port
 * type-ahead is quickest on the UN/LOCODE, so the message names it - the
 * operator types five characters instead of thirty.
 */
export function locationCode(value: string): string | null {
  const match = /\(([A-Z]{5})\)\s*$/.exec(value.trim());
  return match ? (match[1] as string) : null;
}

export function fillInttraFields(request: InttraFillRequest, doc: Document = document): InttraFillReport {
  const { pkg, page, scope } = request;
  const containerIndex = request.containerIndex ?? 0;
  const report = emptyInttraFillReport(page, scope, scope === 'container' ? containerIndex : undefined);
  const container = scope === 'container' ? pkg.containers[containerIndex] ?? null : null;

  if (scope === 'container' && !container) {
    report.outcomes.push({ key: 'container', label: 'Container', status: 'error', message: `Container ${containerIndex + 1} is not in the package.` });
    return tallyInttraReport(report);
  }

  const resolved = resolveInttraFields(page, scope, request.overrides ?? null);
  const mappings = scope === 'container' ? mappingsForRow(resolved, containerIndex + 1) : resolved;
  if (!mappings.length) {
    report.outcomes.push({ key: 'page', label: 'Page', status: 'warning', message: `No ${scope} fields are mapped for this INTTRA screen.` });
    return tallyInttraReport(report);
  }

  for (const mapping of mappings) report.outcomes.push(fillOne(mapping, request, container, doc));
  return tallyInttraReport(report);
}

function fillOne(mapping: InttraFieldMapping, request: InttraFillRequest, container: PackageContainer | null, doc: Document): InttraFillOutcome {
  const base: InttraFillOutcome = { key: mapping.key, label: mapping.label, status: 'skipped', source: mapping.source, selector: describeCandidate(mapping.candidates) };
  const item = resolvePackageSource(mapping.source, request.pkg, container);
  if (!item) return { ...base, status: 'error', message: `Mapping source "${mapping.source}" is not part of the filing package.` };
  base.provenance = describeProvenance(item);

  if (item.value.trim() === '' || item.source === 'missing') {
    return { ...base, status: mapping.expected ? 'warning' : 'skipped', message: mapping.expected ? 'No value in the package for this expected field.' : 'No value in the package.' };
  }

  const transformed = runTransforms(item.value, mapping.transforms, { settings: DEFAULT_SETTINGS });
  if (transformed.error) return { ...base, status: 'error', message: transformed.error };
  const { value: finalValue, truncated } = truncate(transformed.text, mapping.maxLength);
  const notes = [...transformed.notes];
  if (truncated) notes.push(`Truncated to ${mapping.maxLength} characters.`);
  const transformText = [item.transform, transformed.transform].filter(Boolean).join('; ') || null;

  const row = request.scope === 'container' ? (request.containerIndex ?? 0) + 1 : undefined;
  if (!mapping.candidates.length) {
    // Every candidate was dropped by mappingsForRow: none of them can name a
    // row, so there is nothing safe to try beyond block 1.
    return { ...base, status: 'warning', message: noRowSelectorMessage(mapping.label, row ?? 1), written: finalValue };
  }

  const detection = detectField(mapping, { root: doc });
  if (detection.status !== 'FOUND' || !detection.element) {
    return {
      ...base,
      status: 'warning',
      message: detectionMessage(detection.status, detection.matchedWith, detection.ambiguousCount, row),
      written: finalValue,
      matchedWith: detection.matchedWith,
      confidence: detection.confidence,
      ...(detection.ambiguousMatches?.length ? { matches: detection.ambiguousMatches } : {}),
    };
  }
  base.selector = detection.matchedWith ?? base.selector;

  const existing = readInttraFieldValue(detection.element);
  if (existing.trim() !== '' && existing.trim() !== finalValue.trim() && !request.overwrite) {
    return { ...base, status: 'warning', message: `INTTRA already holds "${existing}". Left untouched; turn on overwrite to replace it.`, written: finalValue, readBack: existing, matchedWith: detection.matchedWith, confidence: detection.confidence };
  }
  if (request.dryRun) {
    return { ...base, status: transformText ? 'transformed' : 'filled', message: `Dry run: would write "${finalValue}".${notes.length ? ` ${notes.join(' ')}` : ''}`, written: finalValue, transform: transformText, matchedWith: detection.matchedWith, confidence: detection.confidence };
  }

  // A type-ahead is written without the two events that make INTTRA validate
  // and empty it; the operator picks from the list that is now open.
  const lookup = mapping.type === 'lookup';
  const write = setInttraFieldValue(
    detection.element,
    finalValue,
    // Not even focus: focusing the NEXT field blurs this one, and the blur is
    // what INTTRA throws the typed location away on.
    lookup ? { blur: false, change: false, focus: false } : { blur: request.dispatchBlur ?? true },
  );
  const duration = request.highlightDurationMs ?? 6000;
  if (!write.ok) {
    highlightField(detection.element, 'error', duration, mapping.key);
    return { ...base, status: 'error', message: write.reason ?? 'The value could not be written.', written: finalValue, readBack: write.readBack, matchedWith: detection.matchedWith, confidence: detection.confidence };
  }
  // A look-up is never reported as filled: the text is in the box, but
  // INTTRA keeps nothing the operator did not pick from its own list.
  const status: InttraFillOutcome['status'] = lookup ? 'warning' : transformText || notes.length ? 'transformed' : 'filled';
  highlightField(detection.element, status, duration, mapping.key);
  const parts = [...notes];
  if (transformed.transform) parts.push(`${transformed.transform}.`);
  if (write.reason) parts.push(write.reason);
  if (lookup) {
    const code = locationCode(finalValue);
    parts.push(
      `Typed into INTTRA's location look-up and left open: INTTRA keeps a location only when it is chosen from its own list, so pick it from the suggestions${code ? ` (searching "${code}" is quickest)` : ''}. Nothing here presses it for you.`,
    );
  }
  if (detection.narrowedBy) parts.push(`${detection.narrowedBy}, so that one was used. Confirm it is the right box.`);
  if (detection.confidence === 'low') parts.push('Matched by a structural fallback; confirm this is the right INTTRA field.');
  if (write.selectedText) parts.push(`Selected "${write.selectedText}".`);
  return {
    ...base,
    status,
    written: finalValue,
    readBack: write.readBack,
    transform: transformText,
    matchedWith: detection.matchedWith,
    confidence: detection.confidence,
    ...(detection.ambiguousMatches?.length ? { matches: detection.ambiguousMatches } : {}),
    ...(parts.length ? { message: parts.join(' ') } : {}),
  };
}
