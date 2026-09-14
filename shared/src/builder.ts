/**
 * FilingPackageBuilder: CanonicalShipment + DeckhandShipment -> FilingPackage.
 *
 * Ownership, and it is the whole merge policy:
 *
 *   commercial (QuickBooks / Excel)   invoice, customer, values, commodities,
 *                                     quantities, weights, descriptions, PO,
 *                                     terms, carrier
 *   Deckhand                          booking reference, shipment reference,
 *                                     container numbers, seals, vessel/voyage,
 *                                     ports
 *   manual                            everything neither holds, and every
 *                                     unresolved conflict
 *
 * When both halves carry the same identifier they are compared. Agreement is
 * recorded (`confirmedBy`). Disagreement is recorded as a Conflict and the
 * merged value follows the owner of that field until the operator decides;
 * a material conflict blocks filling. Nothing is ever silently overwritten,
 * and nothing is ever invented: a value neither source holds is `missing`.
 */

import type { CanonicalCommodity, CanonicalShipment, FieldProvenance } from '../../src/models/CanonicalInvoice.js';
import type { DeckhandContainer, DeckhandField, DeckhandShipment } from '../../deckhand/src/model.js';
import { containerDisplay } from '../../deckhand/src/model.js';
import { normalizeContainerNumber, validateContainerNumber, type ContainerStatus } from '../../deckhand/src/iso6346.js';
import { buildReview } from '../../deckhand/src/review/reviewModel.js';
import { safeFileStem } from '../../deckhand/src/review/format.js';
import { formatWithSeparators } from '../../src/ace/transformers/numbers.js';
import { scheduleBDigits } from '../../src/ace/transformers/codes.js';
import {
  emptyDecisions,
  FILING_PACKAGE_SCHEMA_VERSION,
  PACKAGE_CONTAINER_FIELDS,
  PACKAGE_HEADER_FIELDS,
  type CommercialSource,
  type Conflict,
  type FilingPackage,
  type PackageCargoLine,
  type PackageContainer,
  type PackageDecisions,
  type PackageHeader,
  type PackageHeaderField,
  type PackageNote,
  type PackageReview,
} from './filingPackage.js';
import { derived, manual, missing, type Provenanced, type ValueSource } from './provenance.js';

export interface BuildInput {
  invoice?: CanonicalShipment | null;
  commercialSource?: CommercialSource | null;
  shipment?: DeckhandShipment | null;
  /** Set when the operator has approved the Deckhand extraction. */
  deckhandApproved?: boolean;
  approvedAt?: string | null;
  decisions?: PackageDecisions;
  /** Fixed for reproducible output in tests. */
  now?: Date;
  packageId?: string;
}

export class FilingPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilingPackageError';
  }
}

// ------------------------------------------------------------ small helpers

function normalizeId(text: string): string {
  return text.toUpperCase().replace(/[\s\-_./]/g, '');
}

