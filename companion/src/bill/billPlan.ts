/**
 * Invoice -> the vendor bill that mirrors it.
 *
 * Pure: no QuickBooks, no disk. It takes the invoice as QuickBooks returned
 * it and the `bill` block of the configuration, and produces either a plan
 * (every line, every amount, every memo, and which config key supplied each
 * choice) or a list of refusals. Nothing is guessed: an item with no vendor
 * rule is a refusal, not a "probably the usual supplier".
 *
 * Money is handled in integer cents from the first line to the last, and the
 * commission is rounded once, on the goods subtotal, exactly as a person
 * with a calculator would do it: 321,208.80 x 2% = 6,424.176 -> 6,424.18.
 * The line is NEGATIVE, so the bill total is what is actually owed to the
 * vendor after the commission is kept back.
 */

import { billRuleForItem, type AceExportConfig } from '../config.js';
import type { QbInvoice, QbInvoiceLine } from '../qbxml/types.js';
import { renderMemo, type MemoPlaceholder } from './memo.js';

export interface BillLinePlan {
  /** 1-based invoice line number. */
  line: number;
  item: string;
  description: string;
  quantity: number | null;
  unitOfMeasure: string;
  account: string;
  /** The config key the account came from. */
  accountSource: string;
  /** Dollars, exact to the cent. */
  amount: number;
  memo: string;
}

export interface BillCommissionPlan {
  account: string;
  rate: number;
  /** Dollars, negative. */
  amount: number;
  memo: string;
  /** The config key the rule came from. */
  source: string;
}

export interface BillPlan {
  invoiceTxnId: string;
  refNumber: string;
  vendor: string;
  /** The config key the vendor came from. */
  vendorSource: string;
  txnDate: string;
  /** May be blank; QuickBooks then derives it from the terms. */
  dueDate: string;
  terms: string;
  customerName: string;
  customerShortName: string;
  /** Header memo; blank writes none. */
  memo: string;
  lines: BillLinePlan[];
  commission: BillCommissionPlan | null;
  /** Dollars: the sum of the goods lines. */
  goodsSubtotal: number;
  /** Dollars: goods plus the (negative) commission. */
  total: number;
  /** Invoice lines that carry no amount and no item: text, not goods. */
  skipped: Array<{ line: number; reason: string }>;
  warnings: string[];
}

export type BillPlanResult =
  | { ok: true; plan: BillPlan }
  | { ok: false; refusals: string[] };

/** Dollars -> integer cents, rounding half away from zero at the fourth decimal. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * The commission on a subtotal, in cents, negative.
 *
 * The rate is fixed at six decimals so the product is an exact integer
 * (below 2^53 for any real invoice), which makes `Math.round` an exact
 * round-half-up of the decimal value: 0.02 x 32,120,880 cents is computed as
 * 20,000 x 32,120,880 / 1,000,000 = 642,417.6 -> 642,418, never
 * 642,417.5999... -> 642,417.
 */
export function commissionCents(rate: number, subtotalCents: number): number {
  const rateMicro = Math.round(rate * 1_000_000);
  const cents = Math.round((rateMicro * subtotalCents) / 1_000_000);
  return cents === 0 ? 0 : -cents;
}

/** "2", "2.5", "0.75": the rate as a percentage without trailing zeros. */
export function ratePercent(rate: number): string {
  return String(Number((rate * 100).toFixed(4)));
}

function quantityText(quantity: number | null): string {
  if (quantity === null) return '';
  return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(4)));
}

/** A line with no item and nothing numeric is a text line, not goods. */
function isTextLine(line: QbInvoiceLine): boolean {
  return line.item.fullName === '' && line.amount === null && line.quantity === null && line.rate === null;
}

