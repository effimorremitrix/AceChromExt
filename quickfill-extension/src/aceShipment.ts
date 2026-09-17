/**
 * FilingPackage -> the CanonicalShipment the ACE filler reads, with no gate.
 *
 * `shared/src/aceView.ts` does the same job for the ACE Helper, and it is
 * deliberately gated: it calls `fillGate(pkg)` and drops the transport overlay
 * when the Deckhand half is unapproved, a material conflict is unresolved, or
 * a container number fails its ISO 6346 check digit, and it throws outright
 * when the package carries no invoice. Every one of those is a stop-and-look
 * moment, which is the ACE Helper's job and not this one's.
 *
 * Quickfill fills anyway. The same overlay rules, minus the gate:
 *
 *   - a container number that fails its check digit is typed as it was read.
 *     If the carrier's email has a typo in it, ACE gets the typo. That is the
 *     whole trade this extension makes, and it lives in this one function so
 *     it can be read and reversed in one place;
 *   - a package with no commercial half yields an empty invoice with the
 *     transport identifiers overlaid, rather than an exception.
 *
 * `shared/` is not modified: the ACE Helper keeps its gate.
 */

import type { CanonicalShipment, InvoiceField } from '../../src/models/CanonicalInvoice.js';
import { emptyCommodity, emptyInvoice, emptyProvenance } from '../../src/models/CanonicalInvoice.js';
import { normalizedContainerNumber } from '../../shared/src/builder.js';
import type { FilingPackage } from '../../shared/src/filingPackage.js';
import type { Provenanced } from '../../shared/src/provenance.js';

function blankShipment(): CanonicalShipment {
  return {
    invoice: emptyInvoice(),
    commodities: [emptyCommodity(1)],
    provenance: emptyProvenance(),
    source: { fileName: 'pasted', sheetName: 'pasted', importedAt: new Date().toISOString(), rowCount: 0, headers: [], unknownHeaders: [] },
  };
}

function clone(shipment: CanonicalShipment): CanonicalShipment {
  return {
    invoice: { ...shipment.invoice },
    commodities: shipment.commodities.map((line) => ({ ...line })),
    provenance: {
      invoice: { ...shipment.provenance.invoice },
      commodities: Object.fromEntries(Object.entries(shipment.provenance.commodities).map(([line, record]) => [line, { ...record }])),
    },
    source: { ...shipment.source },
  };
}

export function aceShipmentFrom(pkg: FilingPackage): CanonicalShipment {
  const shipment = pkg.invoice ? clone(pkg.invoice) : blankShipment();

  const overlay = (field: InvoiceField, value: Provenanced | undefined, column: string): void => {
    if (!value || value.value.trim() === '' || value.source === 'missing') return;
    shipment.invoice[field] = value.value;
    shipment.provenance.invoice[field] = {
      column: `${column} (${value.source}${value.detail ? `: ${value.detail}` : ''})`,
      original: value.original ?? value.value,
      transform: value.transform ?? null,
      normalized: value.value,
    };
  };

  overlay('bookingNumber', pkg.header.bookingReference, 'BookingNumber');
  overlay('vessel', pkg.header.vessel, 'Vessel');
  overlay('carrier', pkg.header.carrier, 'Carrier');

  // ACE's Transportation step holds one container and one seal. With several
  // containers nothing is chosen - picking one would be a guess, and a guess is
  // the one thing this extension still refuses to make. The operator types
  // them, exactly as they would in the ACE Helper.
  const container = pkg.containers.length === 1 ? pkg.containers[0] : undefined;
  if (container) {
    overlay('containerNumber', { ...container.containerNumber, value: normalizedContainerNumber(container) }, 'ContainerNumber');
    // The SealNumber column is the operator's own seal, so the shipper seal
    // feeds it. A carrier seal is a different bolt and never stands in for it.
    overlay('sealNumber', container.shipperSeal, 'SealNumber');
  }

  return shipment;
}
