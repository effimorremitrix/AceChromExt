/**
 * FilingPackage: everything one shipment needs to be filed, from every source,
 * with each value saying where it came from.
 *
 *   QuickBooks / Excel  ->  CanonicalShipment  (the commercial facts)
 *   Email / document    ->  DeckhandShipment   (the transport identifiers)
 *                              \        /
 *                           FilingPackage
 *                             /        \
 *                     ACE Helper    INTTRA Helper
 *
 * It composes rather than copies: the CanonicalShipment and the
 * DeckhandShipment are carried whole, and the merged, provenanced values are
 * derived from them by `shared/src/builder.ts`. Re-running the builder on the
 * same two inputs and the same operator decisions yields the same package, so
 * the merged values can never disagree with their sources.
 *
 * The package is plain JSON (`filing-package.json`) so it can be inspected,
 * kept, and handed from the companion to either extension as a file.
 */

import type { CanonicalShipment } from '../../src/models/CanonicalInvoice.js';
import type { DeckhandShipment } from '../../deckhand/src/model.js';
import type { ContainerStatus } from '../../deckhand/src/iso6346.js';
import type { Provenanced } from './provenance.js';

export const FILING_PACKAGE_SCHEMA_VERSION = '1.0' as const;

/** What produced the commercial half. Mirrors the extension's SourceDescriptor without importing the UI layer. */
export interface CommercialSource {
  id: 'excel' | 'quickbooks-export';
  label: string;
  detail: string;
}

export interface PackageHeader {
  bookingReference: Provenanced;
  shipmentReference: Provenanced;
  vessel: Provenanced;
  voyage: Provenanced;
  portOfLoading: Provenanced;
  portOfDischarge: Provenanced;
  carrier: Provenanced;
  invoiceNumber: Provenanced;
  invoiceDate: Provenanced;
  customerName: Provenanced;
  consigneeAddress1: Provenanced;
  consigneeAddress2: Provenanced;
  consigneeCity: Provenanced;
  consigneeState: Provenanced;
  consigneePostalCode: Provenanced;
  consigneeCountry: Provenanced;
  poNumber: Provenanced;
  freightTerms: Provenanced;
  paymentTerms: Provenanced;
  destinationCountry: Provenanced;
  /** Sum of the cargo lines' values, whole units of the invoice currency. */
  totalValue: Provenanced;
  /** Sum of the cargo lines' shipping weights, kilograms. */
  totalWeightKg: Provenanced;
}

export const PACKAGE_HEADER_FIELDS = [
  'bookingReference',
  'shipmentReference',
  'vessel',
  'voyage',
  'portOfLoading',
  'portOfDischarge',
  'carrier',
  'invoiceNumber',
  'invoiceDate',
  'customerName',
  'consigneeAddress1',
  'consigneeAddress2',
  'consigneeCity',
  'consigneeState',
  'consigneePostalCode',
  'consigneeCountry',
  'poNumber',
  'freightTerms',
  'paymentTerms',
  'destinationCountry',
  'totalValue',
  'totalWeightKg',
] as const;

export type PackageHeaderField = (typeof PACKAGE_HEADER_FIELDS)[number];

export const PACKAGE_HEADER_LABELS: Record<PackageHeaderField, string> = {
  bookingReference: 'Booking reference',
  shipmentReference: 'Shipment reference',
  vessel: 'Vessel',
  voyage: 'Voyage',
  portOfLoading: 'Port of loading',
  portOfDischarge: 'Port of discharge',
  carrier: 'Carrier',
  invoiceNumber: 'Invoice number',
  invoiceDate: 'Invoice date',
  customerName: 'Consignee / customer',
  consigneeAddress1: 'Consignee address',
  consigneeAddress2: 'Consignee address (line 2)',
  consigneeCity: 'Consignee city',
  consigneeState: 'Consignee state',
  consigneePostalCode: 'Consignee postal code',
  consigneeCountry: 'Consignee country',
  poNumber: 'PO number',
  freightTerms: 'Freight terms',
  paymentTerms: 'Payment terms',
  destinationCountry: 'Country of destination',
  totalValue: 'Total value',
  totalWeightKg: 'Total weight (kg)',
};

