/** Typed message protocol between the popup/panel, the background worker, and the content script. */

import type { AcePageId, FieldDetection, FillReport } from '../models/AceField.js';
import type { CanonicalShipment } from '../models/CanonicalInvoice.js';
import type { AceHelperSettings } from './settings.js';
import type { ValidationResult } from '../excel/validator.js';
import type { PageDetection } from '../content/pageDetector.js';
import type { SourceDescriptor } from '../sources/InvoiceDataSource.js';
import type { SessionLogEntry, SessionLogKind } from './sessionLog.js';
import type { DeckhandShipment } from '../../deckhand/src/model.js';
import type { FilingPackage } from '../../shared/src/filingPackage.js';

export interface StoredImport {
  shipment: CanonicalShipment;
  validation: ValidationResult;
  notes: Array<{ severity: 'info' | 'warning' | 'error'; message: string; sheetRow?: number; column?: string }>;
  /** Line the user has selected for "Fill Current Commodity Line". */
  selectedLine: number;
  /**
   * Which InvoiceDataSource produced this. Optional so a payload stored by a
   * Phase 1/2 build still loads after an upgrade.
   */
  source?: SourceDescriptor;
  /**
   * The Deckhand extraction the operator is working on, and when it was
   * approved. Optional: the ACE workflow never needs it.
   */
  deckhand?: { shipment: DeckhandShipment; approvedAt: string | null } | null;
  /** The filing package built from the shipment above and the Deckhand extraction. Optional, for the same reason. */
  package?: FilingPackage | null;
}

// ---- popup/panel -> background ------------------------------------------
export type BackgroundRequest =
  | { type: 'store/get' }
  | { type: 'store/set'; payload: StoredImport }
  | { type: 'store/selectLine'; line: number }
  | { type: 'store/clear' }
  | { type: 'log/append'; kind: SessionLogKind; message: string; detail?: string }
  | { type: 'log/get' }
  | { type: 'log/clear' };

export type BackgroundResponse =
  | { ok: true; type: 'store/data'; payload: StoredImport | null }
  | { ok: true; type: 'store/cleared' }
  | { ok: true; type: 'log/data'; payload: SessionLogEntry[] }
  | { ok: true; type: 'log/ok' }
  | { ok: false; error: string };

// ---- popup/panel -> content script --------------------------------------
export type ContentRequest =
  | { type: 'content/ping' }
  | { type: 'content/detectPage' }
  | { type: 'content/diagnostics'; page?: AcePageId }
  | {
      type: 'content/fill';
      scope: 'shipment' | 'commodityLine';
      line?: number;
      shipment: CanonicalShipment;
      settings: AceHelperSettings;
      dryRun?: boolean;
      overwrite?: boolean;
    }
  | { type: 'content/revealField'; key: string }
  | { type: 'content/clearHighlights' };

export interface DiagnosticsSnapshot {
  page: PageDetection;
  url: string;
  fields: Array<{
    key: string;
    label: string;
    scope: 'shipment' | 'commodityLine';
    verificationStatus: 'verified' | 'placeholder';
    detection: Omit<FieldDetection, 'element'>;
    devtoolsHint?: string;
  }>;
  generatedAt: string;
  /** Which operator-captured selectors were in force for this snapshot. */
  overrides: {
    capturedAt: string;
    fieldKeys: string[];
    /** Override keys that match no mapping on this page. */
    unknownKeys: string[];
  };
}

export type ContentResponse =
  | { ok: true; type: 'content/pong'; version: string }
  | { ok: true; type: 'content/page'; payload: PageDetection }
  | { ok: true; type: 'content/diagnostics'; payload: DiagnosticsSnapshot }
  | { ok: true; type: 'content/fillReport'; payload: FillReport }
  | { ok: true; type: 'content/revealed'; found: boolean }
  | { ok: true; type: 'content/ok' }
  | { ok: false; error: string };

export const CONTENT_NOT_READY =
  'The ACE page has not loaded the helper yet. Open an ACE filing page and reload it, then try again.';
