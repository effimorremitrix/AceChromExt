/** Typed message protocol between the popup/panel, the background worker, and the content script. */

import type { FieldDetection } from '../../../src/models/AceField.js';
import type { SessionLogEntry, SessionLogKind } from '../../../src/core/sessionLog.js';
import type { FilingPackage } from '../../../shared/src/filingPackage.js';
import type { InttraFieldScope, InttraFillReport } from '../models/InttraField.js';
import type { InttraPageDetection } from '../content/pageDetector.js';
import type { GridDetection, GridFillReport } from '../content/gridWriter.js';
import type { StoredPackage } from './store.js';

export type InttraBackgroundRequest =
  | { type: 'store/get' }
  | { type: 'store/set'; payload: StoredPackage }
  | { type: 'store/clear' }
  | { type: 'log/append'; kind: SessionLogKind; message: string; detail?: string }
  | { type: 'log/get' }
  | { type: 'log/clear' };

export type InttraBackgroundResponse =
  | { ok: true; type: 'store/data'; payload: StoredPackage }
  | { ok: true; type: 'store/cleared' }
  | { ok: true; type: 'log/data'; payload: SessionLogEntry[] }
  | { ok: true; type: 'log/ok' }
  | { ok: false; error: string };

export type InttraContentRequest =
  | { type: 'content/ping' }
  | { type: 'content/detectPage' }
  | { type: 'content/diagnostics' }
  | { type: 'content/fill'; scope: InttraFieldScope; containerIndex?: number; package: FilingPackage; dryRun?: boolean; overwrite?: boolean }
  | { type: 'content/fillGrid'; package: FilingPackage; dryRun?: boolean; overwrite?: boolean; anyPage?: boolean }
  | { type: 'content/revealField'; key: string }
  | { type: 'content/clearHighlights' };

export interface InttraDiagnosticsSnapshot {
  page: InttraPageDetection;
  url: string;
  fields: Array<{
    key: string;
    label: string;
    scope: InttraFieldScope;
    verificationStatus: 'verified' | 'placeholder';
    detection: Omit<FieldDetection, 'element' | 'unwritableElement'>;
    devtoolsHint?: string;
  }>;
  grid: GridDetection;
  generatedAt: string;
  overrides: { capturedAt: string; fieldKeys: string[]; unknownKeys: string[] };
}

export type InttraContentResponse =
  | { ok: true; type: 'content/pong'; version: string }
  | { ok: true; type: 'content/page'; payload: InttraPageDetection }
  | { ok: true; type: 'content/diagnostics'; payload: InttraDiagnosticsSnapshot }
  | { ok: true; type: 'content/fillReport'; payload: InttraFillReport }
  | { ok: true; type: 'content/gridReport'; payload: GridFillReport }
  | { ok: true; type: 'content/revealed'; found: boolean }
  | { ok: true; type: 'content/ok' }
  | { ok: false; error: string };

export const INTTRA_CONTENT_NOT_READY =
  'The INTTRA page has not loaded the helper yet. Open an INTTRA Shipping Instructions screen and reload it, then try again.';