/** One commodity line, provenanced. */
export interface PackageCargoLine {
  line: number;
  description: Provenanced;
  scheduleB: Provenanced;
  /** The first six digits of the Schedule B number, which is the HS code. */
  hsCode: Provenanced;
  quantity: Provenanced;
  uom: Provenanced;
  valueOfGoods: Provenanced;
  weightKg: Provenanced;
  origin: Provenanced;
  eccn: Provenanced;
  licenseCode: Provenanced;
  exportInformationCode: Provenanced;
}

/**
 * One container, as a container grid wants it: the identifiers from Deckhand,
 * the cargo from the invoice where it can be attributed to this container
 * without guessing, and everything else left for the operator.
 */
export interface PackageContainer {
  index: number;
  containerNumber: Provenanced;
  /** ISO 6346 status of the container number, recomputed from the value. */
  status: ContainerStatus;
  carrierSeal: Provenanced;
  shipperSeal: Provenanced;
  cargoDescription: Provenanced;
  hsCode: Provenanced;
  packageType: Provenanced;
  packageCount: Provenanced;
  grossWeightKg: Provenanced;
  marksAndNumbers: Provenanced;
}

export const PACKAGE_CONTAINER_FIELDS = [
  'containerNumber',
  'carrierSeal',
  'shipperSeal',
  'cargoDescription',
  'hsCode',
  'packageType',
  'packageCount',
  'grossWeightKg',
  'marksAndNumbers',
] as const;

export type PackageContainerField = (typeof PACKAGE_CONTAINER_FIELDS)[number];

export const PACKAGE_CONTAINER_LABELS: Record<PackageContainerField, string> = {
  containerNumber: 'Container number',
  carrierSeal: 'Carrier seal',
  shipperSeal: 'Shipper seal',
  cargoDescription: 'Cargo description',
  hsCode: 'HS code',
  packageType: 'Package type',
  packageCount: 'Package count',
  grossWeightKg: 'Gross weight (kg)',
  marksAndNumbers: 'Marks and numbers',
};

export type ConflictField = 'bookingReference' | 'vessel' | 'containers' | 'carrierSeal';

/**
 * The two sources disagree about one value. Nothing is overwritten: both
 * values are carried, the package says which one the merged value currently
 * follows, and a material conflict blocks filling until the operator picks.
 */
export interface Conflict {
  id: string;
  field: ConflictField;
  /** Which container the conflict is about, when it is about one. */
  container?: string;
  material: boolean;
  commercialValue: string;
  deckhandValue: string;
  message: string;
  resolution: 'unresolved' | 'commercial' | 'deckhand';
}

export interface PackageNote {
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface PackageReview {
  /** 'not-applicable' when the package has no Deckhand half. */
  deckhand: 'not-applicable' | 'pending' | 'approved';
  approvedAt: string | null;
}

/** Operator decisions that shape the merge, kept so a rebuild reproduces them. */
export interface PackageDecisions {
  /** Conflict id -> which side to follow. */
  resolutions: Record<string, 'commercial' | 'deckhand'>;
  /** Header values typed by the operator, keyed by header field. */
  manualHeader: Partial<Record<PackageHeaderField, string>>;
  /** Container values typed by the operator, keyed by container index then field. */
  manualContainers: Record<number, Partial<Record<PackageContainerField, string>>>;
}

export interface FilingPackage {
  schemaVersion: typeof FILING_PACKAGE_SCHEMA_VERSION;
  packageId: string;
  createdAt: string;
  /** The commercial half, whole. Null for a Deckhand-only package. */
  invoice: CanonicalShipment | null;
  commercialSource: CommercialSource | null;
  /** The transport half, whole. Null for a commercial-only package. */
  shipment: DeckhandShipment | null;
  review: PackageReview;
  decisions: PackageDecisions;
  header: PackageHeader;
  cargo: PackageCargoLine[];
  containers: PackageContainer[];
  conflicts: Conflict[];
  notes: PackageNote[];
}

export function emptyDecisions(): PackageDecisions {
  return { resolutions: {}, manualHeader: {}, manualContainers: {} };
}
