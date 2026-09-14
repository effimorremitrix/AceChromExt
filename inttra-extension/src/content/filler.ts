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
import type { SelectorOverrides } from '../../../src/ace/selectors/overrides.js';
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

function detectionMessage(status: string, matchedWith: string | null, count?: number): string {
  if (status === 'AMBIGUOUS') return `${count ?? 2} controls matched "${matchedWith}". Not written; the mapping needs a more specific selector.`;
  if (status === 'NOT_WRITABLE') return 'The matching control is disabled or read-only right now.';
  return 'No control on this screen matched the mapping. Its selectors are placeholders until captured from the live portal (see Diagnostics).';
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

  const mappings = resolveInttraFields(page, scope, request.overrides ?? null);
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

  const detection = detectField(mapping, { root: doc });
  if (detection.status !== 'FOUND' || !detection.element) {
    return { ...base, status: 'warning', message: detectionMessage(detection.status, detection.matchedWith, detection.ambiguousCount), written: finalValue, matchedWith: detection.matchedWith, confidence: detection.confidence };
  }
  base.selector = detection.matchedWith ?? base.selector;

  const existing = readInttraFieldValue(detection.element);
  if (existing.trim() !== '' && existing.trim() !== finalValue.trim() && !request.overwrite) {
    return { ...base, status: 'warning', message: `INTTRA already holds "${existing}". Left untouched; turn on overwrite to replace it.`, written: finalValue, readBack: existing, matchedWith: detection.matchedWith, confidence: detection.confidence };
  }
  if (request.dryRun) {
    return { ...base, status: transformText ? 'transformed' : 'filled', message: `Dry run: would write "${finalValue}".${notes.length ? ` ${notes.join(' ')}` : ''}`, written: finalValue, matchedWith: detection.matchedWith, confidence: detection.confidence };
  }

  const write = setInttraFieldValue(detection.element, finalValue, { blur: request.dispatchBlur ?? true });
  const duration = request.highlightDurationMs ?? 6000;
  if (!write.ok) {
    highlightField(detection.element, 'error', duration, mapping.key);
    return { ...base, status: 'error', message: write.reason ?? 'The value could not be written.', written: finalValue, readBack: write.readBack, matchedWith: detection.matchedWith, confidence: detection.confidence };
  }
  const status: InttraFillOutcome['status'] = transformText || notes.length ? 'transformed' : 'filled';
  highlightField(detection.element, status, duration, mapping.key);
  const parts = [...notes];
  if (write.reason) parts.push(write.reason);
  if (detection.confidence === 'low') parts.push('Matched by a structural fallback; confirm this is the right INTTRA field.');
  if (write.selectedText) parts.push(`Selected "${write.selectedText}".`);
  return { ...base, status, written: finalValue, readBack: write.readBack, matchedWith: detection.matchedWith, confidence: detection.confidence, ...(parts.length ? { message: parts.join(' ') } : {}) };
}