function normalizeText(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function commercialSourceOf(source: CommercialSource | null | undefined): ValueSource {
  return source?.id === 'quickbooks-export' ? 'quickbooks' : 'excel';
}

function fromInvoice(
  invoice: CanonicalShipment | null | undefined,
  field: keyof CanonicalShipment['invoice'],
  source: ValueSource,
): Provenanced {
  if (!invoice) return missing();
  const value = invoice.invoice[field];
  if (value === '' || value === null || value === undefined) return missing();
  return withProvenance(String(value), source, invoice.provenance.invoice[field], field);
}

function withProvenance(value: string, source: ValueSource, record: FieldProvenance | undefined, field: string): Provenanced {
  const out: Provenanced = { value, source, detail: record?.column ?? field };
  if (record && record.original !== '' && (record.transform || record.original !== value)) out.original = record.original;
  if (record?.transform) out.transform = record.transform;
  return out;
}

function fromDeckhand(field: DeckhandField, label: string): Provenanced {
  if (field.value === null) return missing();
  return {
    value: field.value,
    source: 'deckhand',
    detail: field.evidence ?? label,
    confidence: field.confidence,
  };
}

function numberText(value: number | null, decimals?: number): string {
  if (value === null) return '';
  return decimals === undefined ? String(value) : String(Math.round(value * 10 ** decimals) / 10 ** decimals);
}

// -------------------------------------------------------------- reconciling

interface Reconciled {
  value: Provenanced;
  conflict: Conflict | null;
}

/**
 * Two candidates for one field. The owner wins when they disagree; the other
 * confirms when they agree; either stands alone when the other is missing.
 */
function reconcile(
  field: Conflict['field'],
  label: string,
  owner: Provenanced,
  other: Provenanced,
  agrees: (a: string, b: string) => boolean,
  material: boolean,
  decisions: PackageDecisions,
  ownerSide: 'commercial' | 'deckhand',
  container?: string,
): Reconciled {
  if (owner.value === '' && other.value === '') return { value: missing(), conflict: null };
  if (owner.value === '') return { value: other, conflict: null };
  if (other.value === '') return { value: owner, conflict: null };
  if (agrees(owner.value, other.value)) {
    return { value: { ...owner, confirmedBy: other.source }, conflict: null };
  }

  const id = container ? `${field}:${container}` : field;
  const resolution = decisions.resolutions[id] ?? 'unresolved';
  const commercialValue = ownerSide === 'commercial' ? owner.value : other.value;
  const deckhandValue = ownerSide === 'deckhand' ? owner.value : other.value;
  const conflict: Conflict = {
    id,
    field,
    ...(container ? { container } : {}),
    material,
    commercialValue,
    deckhandValue,
    message: `${label}: the commercial data says "${commercialValue}" and the document says "${deckhandValue}".${
      resolution === 'unresolved' ? (material ? ' Choose one before filling.' : ' Confirm which is right.') : ` Following ${resolution === 'commercial' ? 'the commercial data' : 'the document'}.`
    }`,
    resolution,
  };

  let chosen: Provenanced;
  if (resolution === 'unresolved') chosen = owner;
  else chosen = (resolution === ownerSide ? owner : other);
  if (resolution !== 'unresolved') chosen = { ...chosen, detail: `${chosen.detail ?? chosen.source}; chosen by the operator over "${resolution === ownerSide ? other.value : owner.value}"` };
  return { value: chosen, conflict };
}

const sameId = (a: string, b: string): boolean => normalizeId(a) === normalizeId(b);

/**
 * "MSC FIRENZE" agrees with "MSC FIRENZE", "MSC Firenze V.541W" and
 * "MSC FIRENZE / 541W": an invoice vessel field often carries the voyage.
 */
function vesselAgrees(voyage: string): (a: string, b: string) => boolean {
  return (a, b) => {
    const x = normalizeText(a);
    const y = normalizeText(b);
    if (x === y) return true;
    const [longer, shorter] = x.length >= y.length ? [x, y] : [y, x];
    if (!longer.startsWith(shorter)) return false;
    const remainder = longer.slice(shorter.length).trim();
    if (remainder === '') return true;
    const tail = remainder.replace(/^(V|VOY|VOYAGE)\s*/i, '');
    return voyage !== '' && normalizeId(tail) === normalizeId(voyage);
  };
}

// ----------------------------------------------------------------- building

function buildHeader(input: BuildInput, decisions: PackageDecisions, conflicts: Conflict[]): PackageHeader {
  const invoice = input.invoice ?? null;
  const shipment = input.shipment ?? null;
  const source = commercialSourceOf(input.commercialSource);

  const booking = reconcile(
    'bookingReference',
    'Booking reference',
    shipment ? fromDeckhand(shipment.bookingReference, 'Deckhand') : missing(),
    fromInvoice(invoice, 'bookingNumber', source),
    sameId,
    true,
    decisions,
    'deckhand',
  );
  if (booking.conflict) conflicts.push(booking.conflict);

  const voyage = shipment ? fromDeckhand(shipment.voyage, 'Deckhand') : missing();
  const vessel = reconcile(
    'vessel',
    'Vessel',
    shipment ? fromDeckhand(shipment.vessel, 'Deckhand') : missing(),
    fromInvoice(invoice, 'vessel', source),
    vesselAgrees(voyage.value),
    true,
    decisions,
    'deckhand',
  );
  if (vessel.conflict) conflicts.push(vessel.conflict);

  const shipmentReference = shipment && shipment.shipmentReference.value !== null
    ? fromDeckhand(shipment.shipmentReference, 'Deckhand')
    : fromInvoice(invoice, 'invoiceNumber', source);

  const totals = invoice ? totalsOf(invoice.commodities) : null;

  const header: PackageHeader = {
    bookingReference: booking.value,
    shipmentReference,
    vessel: vessel.value,
    voyage,
    portOfLoading: shipment ? fromDeckhand(shipment.portOfLoading, 'Deckhand') : missing(),
    portOfDischarge: shipment ? fromDeckhand(shipment.portOfDischarge, 'Deckhand') : missing(),
    carrier: fromInvoice(invoice, 'carrier', source),
    invoiceNumber: fromInvoice(invoice, 'invoiceNumber', source),
    invoiceDate: fromInvoice(invoice, 'invoiceDate', source),
    customerName: fromInvoice(invoice, 'customerName', source),
    consigneeAddress1: fromInvoice(invoice, 'billTo', source),
    consigneeAddress2: fromInvoice(invoice, 'billToAddress2', source),
    consigneeCity: fromInvoice(invoice, 'billToCity', source),
    consigneeState: fromInvoice(invoice, 'billToState', source),
    consigneePostalCode: fromInvoice(invoice, 'billToPostalCode', source),
    consigneeCountry: fromInvoice(invoice, 'billToCountry', source),
    poNumber: fromInvoice(invoice, 'poNumber', source),
    freightTerms: fromInvoice(invoice, 'freightTerms', source),
    paymentTerms: fromInvoice(invoice, 'paymentTerms', source),
    destinationCountry: fromInvoice(invoice, 'destination', source),
    totalValue: totals && totals.value !== null ? derived(numberText(totals.value, 2), `sum of ${totals.lines} line value(s)`) : missing(),
    totalWeightKg: totals && totals.weight !== null ? derived(numberText(totals.weight, 0), `sum of ${totals.lines} line weight(s), kg`) : missing(),
  };

  for (const field of PACKAGE_HEADER_FIELDS) {
    const typed = decisions.manualHeader[field];
    if (typed !== undefined && typed.trim() !== '') header[field] = manual(typed.trim());
  }
  return header;
}

function totalsOf(commodities: CanonicalCommodity[]): { value: number | null; weight: number | null; lines: number } {
  const values = commodities.map((line) => line.valueOfGoods).filter((value): value is number => value !== null);
  const weights = commodities.map((line) => line.shippingWeight).filter((value): value is number => value !== null);
  return {
    value: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
    weight: weights.length ? weights.reduce((sum, value) => sum + value, 0) : null,
    lines: commodities.length,
  };
}

function hsCodeOf(scheduleB: Provenanced): Provenanced {
  if (scheduleB.value === '') return missing();
  const digits = scheduleBDigits(scheduleB.value);
  if (digits.length < 6) return missing('Schedule B has fewer than 6 digits');
  return derived(`${digits.slice(0, 4)}.${digits.slice(4, 6)}`, 'first six digits of the Schedule B number', scheduleB.value);
}

function buildCargo(invoice: CanonicalShipment | null, source: ValueSource): PackageCargoLine[] {
  if (!invoice) return [];
  return invoice.commodities.map((line) => {
    const record = invoice.provenance.commodities[line.line] ?? {};
    const cell = (field: keyof CanonicalCommodity, value: string): Provenanced =>
      value === '' ? missing() : withProvenance(value, source, record[field], field);
    const scheduleB = cell('scheduleB', line.scheduleB);
    return {
      line: line.line,
      description: cell('description', line.description),
      scheduleB,
      hsCode: hsCodeOf(scheduleB),
      quantity: cell('quantity1', numberText(line.quantity1)),
      uom: cell('uom1', line.uom1),
      valueOfGoods: cell('valueOfGoods', numberText(line.valueOfGoods)),
      weightKg: cell('shippingWeight', numberText(line.shippingWeight)),
      origin: cell('origin', line.origin),
      eccn: cell('eccn', line.eccn),
      licenseCode: cell('licenseCode', line.licenseCode),
      exportInformationCode: cell('exportInformationCode', line.exportInformationCode),
    };
  });
}

interface ContainerSeed {
  number: Provenanced;
  status: ContainerStatus;
  carrierSeal: Provenanced;
  shipperSeal: Provenanced;
}

function seedFromDeckhand(container: DeckhandContainer): ContainerSeed {
  const number = containerDisplay(container);
  const lines = container.lines.length ? `line ${container.lines.join(', ')}` : 'Deckhand';
  const seal = (field: DeckhandContainer['carrierSeal']): Provenanced => {
    if (container.sealConflict) return missing('two different seals in the document');
    if (!field) return missing(container.evidence === null ? 'not paired in the document' : undefined);
    return { value: field.raw, source: 'deckhand', detail: `${field.label ?? 'seal'}, ${lines}`, confidence: field.confidence };
  };
  return {
    number: { value: number, source: 'deckhand', detail: lines, confidence: container.containerNumber.confidence },
    status: container.containerNumber.status,
    carrierSeal: seal(container.carrierSeal),
    shipperSeal: seal(container.shipperSeal),
  };
}

function buildContainers(
  input: BuildInput,
  cargo: PackageCargoLine[],
  decisions: PackageDecisions,
  conflicts: Conflict[],
  notes: PackageNote[],
): PackageContainer[] {
  const invoice = input.invoice ?? null;
  const shipment = input.shipment ?? null;
  const source = commercialSourceOf(input.commercialSource);

  const invoiceContainer = fromInvoice(invoice, 'containerNumber', source);
  const invoiceSeal = fromInvoice(invoice, 'sealNumber', source);

  let seeds: ContainerSeed[] = [];
  const deckhandSeeds = shipment ? shipment.containers.map(seedFromDeckhand) : [];

  // "See Ocean B/L" in the accounting system's container field is the very
  // case Deckhand exists for: a placeholder, not a container number. It is
  // noted and set aside rather than raised as a conflict.
  const invoicePlaceholder = invoiceContainer.value !== '' && validateContainerNumber(invoiceContainer.value) === 'malformed';

  if (deckhandSeeds.length) {
    seeds = deckhandSeeds;
    if (invoicePlaceholder) {
      notes.push({
        severity: 'info',
        message: `The commercial data's container field reads "${invoiceContainer.value}", which is not a container number; the ${seeds.length} container(s) from the document are used${invoiceSeal.value !== '' ? ` and its seal field ("${invoiceSeal.value}") is set aside` : ''}.`,
      });
    } else if (invoiceContainer.value !== '') {
      const match = seeds.find((seed) => sameId(seed.number.value, invoiceContainer.value));
      if (match) {
        match.number = { ...match.number, confirmedBy: invoiceContainer.source };
        if (invoiceSeal.value !== '') {
          const reconciled = reconcile('carrierSeal', `Carrier seal of ${match.number.value}`, match.carrierSeal, invoiceSeal, sameId, true, decisions, 'deckhand', match.number.value);
          match.carrierSeal = reconciled.value;
          if (reconciled.conflict) conflicts.push(reconciled.conflict);
        }
      } else {
        const id = 'containers';
        const resolution = decisions.resolutions[id] ?? 'unresolved';
        conflicts.push({
          id,
          field: 'containers',
          material: true,
          commercialValue: invoiceContainer.value,
          deckhandValue: seeds.map((seed) => seed.number.value).join(', '),
          message: `Containers: the commercial data names ${invoiceContainer.value}, which is not among the ${seeds.length} container(s) in the document (${seeds.map((seed) => seed.number.value).join(', ')}).${
            resolution === 'unresolved' ? ' Choose one before filling.' : ` Following ${resolution === 'commercial' ? 'the commercial data' : 'the document'}.`
          }`,
          resolution,
        });
        if (resolution === 'commercial') {
          seeds = [{ number: invoiceContainer, status: validateContainerNumber(invoiceContainer.value), carrierSeal: invoiceSeal, shipperSeal: missing() }];
        }
      }
    }
  } else if (invoiceContainer.value !== '') {
    seeds = [{ number: invoiceContainer, status: validateContainerNumber(invoiceContainer.value), carrierSeal: invoiceSeal, shipperSeal: missing() }];
    if (seeds[0]!.status !== 'valid') {
      notes.push({ severity: 'warning', message: `Container ${invoiceContainer.value} from the commercial data ${seeds[0]!.status === 'invalid' ? 'fails its ISO 6346 check digit' : 'is not a container number format'}.` });
    }
  }

  // Cargo attribution. One container takes the whole invoice; several
  // containers with one line share that line's description; anything else
  // cannot be attributed without guessing and is left for the operator.
  const description = cargo.map((line) => line.description.value).filter((text) => text !== '');
  const hsCodes = [...new Set(cargo.map((line) => line.hsCode.value).filter((text) => text !== ''))];
  const totals = invoice ? totalsOf(invoice.commodities) : null;

  const containers = seeds.map((seed, index) => {
    let cargoDescription: Provenanced = missing();
    let hsCode: Provenanced = missing();
    let grossWeightKg: Provenanced = missing();

    if (cargo.length === 1) {
      cargoDescription = { ...(cargo[0] as PackageCargoLine).description };
      hsCode = { ...(cargo[0] as PackageCargoLine).hsCode };
    } else if (cargo.length > 1 && seeds.length === 1) {
      cargoDescription = derived(description.join('; '), `${cargo.length} invoice lines joined`);
      hsCode = hsCodes.length === 1 ? { ...(cargo[0] as PackageCargoLine).hsCode } : missing(`${hsCodes.length} different HS codes across the lines`);
    } else if (cargo.length > 1) {
      cargoDescription = missing(`${cargo.length} invoice lines across ${seeds.length} containers: attribute by hand`);
      hsCode = missing(`${cargo.length} invoice lines across ${seeds.length} containers: attribute by hand`);
    }

    if (totals && totals.weight !== null) {
      if (seeds.length === 1) grossWeightKg = derived(numberText(totals.weight, 0), 'total shipping weight of the invoice, kg');
      else grossWeightKg = missing(`the invoice weight (${formatWithSeparators(totals.weight)} kg) is a total across ${seeds.length} containers`);
    }

    const container: PackageContainer = {
      index,
      containerNumber: seed.number,
      status: seed.status,
      carrierSeal: seed.carrierSeal,
      shipperSeal: seed.shipperSeal,
      cargoDescription,
      hsCode,
      packageType: missing('not held by any source; enter it'),
      packageCount: missing('not held by any source; enter it'),
      grossWeightKg,
      marksAndNumbers: missing('not held by any source; enter it'),
    };

    const typed = decisions.manualContainers[index] ?? {};
    for (const field of PACKAGE_CONTAINER_FIELDS) {
      const value = typed[field];
      if (value !== undefined && value.trim() !== '') {
        container[field] = manual(value.trim());
        if (field === 'containerNumber') container.status = validateContainerNumber(value.trim());
      }
    }
    return container;
  });

  if (seeds.length > 1 && totals && totals.weight !== null) {
    notes.push({ severity: 'info', message: `The invoice weight (${formatWithSeparators(totals.weight)} kg) is a total; it was not split across the ${seeds.length} containers. Enter each container's gross weight from the packing list.` });
  }
  if (seeds.length > 1 && cargo.length > 1) {
    notes.push({ severity: 'warning', message: `${cargo.length} invoice lines and ${seeds.length} containers: which cargo is in which container is not in any source, so the cargo columns are left for you to fill.` });
  }
  return containers;
}

// ------------------------------------------------------------------- public

export function buildFilingPackage(input: BuildInput): FilingPackage {
  const invoice = input.invoice ?? null;
  const shipment = input.shipment ?? null;
  if (!invoice && !shipment) throw new FilingPackageError('A filing package needs commercial data, a Deckhand extraction, or both.');

  const decisions = input.decisions ?? emptyDecisions();
  const now = input.now ?? new Date();
  const conflicts: Conflict[] = [];
  const notes: PackageNote[] = [];

  const header = buildHeader(input, decisions, conflicts);
  const cargo = buildCargo(invoice, commercialSourceOf(input.commercialSource));
  const containers = buildContainers(input, cargo, decisions, conflicts, notes);

  const review: PackageReview = !shipment
    ? { deckhand: 'not-applicable', approvedAt: null }
    : input.deckhandApproved
      ? { deckhand: 'approved', approvedAt: input.approvedAt ?? now.toISOString() }
      : { deckhand: 'pending', approvedAt: null };

  if (shipment) {
    const deckhandReview = buildReview(shipment);
    for (const item of deckhandReview.blocking) notes.push({ severity: 'error', message: `Deckhand: ${item.message}` });
    if (review.deckhand === 'pending') notes.push({ severity: 'warning', message: 'The Deckhand extraction has not been approved yet. Review it and press Approve before filling.' });
  }
  if (!invoice) notes.push({ severity: 'info', message: 'No commercial data in this package: cargo, values, weights and the consignee are not available to fill.' });
  if (!shipment) notes.push({ severity: 'info', message: 'No Deckhand extraction in this package: booking, container and seal come from the commercial data alone.' });
  for (const conflict of conflicts) notes.push({ severity: conflict.resolution === 'unresolved' && conflict.material ? 'error' : 'warning', message: conflict.message });
  if (containers.length === 0) notes.push({ severity: 'warning', message: 'No containers in this package.' });

  const packageId = input.packageId ?? packageIdFor(header);

  return {
    schemaVersion: FILING_PACKAGE_SCHEMA_VERSION,
    packageId,
    createdAt: now.toISOString(),
    invoice,
    commercialSource: input.commercialSource ?? null,
    shipment,
    review,
    decisions,
    header,
    cargo,
    containers,
    conflicts,
    notes,
  };
}

export function packageIdFor(header: PackageHeader): string {
  const invoice = safeFileStem(header.invoiceNumber.value || null, '');
  const booking = safeFileStem(header.bookingReference.value || null, '');
  const parts = [invoice, booking].filter((part) => part !== '');
  return parts.length ? parts.join('_') : 'filing-package';
}

export function filingPackageFileName(pkg: FilingPackage): string {
  return `filing-package-${pkg.packageId}.json`;
}

/** Re-derive the merged values from the two halves and the decisions. */
export function rebuildFilingPackage(pkg: FilingPackage, changes: Partial<BuildInput> = {}): FilingPackage {
  return buildFilingPackage({
    invoice: pkg.invoice,
    commercialSource: pkg.commercialSource,
    shipment: pkg.shipment,
    deckhandApproved: pkg.review.deckhand === 'approved',
    approvedAt: pkg.review.approvedAt,
    decisions: pkg.decisions,
    now: new Date(pkg.createdAt),
    packageId: pkg.packageId,
    ...changes,
  });
}

/** The operator chose a side of a conflict. Returns a rebuilt package. */
export function resolveConflict(pkg: FilingPackage, conflictId: string, choice: 'commercial' | 'deckhand'): FilingPackage {
  if (!pkg.conflicts.some((conflict) => conflict.id === conflictId)) {
    throw new FilingPackageError(`No conflict "${conflictId}" in this package.`);
  }
  return rebuildFilingPackage(pkg, {
    decisions: { ...pkg.decisions, resolutions: { ...pkg.decisions.resolutions, [conflictId]: choice } },
  });
}

/** The operator typed a header value. Empty text removes the manual value. */
export function setManualHeader(pkg: FilingPackage, field: PackageHeaderField, value: string): FilingPackage {
  const manualHeader = { ...pkg.decisions.manualHeader };
  if (value.trim() === '') delete manualHeader[field];
  else manualHeader[field] = value.trim();
  return rebuildFilingPackage(pkg, { decisions: { ...pkg.decisions, manualHeader } });
}

export function setManualContainer(pkg: FilingPackage, index: number, field: PackageContainer['index'] extends number ? Exclude<keyof PackageContainer, 'index' | 'status'> : never, value: string): FilingPackage {
  const manualContainers = { ...pkg.decisions.manualContainers };
  const entry = { ...(manualContainers[index] ?? {}) };
  if (value.trim() === '') delete entry[field];
  else entry[field] = value.trim();
  manualContainers[index] = entry;
  return rebuildFilingPackage(pkg, { decisions: { ...pkg.decisions, manualContainers } });
}

/** The Deckhand half was reviewed and approved. Throws when the review has blocking problems. */
export function approveDeckhand(pkg: FilingPackage, now: Date = new Date()): FilingPackage {
  if (!pkg.shipment) throw new FilingPackageError('This package has no Deckhand extraction to approve.');
  const review = buildReview(pkg.shipment);
  if (!review.canApprove) throw new FilingPackageError(`Cannot approve: ${review.blocking.map((item) => item.message).join(' ')}`);
  return rebuildFilingPackage(pkg, { deckhandApproved: true, approvedAt: now.toISOString() });
}

export interface FillGate {
  ok: boolean;
  reasons: string[];
}

/**
 * Whether a destination may fill from this package. Blocked while the
 * Deckhand half is unreviewed or a material conflict is unresolved. Missing
 * values never block: they are filled by hand.
 */
export function fillGate(pkg: FilingPackage): FillGate {
  const reasons: string[] = [];
  if (pkg.review.deckhand === 'pending') reasons.push('The Deckhand extraction has not been approved.');
  for (const conflict of pkg.conflicts) {
    if (conflict.material && conflict.resolution === 'unresolved') reasons.push(conflict.message);
  }
  for (const container of pkg.containers) {
    if (container.status === 'invalid') reasons.push(`Container ${container.containerNumber.value} fails its ISO 6346 check digit.`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Container numbers as the destination will type them, normalized where they are valid. */
export function normalizedContainerNumber(container: PackageContainer): string {
  return normalizeContainerNumber(container.containerNumber.value) ?? container.containerNumber.value;
}
