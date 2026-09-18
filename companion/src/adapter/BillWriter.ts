/**
 * The one write the companion makes into QuickBooks.
 *
 * `InvoiceSourceAdapter` is read-shaped on purpose, so the write lives behind
 * its own interface rather than widening that one: a second invoice source
 * never inherits a write it did not ask for.
 *
 * `write()` is not reachable without `check()`: it runs the checks itself,
 * refuses if any fails, and only then builds the single `BillAddRq`. The
 * checks are three reads - is there already a bill with this number for
 * this vendor, does the vendor exist and is it active, do the accounts exist
 * and are they active - and every one is a plain answer QuickBooks gives
 * without changing anything.
 */

import { AdapterError } from './InvoiceSourceAdapter.js';
import type { AceExportConfig } from '../config.js';
import type { BillPlan } from '../bill/billPlan.js';
import { buildAccountQuery, buildBillAdd, buildBillQuery, buildVendorQuery, type BillExpenseLineSpec } from '../qbxml/requests.js';
import { parseAccountQueryResponse, parseBillAddResponse, parseBillQueryResponse, parseVendorQueryResponse } from '../qbxml/parse.js';
import type { QbBillRet, QbBillSummary } from '../qbxml/types.js';
import type { QbxmlTransport } from '../transport/QbxmlTransport.js';

export interface BillCheck {
  ok: boolean;
  label: string;
  detail: string;
}

export interface BillChecks {
  ok: boolean;
  items: BillCheck[];
  /** Bills already carrying this number, for any vendor. */
  existing: QbBillSummary[];
}

export interface BillWriteResult {
  txnId: string;
  refNumber: string;
  vendor: string;
  amountDue: number | null;
  editSequence: string;
  /** Number of expense lines QuickBooks reports on the bill it created. */
  lineCount: number;
}

export interface BillWriteOutcome {
  checks: BillChecks;
  /** null when a check failed and nothing was sent. */
  written: BillWriteResult | null;
}

export interface BillWriter {
  check(plan: BillPlan): Promise<BillChecks>;
  write(plan: BillPlan): Promise<BillWriteOutcome>;
}

/** Thrown by `write()` when a check fails; nothing was sent. */
export class BillRefusedError extends AdapterError {
  readonly checks: BillChecks;

  constructor(checks: BillChecks) {
    const failed = checks.items.filter((item) => !item.ok).map((item) => `${item.label}${item.detail ? `: ${item.detail}` : ''}`);
    super(`Refused to add the bill. ${failed.join(' ')}`);
    this.name = 'BillRefusedError';
    this.checks = checks;
  }
}

export class QuickBooksBillWriter implements BillWriter {
  constructor(
    private readonly transport: QbxmlTransport,
    private readonly config: AceExportConfig,
  ) {}

  private envelope(): { version: string } {
    return { version: this.config.qbxmlVersion };
  }

  async check(plan: BillPlan): Promise<BillChecks> {
    const items: BillCheck[] = [];

    // 1. A bill with this number already, for this vendor.
    const bills = parseBillQueryResponse(await this.transport.send(buildBillQuery({ refNumber: plan.refNumber }, this.envelope())));
    const sameVendor = bills.results.filter((bill) => bill.vendor.fullName === plan.vendor);
    const otherVendor = bills.results.filter((bill) => bill.vendor.fullName !== plan.vendor);
    if (sameVendor.length) {
      const first = sameVendor[0] as QbBillSummary;
      items.push({
        ok: false,
        label: `a bill numbered ${plan.refNumber} already exists for ${plan.vendor}`,
        detail: `TxnID ${first.txnId}, dated ${first.txnDate || '?'}${first.amountDue !== null ? `, ${first.amountDue.toFixed(2)} due` : ''}`,
      });
    } else {
      items.push({
        ok: true,
        label: `no bill numbered ${plan.refNumber} for ${plan.vendor}`,
        detail: otherVendor.length ? `(${otherVendor.length} with that number for ${otherVendor.map((bill) => bill.vendor.fullName || '?').join(', ')})` : '',
      });
    }

    // 2. The vendor exists and is active.
    const vendors = parseVendorQueryResponse(await this.transport.send(buildVendorQuery({ fullName: plan.vendor }, this.envelope())));
    const vendor = vendors.results.find((candidate) => candidate.fullName === plan.vendor);
    if (!vendor) {
      items.push({ ok: false, label: `vendor "${plan.vendor}" is not in the company file`, detail: 'check the spelling against Vendor Center' });
    } else if (vendor.isActive === false) {
      items.push({ ok: false, label: `vendor "${plan.vendor}" is inactive`, detail: 'reactivate it in Vendor Center first' });
    } else {
      items.push({ ok: true, label: `vendor "${plan.vendor}" is in the company file`, detail: '' });
    }

    // 3. Every account exists and is active.
    const wanted = [...new Set([...plan.lines.map((line) => line.account), ...(plan.commission ? [plan.commission.account] : [])])];
    const accounts = parseAccountQueryResponse(await this.transport.send(buildAccountQuery({ fullName: wanted }, this.envelope())));
    for (const name of wanted) {
      const account = accounts.results.find((candidate) => candidate.fullName === name);
      if (!account) {
        items.push({ ok: false, label: `account "${name}" is not in the chart of accounts`, detail: 'check the spelling, including the parent account' });
      } else if (account.isActive === false) {
        items.push({ ok: false, label: `account "${name}" is inactive`, detail: '' });
      } else {
        items.push({ ok: true, label: `account "${name}" exists`, detail: account.accountType ? `(${account.accountType})` : '' });
      }
    }

    return { ok: items.every((item) => item.ok), items, existing: bills.results };
  }

  async write(plan: BillPlan): Promise<BillWriteOutcome> {
    const checks = await this.check(plan);
    if (!checks.ok) throw new BillRefusedError(checks);

    const expenseLines: BillExpenseLineSpec[] = plan.lines.map((line) => ({
      accountFullName: line.account,
      amount: line.amount,
      ...(line.memo !== '' ? { memo: line.memo } : {}),
      ...(this.config.bill.tagLinesWithCustomer && plan.customerName !== ''
        ? { customerFullName: plan.customerName, billableStatus: 'NotBillable' as const }
        : {}),
    }));
    if (plan.commission) {
      expenseLines.push({
        accountFullName: plan.commission.account,
        amount: plan.commission.amount,
        memo: plan.commission.memo,
      });
    }

    const request = buildBillAdd(
      {
        vendorFullName: plan.vendor,
        ...(plan.txnDate ? { txnDate: plan.txnDate } : {}),
        ...(plan.dueDate ? { dueDate: plan.dueDate } : {}),
        refNumber: plan.refNumber,
        ...(plan.terms ? { termsFullName: plan.terms } : {}),
        ...(plan.memo ? { memo: plan.memo } : {}),
        expenseLines,
      },
      this.envelope(),
    );

    const bill: QbBillRet = parseBillAddResponse(await this.transport.send(request));
    return {
      checks,
      written: {
        txnId: bill.txnId,
        refNumber: bill.refNumber,
        vendor: bill.vendor.fullName,
        amountDue: bill.amountDue,
        editSequence: bill.editSequence,
        lineCount: bill.lines.length,
      },
    };
  }
}