export function buildBillPlan(invoice: QbInvoice, config: AceExportConfig): BillPlanResult {
  const refusals: string[] = [];
  const warnings: string[] = [];
  const bill = config.bill;

  const noRules = !Object.keys(bill.items).length;
  if (noRules) {
    refusals.push('No bill rules are configured: add bill.items (vendor and account per item) to the configuration file.');
  }
  if (invoice.isPending === true) {
    refusals.push(`Invoice ${invoice.refNumber || invoice.txnId} is pending (not posted); a bill is not built from a pending invoice.`);
  }
  if (invoice.refNumber.trim() === '') {
    refusals.push('The invoice has no number, so a bill could not be recognised as its twin later. Number the invoice first.');
  }
  if (invoice.terms.fullName.trim() === '') {
    refusals.push('The invoice has no terms; set them on the invoice first (the bill copies them).');
  }

  const customerName = invoice.customer.fullName;
  const shortName = bill.customers[customerName]?.shortName;
  const customerShortName = shortName ?? customerName;
  if (shortName === undefined && customerName !== '') {
    warnings.push(`No short name for customer "${customerName}" (bill.customers); the memo uses the full name.`);
  }

  const skipped: BillPlan['skipped'] = [];
  const billable: Array<{ index: number; line: QbInvoiceLine }> = [];
  invoice.lines.forEach((line, i) => {
    const index = i + 1;
    if (isTextLine(line)) {
      skipped.push({ line: index, reason: `text line${line.desc ? ` ("${line.desc}")` : ''}: no item, no amount` });
      return;
    }
    if (line.item.fullName === '') {
      refusals.push(`Line ${index} has an amount but no item, so no rule can name its vendor or account.`);
      return;
    }
    if (line.amount === null) {
      refusals.push(`Line ${index} ("${line.desc || line.item.fullName}") has no amount.`);
      return;
    }
    billable.push({ index, line });
  });
  if (!billable.length && !refusals.some((r) => r.startsWith('Line '))) {
    refusals.push('The invoice has no lines to bill.');
  }

  // Resolve vendor and account per line; every line must agree on the vendor.
  const vendors = new Map<string, { source: string; lines: number[] }>();
  const planned: BillLinePlan[] = [];
  for (const { index, line } of billable) {
    const rule = billRuleForItem(config, line.item.fullName);
    // With no rules at all, one refusal says it; per-line ones would repeat it.
    if (noRules) continue;
    if (!rule.vendor) {
      refusals.push(`No vendor for item "${line.item.fullName}" (line ${index}). Add bill.items."${line.item.fullName}".vendor, or set it on a parent item.`);
    } else {
      const entry = vendors.get(rule.vendor.value) ?? { source: rule.vendor.source, lines: [] };
      entry.lines.push(index);
      vendors.set(rule.vendor.value, entry);
    }
    if (!rule.account) {
      refusals.push(`No expense account for item "${line.item.fullName}" (line ${index}). Add bill.items."${line.item.fullName}".account, or set it on a parent item.`);
    }
    if (!rule.vendor || !rule.account) continue;

    planned.push({
      line: index,
      item: line.item.fullName,
      description: line.desc,
      quantity: line.quantity,
      unitOfMeasure: line.unitOfMeasure,
      account: rule.account.value,
      accountSource: rule.account.source,
      amount: fromCents(toCents(line.amount as number)),
      memo: '',
    });
  }
  if (vendors.size > 1) {
    const listed = [...vendors.entries()].map(([name, entry]) => `${name}: line${entry.lines.length > 1 ? 's' : ''} ${entry.lines.join(', ')}`).join('; ');
    refusals.push(`Lines name ${vendors.size} vendors (${listed}); a bill has one vendor. Split the invoice, or fix the item rules.`);
  }

  const goodsCents = planned.reduce((sum, line) => sum + toCents(line.amount), 0);
  // Only meaningful once every goods line made it into the plan.
  if (!refusals.length && invoice.subtotal !== null && Math.abs(goodsCents - toCents(invoice.subtotal)) > 1) {
    refusals.push(
      `The lines add up to ${fromCents(goodsCents).toFixed(2)} but the invoice subtotal is ${invoice.subtotal.toFixed(2)}; refusing to bill a total that does not match the invoice.`,
    );
  }

  if (refusals.length) return { ok: false, refusals };

  const [vendor, vendorEntry] = [...vendors.entries()][0] as [string, { source: string; lines: number[] }];
  const vars = (line?: BillLinePlan): Partial<Record<MemoPlaceholder, string>> => ({
    quantity: line ? quantityText(line.quantity) : '',
    description: line?.description ?? '',
    item: line?.item ?? '',
    unitOfMeasure: line?.unitOfMeasure ?? '',
    customerName,
    customerShortName,
    refNumber: invoice.refNumber,
  });
  for (const line of planned) line.memo = renderMemo(bill.memoTemplate, vars(line));

  let commission: BillCommissionPlan | null = null;
  const vendorRule = bill.vendors[vendor];
  if (!vendorRule?.commission) {
    warnings.push(`No commission rule for vendor "${vendor}" (bill.vendors); the bill carries the goods lines only.`);
  } else if (vendorRule.commission.rate === 0) {
    warnings.push(`The commission rate for "${vendor}" is 0; no commission line is added.`);
  } else {
    const { account, rate } = vendorRule.commission;
    const amountCents = commissionCents(rate, goodsCents);
    const template = vendorRule.commission.memoTemplate ?? bill.commissionMemoTemplate;
    commission = {
      account,
      rate,
      amount: fromCents(amountCents),
      memo: renderMemo(template, { ...vars(), rate: String(rate), ratePercent: ratePercent(rate) }),
      source: `bill.vendors."${vendor}".commission`,
    };
  }

  const totalCents = goodsCents + (commission ? toCents(commission.amount) : 0);
  if (totalCents <= 0) {
    return { ok: false, refusals: [`The bill total would be ${fromCents(totalCents).toFixed(2)}; nothing to bill.`] };
  }

  if (skipped.length) warnings.push(`${skipped.length} text line${skipped.length > 1 ? 's' : ''} on the invoice not carried to the bill.`);
  if (invoice.dueDate.trim() === '') warnings.push('The invoice has no due date; QuickBooks derives the bill due date from the terms.');

  return {
    ok: true,
    plan: {
      invoiceTxnId: invoice.txnId,
      refNumber: invoice.refNumber,
      vendor,
      vendorSource: vendorEntry.source,
      txnDate: invoice.txnDate,
      dueDate: invoice.dueDate,
      terms: invoice.terms.fullName,
      customerName,
      customerShortName,
      memo: bill.billMemoTemplate === '' ? '' : renderMemo(bill.billMemoTemplate, vars()),
      lines: planned,
      commission,
      goodsSubtotal: fromCents(goodsCents),
      total: fromCents(totalCents),
      skipped,
      warnings,
    },
  };
}

/** "651,217.60", "-13,024.35": money for a person to read. */
export function formatMoney(amount: number): string {
  const fixed = Math.abs(amount).toFixed(2);
  const [whole, fraction] = fixed.split('.') as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount < 0 ? '-' : ''}${grouped}.${fraction}`;
}
