/**
 * The deterministic extractor: regular expressions and line shape, no model
 * call, no network. It runs the same way on every machine and in every test.
 *
 * It generalises only as far as the shapes it was written against, which is
 * the honest floor for a tool that reads legal identifiers: it will say
 * "missing" or "not paired" long before it says something wrong. The three
 * email shapes it was built on are in tests/fixtures/deckhand/.
 */

import {
  DECKHAND_HEADER_FIELDS,
  DECKHAND_FIELD_LABELS,
  emptyDeckhandShipment,
  type DeckhandShipment,
  type DeckhandSource,
  type Uncertainty,
} from '../model.js';
import { assembleContainers, containerUncertainties } from './assemble.js';
import { scanLines } from './containers.js';
import { HEADER_LABELS, labelledField, vesselVoyageCombined } from './labels.js';

export const RULES_EXTRACTOR_ID = 'rules-1';

export function extractWithRules(text: string, source: Partial<DeckhandSource> = {}): DeckhandShipment {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = emptyDeckhandShipment({
    kind: 'text',
    name: 'pasted text',
    ...source,
    extractor: RULES_EXTRACTOR_ID,
    extractedAt: new Date().toISOString(),
    textLength: text.length,
  });

  const uncertainties: Uncertainty[] = [];

  for (const field of DECKHAND_HEADER_FIELDS) {
    const result = labelledField(lines, HEADER_LABELS[field]);
    out[field] = result.field;
    if (result.alternatives.length) {
      uncertainties.push({
        code: 'ambiguous-field',
        severity: 'warning',
        message: `${DECKHAND_FIELD_LABELS[field]} was given more than one value (${result.alternatives.join(' / ')}). The first was kept; confirm it.`,
        field,
      });
    }
  }

  // "Vessel/Voyage: X / Y" fills whichever of the two the plain labels missed.
  const combined = vesselVoyageCombined(lines);
  if (combined) {
    if (out.vessel.value === null) out.vessel = combined.vessel;
    if (out.voyage.value === null) out.voyage = combined.voyage;
  }

  // A shipment reference that merely repeats the booking reference is the
  // same identifier read twice, not a second one.
  if (
    out.shipmentReference.value !== null &&
    out.bookingReference.value !== null &&
    out.shipmentReference.value.toUpperCase() === out.bookingReference.value.toUpperCase()
  ) {
    out.shipmentReference = { value: null, confidence: 'unsure' };
  }

  const scan = scanLines(lines);
  out.containers = assembleContainers(scan.containers);
  out.unassignedSeals = scan.unassignedSeals;

  for (const field of DECKHAND_HEADER_FIELDS) {
    const value = out[field];
    if (value.value === null) {
      uncertainties.push({
        code: 'missing-field',
        severity: 'warning',
        message: `${DECKHAND_FIELD_LABELS[field]}: not found in this document.`,
        field,
      });
    } else if (value.confidence !== 'high') {
      uncertainties.push({
        code: 'low-confidence',
        severity: 'warning',
        message: `${DECKHAND_FIELD_LABELS[field]}: read as "${value.value}" but not certain.`,
        field,
      });
    }
  }

  uncertainties.push(...containerUncertainties(out.containers, out.unassignedSeals));
  out.uncertainties = uncertainties;
  return out;
}
