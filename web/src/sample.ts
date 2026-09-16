/**
 * The sample shipment behind "Load sample shipment": a synthetic commercial
 * invoice (as a filing package with no Deckhand half) and a synthetic carrier
 * booking email, bundled at build time exactly as the guides in guides.ts
 * are. Nothing is fetched at runtime, which the page's CSP would refuse
 * anyway.
 *
 * Every name, number and domain in web/samples/ is made up (`.example`
 * domains, SAMPLE-prefixed identifiers). The record it produces is named as
 * sample data so it can never be mistaken for a real filing.
 */

import sampleInvoicePackage from '../samples/sample-invoice.filing-package.json?raw';
import sampleBookingEmail from '../samples/sample-booking-email.eml?raw';

export interface SampleShipment {
  /** What the record is called on screen. Says "sample" so it is never mistaken for a real filing. */
  name: string;
  /** The file name the invoice is reported as imported from. */
  packageFileName: string;
  /** A filing package carrying the commercial half only (`shipment: null`). */
  packageText: string;
  /** A sanitized carrier booking confirmation, ready for Deckhand's email box. */
  emailText: string;
}

export const SAMPLE_SHIPMENT: SampleShipment = {
  name: 'SAMPLE shipment (not a filing)',
  packageFileName: 'sample-invoice.filing-package.json',
  packageText: sampleInvoicePackage,
  emailText: sampleBookingEmail,
};
