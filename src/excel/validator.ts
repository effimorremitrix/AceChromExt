/**
 * Validation over the canonical model.
 *
 * Severity drives the traffic lights in the preview:
 *   error   -> red    : cannot be filed as imported; the field is not written.
 *   warning -> yellow : missing, uncertain, or transformed; written, flagged.
 *   (none)  -> green  : mapped and plausible.
 *
 * These are *plausibility* checks against the shape of an AES filing. They are
 * not a substitute for ACE's own validation, and the extension never suppresses
 * or works around an ACE error message.
 */

import type { CanonicalShipment } from '../models/CanonicalInvoice.js';
import { isKnownUom, scheduleBDigits, US_STATE_CODES } from '../ace/transformers/codes.js';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  scope: 'shipment' | 'commodity';
  /** Canonical field name, e.g. 'scheduleB'. */
  field: string;
  /** Human label used in the UI. */
  label: string;
  message: string;
  /** Commodity line number, when scope is 'commodity'. */
  line?: number;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  errors: number;
  warnings: number;
  /** Lines with at least one error. Fill is still allowed; those fields are skipped. */
  linesWithErrors: number[];
}

function issue(
  severity: IssueSeverity,
  scope: 'shipment' | 'commodity',
  field: string,
  label: string,
  message: string,
  line?: number,
): ValidationIssue {
  return { severity, scope, field, label, message, ...(line === undefined ? {} : { line }) };
}

