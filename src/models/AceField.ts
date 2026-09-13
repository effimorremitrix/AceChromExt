/**
 * Declarative description of an ACE form field.
 *
 * IMPORTANT: selectors in src/ace/mappings/* are *candidates*, tried in
 * priority order by src/content/fieldDetector.ts. A candidate carries a
 * `verified` flag which is true ONLY when the selector was captured from the
 * real ACE DOM. Unverified candidates are still tried, but a field whose match
 * came from an unverified candidate is reported with reduced confidence, and a
 * field with no match is never written to.
 */

export type AcePageId = 'shipment' | 'parties' | 'commodities' | 'transportation' | 'unknown';

/** Where the value lives in the canonical model. */
export type AceFieldScope = 'shipment' | 'commodityLine';

export type AceFieldType = 'text' | 'number' | 'date' | 'select' | 'code';

/** How a selector candidate finds its element. Ordered by trustworthiness. */
export type SelectorStrategy =
  /** 1. Exact, verified id or name attribute. */
  | 'id'
  | 'name'
  /** 2. Other stable attributes (data-*, aria-label, ng-reflect-name, ...). */
  | 'attribute'
  /** 3. Associated <label> text. */
  | 'label'
  /** 4. Nearby DOM structure: first control inside a named container. */
  | 'nearby'
  /** Placeholder text. Weakest; only used as a last resort. */
  | 'placeholder';

export interface AceSelectorCandidate {
  strategy: SelectorStrategy;
  /** CSS selector. Required for id/name/attribute/nearby strategies. */
  selector?: string;
  /** Label text(s) to match, case-insensitive, punctuation-insensitive. */
  labelText?: string[];
  /** For 'nearby': the control to pick inside the container. Defaults to the first enabled control. */
  within?: string;
  /** For 'placeholder': placeholder text to match. */
  placeholder?: string;
  /** True only if captured from the live ACE DOM and checked in. */
  verified: boolean;
  note?: string;
}

export interface AceFieldMapping {
  /** Stable logical key. Shown in diagnostics and warnings. */
  key: string;
  /** Human label used in the preview and summary. */
  label: string;
  page: AcePageId;
  scope: AceFieldScope;
  /**
   * Dotted path into the canonical model.
   * 'shipment' scope reads `invoice.<field>`; 'commodityLine' reads `commodity.<field>`.
   */
  source: string;
  type: AceFieldType;
  /** Named transformers from src/ace/transformers, applied in order. */
  transforms?: string[];
  /** ACE rejects longer values; the filler truncates and warns. */
  maxLength?: number;
  /** A warning (never a hard failure) is raised when the source value is empty. */
  expected?: boolean;
  candidates: AceSelectorCandidate[];
  /**
   * 'verified'    - at least one candidate was captured from live ACE.
   * 'placeholder' - nothing here has been confirmed against live ACE yet.
   */
  verificationStatus: 'verified' | 'placeholder';
  /** Exactly what to capture from ACE DevTools to verify this field. */
  devtoolsHint?: string;
}

export type DetectionStatus = 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS' | 'NOT_WRITABLE';

export interface FieldDetection {
  key: string;
  label: string;
  status: DetectionStatus;
  element: HTMLElement | null;
  /** Which strategy matched. */
  matchedBy: SelectorStrategy | null;
  /** The selector or label text that matched, for diagnostics. */
  matchedWith: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** Everything tried, in order, for the diagnostics panel. */
  attempts: Array<{ strategy: SelectorStrategy; query: string; matches: number; verified: boolean }>;
  /** Populated when the same query matched several visible controls. */
  ambiguousCount?: number;
}

export type FillStatus = 'filled' | 'transformed' | 'skipped' | 'warning' | 'error';

export interface FillOutcome {
  key: string;
  label: string;
  status: FillStatus;
  /**
   * Dotted canonical path the value came from, e.g. 'commodity.shippingWeight'.
   * Carried so the mapping status screen can show Source -> ACE Field without
   * re-deriving it from the mapping registry.
   */
  source?: string;
  /**
   * The selector that was used, or - when nothing matched - the first
   * candidate that was tried, so the screen always has something to show in
   * the "ACE Selector" column.
   */
  selector?: string;
  /** Value written into ACE (already transformed). */
  written?: string;
  /** Value as it appeared in the spreadsheet. */
  original?: string;
  /** Human-readable transformation description. */
  transform?: string | null;
  message?: string;
  matchedWith?: string | null;
  confidence?: FieldDetection['confidence'];
}

export interface FillReport {
  page: AcePageId;
  scope: AceFieldScope;
  /** Commodity line number, when scope is 'commodityLine'. */
  line?: number;
  filled: number;
  skipped: number;
  warnings: number;
  errors: number;
  outcomes: FillOutcome[];
  startedAt: string;
}

export function emptyFillReport(page: AcePageId, scope: AceFieldScope, line?: number): FillReport {
  return {
    page,
    scope,
    ...(line === undefined ? {} : { line }),
    filled: 0,
    skipped: 0,
    warnings: 0,
    errors: 0,
    outcomes: [],
    startedAt: new Date().toISOString(),
  };
}

export function tallyReport(report: FillReport): FillReport {
  report.filled = report.outcomes.filter((o) => o.status === 'filled' || o.status === 'transformed').length;
  report.skipped = report.outcomes.filter((o) => o.status === 'skipped').length;
  report.warnings = report.outcomes.filter((o) => o.status === 'warning').length;
  report.errors = report.outcomes.filter((o) => o.status === 'error').length;
  return report;
}
