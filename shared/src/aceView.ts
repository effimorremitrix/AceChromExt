/**
 * FilingPackage -> the CanonicalShipment the ACE Helper fills from.
 *
 * ACE Helper's whole pipeline (preview, data quality checks, mapping status,
 * fill) reads a CanonicalShipment, and that must stay true: ACE must keep
 * working with no Deckhand and no package at all. So a package is turned into
 * the same model, with the transport identifiers overlaid from the approved
 * Deckhand half and their provenance rewritten to say so.
 *
 * The ACE canonical model holds one container and one seal. With several
 * containers in the package nothing is chosen: the two fields are left as the
 * commercial data had them and a note says why.
 */

import type { CanonicalShipment, FieldProvenance, InvoiceField } from '../../src/models/CanonicalInvoice.js';
import { validateContainerNumber } from '../../deckhand/src/iso6346.js';
import { fillGate, normalizedContainerNumber } from './builder.js';
import type { FilingPackage, PackageNote } from './filingPackage.js';
import type { Provenanced } from './provenance.js';

export interface AceView {
  shipment: CanonicalShipment;
  notes: PackageNote[];
}

function provenanceFor(value: Provenanced, column: string): FieldProvenance {
  return {
    column: `${column} (${value.source === 'deckhand' ? 'Deckhand' : value.source}${value.detail ? `: ${value.detail}` : ''})`,
    original: value.original ?? value.value,
    transform: value.transform ?? null,
    normalized: value.value,
  };
}

export function aceShipmentFromPackage(pkg: FilingPackage): AceView {
  if (!pkg.invoice) {
    throw new Error('This package has no commercial data. ACE needs the invoice and its commodity lines; import the workbook or build the package from QuickBooks first.');
  }

  const shipment: CanonicalShipment = {
    invoice: { ...pkg.invoice.invoice },
    commodities: pkg.invoice.commodities.map((line) => ({ ...line })),
    provenance: {
      invoice: { ...pkg.invoice.provenance.invoice },
      commodities: Object.fromEntries(Object.entries(pkg.invoice.provenance.commodities).map(([line, record]) => [line, { ...record }])),
    },
    source: { ...pkg.invoice.source },
  };
  const notes: PackageNote[] = [];

  const gate = fillGate(pkg);
  const useDeckhand = pkg.review.deckhand === 'approved' && gate.ok;
  if (pkg.shipment && !useDeckhand) {
    notes.push({
      severity: 'warning',
      message: `The Deckhand values were not applied to the ACE fields: ${gate.reasons.join(' ')} The commercial values are used as they were.`,
    });
  }

  const overlay = (field: InvoiceField, value: Provenanced, column: string): void => {
    if (value.value === '' || value.source === 'missing') return;
    if (value.source === 'deckhand' && !useDeckhand) return;
    shipment.invoice[field] = value.value;
    shipment.provenance.invoice[field] = provenanceFor(value, column);
  };

  overlay('bookingNumber', pkg.header.bookingReference, 'BookingNumber');
  overlay('vessel', pkg.header.vessel, 'Vessel');
  overlay('carrier', pkg.header.carrier, 'Carrier');

  if (pkg.containers.length === 1) {
    const container = pkg.containers[0]!;
    overlay('containerNumber', { ...container.containerNumber, value: normalizedContainerNumber(container) }, 'ContainerNumber');
    overlay('sealNumber', container.carrierSeal, 'SealNumber');
  } else if (pkg.containers.length > 1) {
    // A placeholder such as "See Ocean B/L" in the commercial container field
    // must not be typed into ACE now that the real containers are known.
    const commercial = shipment.invoice.containerNumber;
    const placeholder = commercial !== '' && validateContainerNumber(commercial) === 'malformed';
    if (placeholder) {
      shipment.invoice.containerNumber = '';
      shipment.invoice.sealNumber = '';
      delete shipment.provenance.invoice['containerNumber'];
      delete shipment.provenance.invoice['sealNumber'];
    }
    notes.push({
      severity: 'info',
      message: `The package has ${pkg.containers.length} containers (${pkg.containers.map(normalizedContainerNumber).join(', ')}). ACE Helper's Transportation mapping holds one container and one seal, so those two fields were ${
        placeholder ? `cleared (the commercial data said "${commercial}", which is not a container number)` : 'left as the commercial data had them'
      }; enter the containers in ACE by hand.`,
    });
  }

  return { shipment, notes };
}
