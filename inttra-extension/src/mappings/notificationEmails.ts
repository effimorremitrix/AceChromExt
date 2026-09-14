/**
 * Notification Emails: who INTTRA tells when the SI moves. No source in the
 * package holds this, and the helper never invents an address, so there is
 * nothing to fill. The page is detected so Fill Current Page can say so
 * rather than doing nothing silently.
 */

import type { InttraFieldMapping } from '../models/InttraField.js';

export const NOTIFICATION_EMAILS_FIELDS: InttraFieldMapping[] = [];

export const NOTIFICATION_EMAILS_NOTE =
  'Notification Emails: no filing-package field feeds this screen. The addresses are yours to enter; the helper never invents one.';