export function validateShipment(shipment: CanonicalShipment): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { invoice, commodities } = shipment;

  // ---- shipment level ----------------------------------------------------
  if (invoice.invoiceNumber.trim() === '') {
    issues.push(issue('warning', 'shipment', 'invoiceNumber', 'Invoice Number', 'No invoice number; the ACE shipment reference will have to be typed.'));
  } else if (invoice.invoiceNumber.length > 17) {
    issues.push(issue('warning', 'shipment', 'invoiceNumber', 'Invoice Number', `Invoice number is ${invoice.invoiceNumber.length} characters; ACE shipment references are limited to 17 and it will be truncated.`));
  }

  if (invoice.invoiceDate.trim() === '') {
    issues.push(issue('warning', 'shipment', 'invoiceDate', 'Invoice Date', 'No invoice/export date.'));
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.invoiceDate)) {
    issues.push(issue('error', 'shipment', 'invoiceDate', 'Invoice Date', `Date "${invoice.invoiceDate}" could not be normalized.`));
  }

  if (invoice.paymentDueDate.trim() !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(invoice.paymentDueDate)) {
    issues.push(issue('error', 'shipment', 'paymentDueDate', 'Payment Due Date', `Date "${invoice.paymentDueDate}" could not be normalized.`));
  }

  if (invoice.customerName.trim() === '') {
    issues.push(issue('warning', 'shipment', 'customerName', 'Customer Name', 'No customer/consignee name.'));
  }

  if (invoice.destination.trim() === '') {
    issues.push(issue('warning', 'shipment', 'destination', 'Destination', 'No country of ultimate destination.'));
  } else if (!/^[A-Z]{2}$/.test(invoice.destination)) {
    issues.push(issue('warning', 'shipment', 'destination', 'Destination', `Destination "${invoice.destination}" is not a two-letter ISO country code.`));
  }

  // ACE Step 1 Origin State: the US state the goods come from, not the state
  // of the export port. Almonds railed from northern California to Norfolk are
  // CA, not VA, so a wrong-but-plausible value here is invisible on screen and
  // worth flagging before the fill.
  if (invoice.originState.trim() === '') {
    issues.push(issue('warning', 'shipment', 'originState', 'Origin State', 'No origin state. ACE Step 1 requires the US state the goods come from.'));
  } else if (!US_STATE_CODES.has(invoice.originState)) {
    issues.push(
      issue(
        'warning',
        'shipment',
        'originState',
        'Origin State',
        `Origin State "${invoice.originState}" is not a US state code. ACE expects a two-letter code such as CA or TX.`,
      ),
    );
  }

  // The Carrier column feeds ACE's "Carrier SCAC/IATA" box, whose live value
  // is the 4-letter SCAC "MSCU". A full carrier name is the likeliest thing to
  // find in a spreadsheet and the likeliest thing for ACE to reject.
  const carrier = invoice.carrier.trim();
  if (carrier !== '' && !/^[A-Za-z0-9]{2,4}$/.test(carrier)) {
    issues.push(
      issue(
        'warning',
        'shipment',
        'carrier',
        'Carrier',
        `Carrier "${invoice.carrier}" is not a SCAC or IATA code. ACE Step 4 asks for a code such as MSCU, not a carrier name.`,
      ),
    );
  }

  if (invoice.containerNumber.trim() !== '' && !/^[A-Z]{4}\d{6,7}$/.test(invoice.containerNumber.replace(/[\s-]/g, ''))) {
    issues.push(issue('warning', 'shipment', 'containerNumber', 'Container Number', `Container "${invoice.containerNumber}" does not match the ISO 6346 pattern (4 letters + 7 digits).`));
  }

  // Columns the sheet carried that the dictionary did not recognise. Not an
  // error - people add their own columns - but it is the usual explanation for
  // "why is that field blank?", so it is said out loud rather than buried in
  // the import notes.
  for (const header of shipment.source.unknownHeaders) {
    issues.push(
      issue(
        'warning',
        'shipment',
        'unmappedColumns',
        'Unmapped Column',
        `Column "${header}" is not a recognised ACE field and was ignored. Rename it to a template column if it should be filed.`,
      ),
    );
  }

  // ---- commodity lines ---------------------------------------------------
  if (!commodities.length) {
    issues.push(issue('error', 'shipment', 'commodities', 'Commodity Lines', 'The import produced no commodity lines.'));
  }

  const seenLines = new Set<number>();

  for (const commodity of commodities) {
    const line = commodity.line;

    if (seenLines.has(line)) {
      issues.push(issue('error', 'commodity', 'line', 'Line', `Line ${line} appears more than once.`, line));
    }
    seenLines.add(line);

    const digits = scheduleBDigits(commodity.scheduleB);
    if (commodity.scheduleB.trim() === '') {
      issues.push(issue('error', 'commodity', 'scheduleB', 'Schedule B', 'Schedule B / HTS number is required.', line));
    } else if (digits.length !== 10) {
      issues.push(issue('error', 'commodity', 'scheduleB', 'Schedule B', `"${commodity.scheduleB}" has ${digits.length} digits; ACE requires 10.`, line));
    }

    if (commodity.description.trim() === '') {
      issues.push(issue('error', 'commodity', 'description', 'Description', 'Commodity description is required.', line));
    } else if (commodity.description.length > 45) {
      issues.push(issue('warning', 'commodity', 'description', 'Description', `Description is ${commodity.description.length} characters and will be truncated to 45 for ACE.`, line));
    }

    if (commodity.quantity1 === null) {
      issues.push(issue('error', 'commodity', 'quantity1', 'Quantity 1', 'Quantity 1 is required.', line));
    } else if (commodity.quantity1 <= 0) {
      issues.push(issue('error', 'commodity', 'quantity1', 'Quantity 1', `Quantity 1 is ${commodity.quantity1}; it must be greater than zero.`, line));
    }

    if (commodity.uom1.trim() === '') {
      issues.push(issue('error', 'commodity', 'uom1', 'UOM 1', 'Unit of measure 1 is required.', line));
    } else if (!isKnownUom(commodity.uom1)) {
      issues.push(
        issue(
          'warning',
          'commodity',
          'uom1',
          'UOM 1',
          `Unit of measure "${commodity.uom1}" is not one ACE normally accepts. Confirm it matches the Schedule B unit.`,
          line,
        ),
      );
    }

    if (commodity.uom2.trim() !== '' && !isKnownUom(commodity.uom2)) {
      issues.push(
        issue(
          'warning',
          'commodity',
          'uom2',
          'UOM 2',
          `Unit of measure "${commodity.uom2}" is not one ACE normally accepts. Confirm it matches the Schedule B second unit.`,
          line,
        ),
      );
    }

    if (commodity.quantity2 !== null && commodity.uom2.trim() === '') {
      issues.push(issue('warning', 'commodity', 'uom2', 'UOM 2', 'Quantity 2 was given without a unit of measure 2.', line));
    }
    if (commodity.quantity2 === null && commodity.uom2.trim() !== '') {
      issues.push(issue('warning', 'commodity', 'quantity2', 'Quantity 2', 'Unit of measure 2 was given without a quantity 2.', line));
    }

    if (commodity.origin.trim() === '') {
      issues.push(issue('warning', 'commodity', 'origin', 'Origin', 'No origin indicator; ACE requires D (domestic) or F (foreign).', line));
    } else if (commodity.origin !== 'D' && commodity.origin !== 'F') {
      issues.push(issue('warning', 'commodity', 'origin', 'Origin', `Origin "${commodity.origin}" is not D or F. Confirm the ACE value.`, line));
    }

    if (commodity.valueOfGoods === null) {
      issues.push(issue('error', 'commodity', 'valueOfGoods', 'Value of Goods', 'Value of goods is required.', line));
    } else if (commodity.valueOfGoods < 0) {
      // A credit memo or a returns line reaching an export filing is a data
      // problem, not something to round up: AES has no negative value.
      issues.push(issue('error', 'commodity', 'valueOfGoods', 'Value of Goods', `Value is ${commodity.valueOfGoods}. AES has no negative value; check whether this line is a credit.`, line));
    } else if (commodity.valueOfGoods === 0) {
      issues.push(issue('warning', 'commodity', 'valueOfGoods', 'Value of Goods', 'Value is zero. AES expects a positive value.', line));
    }

    if (commodity.shippingWeight === null) {
      issues.push(issue('error', 'commodity', 'shippingWeight', 'Shipping Weight', 'Shipping weight is required.', line));
    } else if (commodity.shippingWeight < 0) {
      issues.push(issue('error', 'commodity', 'shippingWeight', 'Shipping Weight', `Shipping weight is ${commodity.shippingWeight} kg. A weight cannot be negative.`, line));
    } else if (commodity.shippingWeight === 0) {
      issues.push(issue('warning', 'commodity', 'shippingWeight', 'Shipping Weight', 'Shipping weight is zero. ACE will reject a zero shipping weight.', line));
    }

    if (commodity.licenseCode.trim() === '') {
      issues.push(issue('warning', 'commodity', 'licenseCode', 'License Code', 'No licence code / exemption. AES requires one per line.', line));
    }

    if (commodity.eccn.trim() !== '' && !/^(\d[A-Z]\d{3}|EAR99)/.test(commodity.eccn)) {
      issues.push(issue('warning', 'commodity', 'eccn', 'ECCN', `ECCN "${commodity.eccn}" does not look like #A### or EAR99.`, line));
    }
  }

  const errors = issues.filter((item) => item.severity === 'error').length;
  const warnings = issues.length - errors;
  const linesWithErrors = [
    ...new Set(issues.filter((item) => item.severity === 'error' && item.line !== undefined).map((item) => item.line as number)),
  ].sort((a, b) => a - b);

  return { issues, errors, warnings, linesWithErrors };
}

/** Traffic-light status for one canonical field, used by the preview. */
export type FieldStatus = 'green' | 'yellow' | 'red';

export function statusForField(
  issues: ValidationIssue[],
  field: string,
  line: number | undefined,
  wasTransformed: boolean,
): FieldStatus {
  const relevant = issues.filter((item) => item.field === field && item.line === line);
  if (relevant.some((item) => item.severity === 'error')) return 'red';
  if (relevant.length > 0 || wasTransformed) return 'yellow';
  return 'green';
}
