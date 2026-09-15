/**
 * The operator dashboard's working model: a list of shipments, one active.
 *
 * A shipment here is a working session, not a new domain entity: the
 * commercial import (a workbook or the commercial half of a package), the
 * Deckhand extraction, and the filing package built from them - the same
 * three things the extension panels hold in chrome.storage.session, with the
 * same types. The dashboard adds nothing to the domain model; it holds
 * several of these side by side and remembers what happened to each.
 *
 * Everything lives in memory. Nothing here is written to browser storage or
 * sent anywhere: the operator downloads filing-package.json to keep it, and
 * `tests/webInvariants.test.ts` fails the build if that changes.
 */

import type { CanonicalShipment } from '../../src/models/CanonicalInvoice.js';
import type { ValidationResult } from '../../src/excel/validator.js';
import type { MapperNote } from '../../src/excel/canonicalMapper.js';
import type { SourceDescriptor } from '../../src/sources/InvoiceDataSource.js';
import type { DeckhandShipment } from '../../deckhand/src/model.js';
import type { FilingPackage } from '../../shared/src/filingPackage.js';

/** The commercial half as imported: a workbook, or the invoice carried by a package. */
export interface CommercialImport {
  shipment: CanonicalShipment;
  validation: ValidationResult;
  notes: MapperNote[];
  source: SourceDescriptor;
  fileName: string;
}

/** The Deckhand extraction the operator is reviewing, and when it was approved. */
export interface ExtractionState {
  shipment: DeckhandShipment;
  approvedAt: string | null;
}

export interface ActivityEntry {
  at: string;
  message: string;
}

export interface ShipmentRecord {
  /** Local, per-session id. Never derived from shipment data. */
  id: string;
  /** Operator-typed label; '' means "derive one from the data". */
  name: string;
  createdAt: string;
  commercial: CommercialImport | null;
  extraction: ExtractionState | null;
  /** The email text in the Deckhand paste box, kept across re-renders. */
  emailDraft: string;
  pkg: FilingPackage | null;
  /** What happened to this shipment, newest last. Memory only. */
  activity: ActivityEntry[];
}

export interface Workspace {
  shipments: ShipmentRecord[];
  activeId: string | null;
}

export function emptyWorkspace(): Workspace {
  return { shipments: [], activeId: null };
}

export function activeShipment(workspace: Workspace): ShipmentRecord | null {
  return workspace.shipments.find((record) => record.id === workspace.activeId) ?? null;
}

/** Replace one shipment record, by id. */
export function withShipment(workspace: Workspace, record: ShipmentRecord): Workspace {
  const exists = workspace.shipments.some((item) => item.id === record.id);
  return {
    shipments: exists ? workspace.shipments.map((item) => (item.id === record.id ? record : item)) : [...workspace.shipments, record],
    activeId: workspace.activeId ?? record.id,
  };
}

export function addShipment(workspace: Workspace, record: ShipmentRecord): Workspace {
  return { shipments: [...workspace.shipments, record], activeId: record.id };
}

export function removeShipment(workspace: Workspace, id: string): Workspace {
  const shipments = workspace.shipments.filter((item) => item.id !== id);
  const activeId = workspace.activeId === id ? (shipments[shipments.length - 1]?.id ?? null) : workspace.activeId;
  return { shipments, activeId };
}

export function selectShipment(workspace: Workspace, id: string): Workspace {
  return workspace.shipments.some((item) => item.id === id) ? { ...workspace, activeId: id } : workspace;
}
