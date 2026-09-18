/**
 * The bill, as text, before anything is sent.
 *
 * Same discipline as the ACE preview in `ui/preview.ts`: every value, where
 * it came from, and the checks that ran, in the same order every time. Long
 * values are shown in full, never truncated, because this is the review gate.
 */

import type { BillChecks } from '../adapter/BillWriter.js';
import type { PreviewStyle } from '../ui/preview.js';
import { formatMoney, ratePercent, type BillPlan } from './billPlan.js';

function marks(style: PreviewStyle): { ok: string; warn: string; bad: string } {
  return style.ascii ? { ok: '[ok]', warn: '[! ]', bad: '[XX]' } : { ok: '✓', warn: '⚠', bad: '✗' };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

export function renderBillPreview(plan: BillPlan, checks: BillChecks | null, style: PreviewStyle = { ascii: false }): string {
  const mark = marks(style);
  const out: string[] = [];

  out.push(`Bill from invoice ${plan.refNumber} (TxnID ${plan.invoiceTxnId || '-'})`);
  const header: Array<[string, string, string]> = [
    ['Vendor', plan.vendor, plan.vendorSource],
    ['Date', plan.txnDate || '(blank)', 'invoice date'],
    ['Due', plan.dueDate || '(from terms)', plan.dueDate ? 'invoice due date' : 'QuickBooks derives it'],
    ['Terms', plan.terms, 'invoice terms'],
    ['Ref number', plan.refNumber, 'invoice number'],
    ['Customer', plan.customerShortName === plan.customerName ? plan.customerName : `${plan.customerName} (${plan.customerShortName})`, 'invoice customer'],
  ];
  if (plan.memo !== '') header.push(['Memo', plan.memo, 'bill.billMemoTemplate']);
  const labelWidth = Math.max(...header.map(([label]) => label.length));
  const valueWidth = Math.max(...header.map(([, value]) => value.length));
  for (const [label, value, source] of header) {
    out.push(`  ${pad(label, labelWidth)}  ${pad(value, valueWidth)}  [${source}]`);
  }

  out.push('');
  const rows: Array<[string, string, string, string]> = plan.lines.map((line) => [
    String(line.line),
    line.account,
    formatMoney(line.amount),
    line.memo,
  ]);
  if (plan.commission) {
    rows.push(['C', plan.commission.account, formatMoney(plan.commission.amount), plan.commission.memo]);
  }
  const accountWidth = Math.max('Account'.length, ...rows.map(([, account]) => account.length), 'Goods subtotal'.length);
  const amountWidth = Math.max('Amount'.length, ...rows.map(([, , amount]) => amount.length), formatMoney(plan.total).length);
  out.push(`  ${pad('#', 2)} ${pad('Account', accountWidth)}  ${padLeft('Amount', amountWidth)}  Memo`);
  for (const [n, account, amount, memo] of rows) {
    out.push(`  ${pad(n, 2)} ${pad(account, accountWidth)}  ${padLeft(amount, amountWidth)}  ${memo}`.trimEnd());
  }
  out.push(`  ${pad('', 2)} ${pad('Goods subtotal', accountWidth)}  ${padLeft(formatMoney(plan.goodsSubtotal), amountWidth)}`);
  if (plan.commission) {
    out.push(
      `  ${pad('', 2)} ${pad(`Commission ${ratePercent(plan.commission.rate)}%`, accountWidth)}  ${padLeft(formatMoney(plan.commission.amount), amountWidth)}  [${plan.commission.source}]`,
    );
  }
  out.push(`  ${pad('', 2)} ${pad('Bill total', accountWidth)}  ${padLeft(formatMoney(plan.total), amountWidth)}`);

  for (const item of plan.skipped) out.push(`  ${mark.warn} line ${item.line} skipped: ${item.reason}`);
  for (const warning of plan.warnings) out.push(`  ${mark.warn} ${warning}`);

  if (checks) {
    out.push('');
    out.push('Checks');
    for (const item of checks.items) {
      out.push(`  ${item.ok ? mark.ok : mark.bad} ${item.label}${item.detail ? `: ${item.detail}` : ''}`);
    }
  }

  return out.join('\n');
}

export function renderBillRefusals(refusals: string[], style: PreviewStyle = { ascii: false }): string {
  const mark = marks(style);
  return ['No bill was built from this invoice:', ...refusals.map((reason) => `  ${mark.bad} ${reason}`)].join('\n');
}
