/**
 * Mentions -> containers.
 *
 * A container number turns up more than once in a real email: in the depot
 * list, and again in a sentence of prose ("note that MSKU7293415 is the
 * reefer"). That is one container, not two, so repeat mentions collapse onto
 * the entry that first named the container, and each seal is taken from
 * whichever mention carried one.
 *
 * The exception is the case that must never be guessed: two mentions claiming
 * DIFFERENT seals of the same kind for one container. There is no evidence for
 * choosing between them, so neither is used, the seal is left null and the
 * container is flagged.
 */

import type { DeckhandContainer, PairEvidence, SealField, Uncertainty } from '../model.js';
import { containerDisplay } from '../model.js';
import type { ContainerMention } from './containers.js';

const EVIDENCE_RANK: Record<PairEvidence, number> = { same_row: 3, same_block: 2, same_line: 1 };

function strongerEvidence(current: PairEvidence | null, next: PairEvidence | null): PairEvidence | null {
  if (!next) return current;
  if (!current) return next;
  return EVIDENCE_RANK[next] > EVIDENCE_RANK[current] ? next : current;
}

function sameSeal(a: SealField | null, b: SealField | null): boolean {
  if (!a || !b) return false;
  return a.raw.toUpperCase() === b.raw.toUpperCase();
}

export function assembleContainers(mentions: ContainerMention[]): DeckhandContainer[] {
  const containers: DeckhandContainer[] = [];
  const byKey = new Map<string, DeckhandContainer>();

  for (const mention of mentions) {
    const key = (mention.number.normalized ?? mention.number.raw).toUpperCase();
    const seen = byKey.get(key);

    if (!seen) {
      const container: DeckhandContainer = {
        containerNumber: mention.number,
        carrierSeal: mention.carrierSeal,
        shipperSeal: mention.shipperSeal,
        evidence: mention.evidence,
        mentions: 1,
        sealConflict: false,
        lines: [mention.line],
      };
      containers.push(container);
      byKey.set(key, container);
      continue;
    }

    seen.mentions += 1;
    seen.lines.push(mention.line);
    // A mention read with confidence beats one recognised by shape alone.
    if (seen.containerNumber.confidence !== 'high' && mention.number.confidence === 'high') {
      seen.containerNumber = mention.number;
    }
    seen.evidence = strongerEvidence(seen.evidence, mention.evidence);

    // Once contested a seal stays contested; a third mention cannot break the tie.
    if (seen.sealConflict) continue;

    for (const kind of ['carrierSeal', 'shipperSeal'] as const) {
      const incoming = mention[kind];
      if (!incoming) continue;
      const current = seen[kind];
      if (!current) {
        seen[kind] = incoming;
        continue;
      }
      if (sameSeal(current, incoming)) continue;
      seen.carrierSeal = null;
      seen.shipperSeal = null;
      seen.sealConflict = true;
      break;
    }
  }

  return containers;
}

/** The uncertainties the containers themselves raise. Header-field ones are added by the extractor. */
export function containerUncertainties(containers: DeckhandContainer[], unassignedSeals: SealField[]): Uncertainty[] {
  const out: Uncertainty[] = [];

  if (containers.length === 0) {
    out.push({ code: 'no-containers', severity: 'warning', message: 'No container numbers were recognised in this document.' });
  }

  const unpaired = containers.filter((container) => container.evidence === null);
  if (unpaired.length > 0 && unassignedSeals.length > 0) {
    out.push({
      code: 'unassigned-seals',
      severity: 'error',
      message: `${unpaired.length} container(s) and ${unassignedSeals.length} seal(s) were not shown next to each other, so they are listed separately and NOT paired. Match them from the source yourself.`,
    });
  } else if (unassignedSeals.length > 0) {
    out.push({
      code: 'unassigned-seals',
      severity: 'warning',
      message: `${unassignedSeals.length} seal(s) appeared with no container beside them and belong to no row: ${unassignedSeals.map((seal) => seal.raw).join(', ')}.`,
    });
  }

  for (const container of containers) {
    const number = containerDisplay(container);
    if (container.containerNumber.status === 'invalid') {
      out.push({
        code: 'check-digit',
        severity: 'error',
        message: `Container ${container.containerNumber.raw} fails its ISO 6346 check digit. Retype it from the source; it was not corrected.`,
        container: number,
      });
    } else if (container.containerNumber.status === 'malformed') {
      out.push({
        code: 'malformed-container',
        severity: 'error',
        message: `"${container.containerNumber.raw}" is not a container number format. Check it against the source.`,
        container: number,
      });
    }
    if (container.sealConflict) {
      out.push({
        code: 'seal-conflict',
        severity: 'error',
        message: `Container ${number} was given two different seals in this document. Neither was used; fill the seal from the source.`,
        container: number,
      });
    } else if (container.evidence === null && unassignedSeals.length > 0) {
      // Covered by the unassigned-seals error above: the seal may be one of
      // the loose ones, and only the source can say which.
      continue;
    } else if (!container.carrierSeal && !container.shipperSeal && !container.sealConflict) {
      out.push({
        code: 'seal-missing',
        severity: 'warning',
        message: `Container ${number} has no seal number in this document.`,
        container: number,
      });
    }
  }

  return out;
}
