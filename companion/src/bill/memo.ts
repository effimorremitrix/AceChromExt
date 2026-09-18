/**
 * Memo templates for the vendor bill.
 *
 * A template is plain text with `{placeholder}` slots, e.g.
 * `{quantity} {description} to {customerShortName}`. The set of placeholders
 * is fixed and small, and an unknown one is a configuration error rather than
 * something silently left in the memo: a bill memo that reads "{custmer}" is
 * the kind of mistake that survives until an auditor asks.
 *
 * This module has no imports so both `config.ts` (validation) and
 * `bill/billPlan.ts` (rendering) can use it without a cycle.
 */

export const MEMO_PLACEHOLDERS = [
  'quantity',
  'description',
  'item',
  'unitOfMeasure',
  'customerName',
  'customerShortName',
  'refNumber',
  'rate',
  'ratePercent',
] as const;

export type MemoPlaceholder = (typeof MEMO_PLACEHOLDERS)[number];

export class MemoTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoTemplateError';
  }
}

const PLACEHOLDER = /\{([^{}]*)\}/g;

/** Every `{name}` in the template, in order, unknown ones included. */
export function memoPlaceholdersIn(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) names.push(match[1] as string);
  return names;
}

/** Throw unless every placeholder is one of `MEMO_PLACEHOLDERS`. `where` names the config key. */
export function assertMemoTemplate(template: string, where: string): void {
  for (const name of memoPlaceholdersIn(template)) {
    if (!(MEMO_PLACEHOLDERS as readonly string[]).includes(name)) {
      throw new MemoTemplateError(
        `${where} uses {${name}}, which is not a placeholder. Valid placeholders: ${MEMO_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}.`,
      );
    }
  }
}

/**
 * Fill a template. Whitespace is collapsed afterwards so a blank placeholder
 * (an invoice line with no quantity) does not leave a double space behind.
 */
export function renderMemo(template: string, vars: Partial<Record<MemoPlaceholder, string>>): string {
  assertMemoTemplate(template, 'The memo template');
  const filled = template.replace(PLACEHOLDER, (_whole, name: string) => vars[name as MemoPlaceholder] ?? '');
  return filled.replace(/\s+/g, ' ').trim();
}
