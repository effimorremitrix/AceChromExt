/**
 * Source-neutral types for "a canonical shipment, and where each value came
 * from". QuickBooks is the first producer; a second one (a different
 * accounting system, a customer's ERP) implements the same adapter interface
 * and fills in the same records.
 */

import type { CanonicalShipment } from '../../../src/models/CanonicalInvoice.js';
import type { MapperNote } from '../../../src/excel/canonicalMapper.js';

/**
 * Where a canonical value came from.
 *
 * An ACE filing is a legal declaration, so "the accounting system told me",
 * "I worked it out" and "a human typed it" must not look alike in the preview
 * or the audit trail.
 */
export type FieldOrigin =
  /** A built-in field of the source system: RefNumber, TxnDate, FOB, Amount. */
  | 'quickbooks'
  /** A user-defined custom field the configuration mapped. */
  | 'custom-field'
  /** Computed from source values: a unit conversion, a quantity x rate. */
  | 'derived'
  /** Supplied by the operator: configuration, item profile, or --set. */
  | 'manual'
  /** A configured fallback, used because nothing else supplied the field. */
  | 'default'
  /** Nothing supplied it. The field is blank and validation will say so. */
  | 'missing';

export interface FieldSource {
  origin: FieldOrigin;
  /** Where exactly: "InvoiceRet/FOB", 'custom field "Vessel"', 'items."X".scheduleB'. */
  source: string;
}

export interface OriginIndex {
  invoice: Record<string, FieldSource>;
  /** Keyed by commodity line number, then by canonical field name. */
  commodities: Record<number, Record<string, FieldSource>>;
}

export interface MappingNote extends MapperNote {
  /** Commodity line the note belongs to, when it is line-specific. */
  line?: number;
}

export interface CanonicalMapping {
  shipment: CanonicalShipment;
  origins: OriginIndex;
  notes: MappingNote[];
  /** Custom fields the source returned that no configuration entry claimed. */
  unmappedCustomFields: string[];
}

/** Origins that mean "a human is responsible for this value, not the data". */
export const OPERATOR_ORIGINS: FieldOrigin[] = ['manual', 'default'];
