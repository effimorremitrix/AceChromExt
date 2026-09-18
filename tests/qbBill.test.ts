/**
 * Invoice -> vendor bill: the plan, the checks, the one write, and the
 * calculation workbook, through the command line and the local window.
 *
 * Everything runs against saved qbXML through `FileQbxmlTransport`, which
 * answers each request type separately and records what was sent - so the
 * assertions that matter most here are about what was NOT sent: no
 * `BillAddRq` on a preview, none after a failed check, none twice.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';

import { BillRefusedError, QuickBooksBillWriter } from '../companion/src/adapter/BillWriter.js';
import { buildBillPlan, commissionCents, formatMoney, ratePercent, type BillPlan } from '../companion/src/bill/billPlan.js';
import { renderBillPreview, renderBillRefusals } from '../companion/src/bill/billPreview.js';
import { assertMemoTemplate, MEMO_PLACEHOLDERS, MemoTemplateError, renderMemo } from '../companion/src/bill/memo.js';
import { buildBillWorkbook, writeBillWorkbook } from '../companion/src/excel/billWorkbook.js';
import {
  billRuleForItem,
  ConfigError,
  itemNameCandidates,
  normalizeConfig,
  profileForItem,
  starterConfig,
  type AceExportConfig,
} from '../companion/src/config.js';
import { parseInvoiceQueryResponse } from '../companion/src/qbxml/parse.js';
import type { QbInvoice } from '../companion/src/qbxml/types.js';
import { requestTypeOf } from '../companion/src/transport/QbxmlTransport.js';
import { FileQbxmlTransport } from '../companion/src/transport/FileTransport.js';
import { runCli, type CliIo, type ResolvedOptions } from '../companion/src/ui/cli.js';
import { handleRequest, type RequestContext } from '../companion/src/ui/server.js';
import { PAGE_HTML, PAGE_JS } from '../companion/src/ui/page.js';
import { QuickBooksDesktopAdapter } from '../companion/src/adapter/QuickBooksDesktopAdapter.js';
import { fixture } from './qbxml.test.js';

const temporary: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ace-bill-test-'));
  temporary.push(directory);
  return directory;
}

afterEach(() => {
  while (temporary.length) rmSync(temporary.pop() as string, { recursive: true, force: true });
});

function invoiceFrom(name: string): QbInvoice {
  return parseInvoiceQueryResponse(fixture(name)).results[0] as QbInvoice;
}

/** The starter configuration: Shelled Almonds -> Blue Diamond Growers, 2% commission. */
function config(overrides: Partial<AceExportConfig['bill']> = {}): AceExportConfig {
  const base = starterConfig();
  return normalizeConfig({ ...base, bill: { ...base.bill, ...overrides } });
}

function planFor(name = 'invoice-single-line.xml', overrides: Partial<AceExportConfig['bill']> = {}): BillPlan {
  const built = buildBillPlan(invoiceFrom(name), config(overrides));
  if (!built.ok) throw new Error(built.refusals.join('\n'));
  return built.plan;
}

function refusalsFor(invoice: QbInvoice, cfg: AceExportConfig = config()): string[] {
  const built = buildBillPlan(invoice, cfg);
  return built.ok ? [] : built.refusals;
}

/** Responses for the whole flow: invoice, no duplicate, vendor found, accounts found, add ok. */
const HAPPY = {
  InvoiceQueryRq: fixture('invoice-single-line.xml'),
  BillQueryRq: fixture('bill-query-no-match.xml'),
  VendorQueryRq: fixture('vendor-query.xml'),
  AccountQueryRq: fixture('account-query.xml'),
  BillAddRq: fixture('bill-add-ok.xml'),
};

const sentTypes = (transport: FileQbxmlTransport): string[] => transport.sent.map(requestTypeOf);

describe('memo templates', () => {
  it('fills the placeholders and collapses the gaps', () => {
    expect(renderMemo('{quantity} {description} to {customerShortName}', { quantity: '', description: 'Almonds', customerShortName: 'Aydin' })).toBe(
      'Almonds to Aydin',
    );
  });

  it('refuses an unknown placeholder instead of leaving it in the memo', () => {
    expect(() => renderMemo('{custmer}', {})).toThrow(MemoTemplateError);
    expect(() => assertMemoTemplate('x {rate} {nope}', 'bill.memoTemplate')).toThrow(/bill.memoTemplate uses \{nope\}/);
    expect(() => assertMemoTemplate(MEMO_PLACEHOLDERS.map((p) => `{${p}}`).join(' '), 'x')).not.toThrow();
  });
});

describe('the bill rules in the configuration', () => {
  it('lists an item and its parents, nearest first', () => {
    expect(itemNameCandidates('Almonds:Shelled:Carmel')).toEqual(['Almonds:Shelled:Carmel', 'Almonds:Shelled', 'Almonds']);
    expect(itemNameCandidates('Almonds')).toEqual(['Almonds']);
  });

  it('keeps the export profile lookup as it was', () => {
    const cfg = config();
    expect(profileForItem(cfg, 'Shelled Almonds').scheduleB).toBe('0802.12.0000');
    expect(profileForItem(cfg, 'Shelled Almonds:Carmel').scheduleB).toBe('0802.12.0000');
    expect(profileForItem(cfg, 'Prunes').scheduleB).toBeUndefined();
  });

  it('resolves vendor and account separately, each to the nearest rule that sets it', () => {
    const cfg = config({
      items: {
        Almonds: { vendor: 'Blue Diamond Growers', account: 'COGS:Almonds' },
        'Almonds:Carmel': { account: 'COGS:Almonds:Carmel' },
      },
    });
    expect(billRuleForItem(cfg, 'Almonds:Carmel:Sup')).toEqual({
      vendor: { value: 'Blue Diamond Growers', source: 'bill.items."Almonds".vendor' },
      account: { value: 'COGS:Almonds:Carmel', source: 'bill.items."Almonds:Carmel".account' },
    });
    expect(billRuleForItem(cfg, 'Prunes')).toEqual({ vendor: null, account: null });
  });

  it('reports a bad rule by its full path', () => {
    const base = starterConfig();
    const bad = (bill: unknown) => () => normalizeConfig({ ...base, bill });
    expect(bad({ items: { A: { vendor: '' } } })).toThrow(/bill\.items\."A"\.vendor must be a non-empty string/);
    expect(bad({ vendors: { V: { commission: { account: 'X', rate: 1 } } } })).toThrow(/bill\.vendors\."V"\.commission\.rate/);
    expect(bad({ vendors: { V: { commission: { account: '', rate: 0.02 } } } })).toThrow(/commission\.account/);
    expect(bad({ customers: { C: {} } })).toThrow(/bill\.customers\."C"\.shortName/);
    expect(bad({ memoTemplate: '{nope}' })).toThrow(ConfigError);
    expect(bad({ memoTemplate: '{nope}' })).toThrow(/bill\.memoTemplate uses \{nope\}/);
    expect(bad({ excelFileNamePattern: 'bill.csv' })).toThrow(/must end in \.xlsx/);
    expect(bad('yes')).toThrow(/bill must be an object/);
  });

  it('fills the defaults when the block is absent, and round-trips the starter', () => {
    const cfg = normalizeConfig({});
    expect(cfg.bill.memoTemplate).toBe('{quantity} {description} to {customerShortName}');
    expect(cfg.bill.excelFileNamePattern).toBe('Bill_{refNumber}.xlsx');
    expect(normalizeConfig(JSON.parse(JSON.stringify(starterConfig())))).toEqual(starterConfig());
  });
});

describe('the arithmetic', () => {
  it('rounds the commission once, on the goods subtotal, half up', () => {
    // The screenshot: 321,208.80 x 2% = 6,424.176 -> 6,424.18, posted negative.
    expect(commissionCents(0.02, 32120880)).toBe(-642418);
    // 1,234.25 x 2% = 24.685 -> 24.69: exact, not 24.684999.
    expect(commissionCents(0.02, 123425)).toBe(-2469);
    expect(commissionCents(0.025, 65121760)).toBe(-1628044);
    expect(commissionCents(0, 100)).toBe(0);
  });

  it('prints rates and money for a person', () => {
    expect(ratePercent(0.02)).toBe('2');
    expect(ratePercent(0.025)).toBe('2.5');
    expect(formatMoney(651217.6)).toBe('651,217.60');
    expect(formatMoney(-13024.35)).toBe('-13,024.35');
    expect(formatMoney(0)).toBe('0.00');
  });
});

describe('building the bill plan', () => {
  it('mirrors the single-line invoice: vendor, terms, dates, one goods line, the commission', () => {
    const plan = planFor();
    expect(plan).toMatchObject({
      refNumber: 'CN-1042',
      vendor: 'Blue Diamond Growers',
      vendorSource: 'bill.items."Shelled Almonds".vendor',
      txnDate: '2026-09-21',
      dueDate: '2027-01-19',
      terms: 'Net 120',
      customerShortName: 'Aydin',
      goodsSubtotal: 651217.6,
      total: 638193.25,
      memo: '',
    });
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({
      line: 1,
      account: 'Cost of Goods Sold:Almonds',
      amount: 651217.6,
      memo: '176000 Almond Kernels, Monterey SSR 23/25, new crop, 50 lb cartons to Aydin',
    });
    expect(plan.commission).toEqual({
      account: 'Commissions Income',
      rate: 0.02,
      amount: -13024.35,
      memo: 'Commission 2% on invoice CN-1042',
      source: 'bill.vendors."Blue Diamond Growers".commission',
    });
    expect(plan.warnings).toEqual([]);
  });

  it('bills every goods line, group members included, when the rules cover them', () => {
    const plan = planFor('invoice-multi-line.xml', {
      items: {
        'Shelled Almonds': { vendor: 'Blue Diamond Growers', account: 'COGS:Almonds' },
        'Dried Fruit': { vendor: 'Blue Diamond Growers' },
        'Dried Fruit:Dried Prunes': { account: 'COGS:Prunes' },
      },
    });
    expect(plan.lines.map((line) => [line.line, line.account, line.amount])).toEqual([
      [1, 'COGS:Almonds', 651217.6],
      [2, 'COGS:Prunes', 65600],
      [3, 'COGS:Almonds', 0],
    ]);
    expect(plan.goodsSubtotal).toBe(716817.6);
    expect(plan.commission?.amount).toBe(-14336.35);
    expect(plan.total).toBe(702481.25);
  });

  it('refuses when a line has no vendor or account rule, naming the key to add', () => {
    const refusals = refusalsFor(invoiceFrom('invoice-multi-line.xml'));
    expect(refusals).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/No vendor for item "Dried Fruit:Dried Prunes" \(line 2\).*bill\.items\."Dried Fruit:Dried Prunes"\.vendor/),
        expect.stringMatching(/No expense account for item "Dried Fruit:Dried Prunes"/),
      ]),
    );
  });

  it('refuses two vendors on one invoice', () => {
    const refusals = refusalsFor(
      invoiceFrom('invoice-multi-line.xml'),
      config({
        items: {
          'Shelled Almonds': { vendor: 'Blue Diamond Growers', account: 'A' },
          'Dried Fruit': { vendor: 'Sunny Farms', account: 'B' },
        },
      }),
    );
    expect(refusals).toEqual([expect.stringMatching(/Lines name 2 vendors \(Blue Diamond Growers: lines 1, 3; Sunny Farms: line 2\)/)]);
  });

  it('refuses without rules, a pending invoice, no number, no terms, and no lines', () => {
    const invoice = invoiceFrom('invoice-single-line.xml');
    expect(refusalsFor(invoice, config({ items: {} }))).toEqual([expect.stringMatching(/No bill rules are configured/)]);
    expect(refusalsFor({ ...invoice, isPending: true })).toEqual([expect.stringMatching(/pending/)]);
    expect(refusalsFor({ ...invoice, refNumber: '' })).toEqual([expect.stringMatching(/has no number/)]);
    expect(refusalsFor({ ...invoice, terms: { listId: '', fullName: '' } })).toEqual([expect.stringMatching(/has no terms/)]);
    expect(refusalsFor({ ...invoice, lines: [], subtotal: null })).toEqual([expect.stringMatching(/no lines to bill/)]);
  });

  it('refuses a line with an amount but no item, and a line with no amount', () => {
    const invoice = invoiceFrom('invoice-single-line.xml');
    const line = invoice.lines[0]!;
    expect(refusalsFor({ ...invoice, lines: [{ ...line, item: { listId: '', fullName: '' } }] })).toEqual([
      expect.stringMatching(/Line 1 has an amount but no item/),
    ]);
    expect(refusalsFor({ ...invoice, lines: [{ ...line, amount: null }] })).toEqual([expect.stringMatching(/Line 1 .* has no amount/)]);
  });

  it('skips a text line and says so, instead of refusing', () => {
    const invoice = invoiceFrom('invoice-single-line.xml');
    const text = { ...invoice.lines[0]!, item: { listId: '', fullName: '' }, desc: 'Thank you', quantity: null, rate: null, amount: null };
    const built = buildBillPlan({ ...invoice, lines: [invoice.lines[0]!, text] }, config());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.skipped).toEqual([{ line: 2, reason: 'text line ("Thank you"): no item, no amount' }]);
    expect(built.plan.warnings).toEqual([expect.stringMatching(/1 text line on the invoice not carried/)]);
  });

  it('refuses to bill lines that do not add up to the invoice subtotal', () => {
    const invoice = invoiceFrom('invoice-single-line.xml');
    expect(refusalsFor({ ...invoice, subtotal: 600000 })).toEqual([expect.stringMatching(/add up to 651217.60 but the invoice subtotal is 600000.00/)]);
  });

  it('refuses a bill whose total would be nothing', () => {
    const invoice = invoiceFrom('invoice-single-line.xml');
    const zero = { ...invoice, subtotal: 0, totalAmount: 0, lines: [{ ...invoice.lines[0]!, amount: 0 }] };
    expect(refusalsFor(zero)).toEqual([expect.stringMatching(/bill total would be 0.00/)]);
  });

  it('carries the goods only, with a note, when the vendor has no commission rule', () => {
    const plan = planFor('invoice-single-line.xml', { vendors: {} });
    expect(plan.commission).toBeNull();
    expect(plan.total).toBe(651217.6);
    expect(plan.warnings).toEqual([expect.stringMatching(/No commission rule for vendor/)]);
    const zeroRate = planFor('invoice-single-line.xml', { vendors: { 'Blue Diamond Growers': { commission: { account: 'X', rate: 0 } } } });
    expect(zeroRate.commission).toBeNull();
    expect(zeroRate.warnings).toEqual([expect.stringMatching(/rate .* is 0/)]);
  });

  it('falls back to the full customer name, with a note, when no short name is configured', () => {
    const plan = planFor('invoice-single-line.xml', { customers: {} });
    expect(plan.customerShortName).toBe('Aydin Kuruyemis San Ve Tic A.S');
    expect(plan.lines[0]?.memo).toContain('to Aydin Kuruyemis San Ve Tic A.S');
    expect(plan.warnings).toEqual([expect.stringMatching(/No short name for customer/)]);
  });

  it('renders the header memo and a per-vendor commission memo when configured', () => {
    const plan = planFor('invoice-single-line.xml', {
      billMemoTemplate: 'Invoice {refNumber} to {customerShortName}',
      vendors: { 'Blue Diamond Growers': { commission: { account: 'Commissions Income', rate: 0.02, memoTemplate: '{ratePercent}% ({rate}) kept' } } },
    });
    expect(plan.memo).toBe('Invoice CN-1042 to Aydin');
    expect(plan.commission?.memo).toBe('2% (0.02) kept');
  });
});

describe('the bill preview', () => {
  it('shows the header with its sources, the lines, the arithmetic, and the checks', () => {
    const plan = planFor();
    const text = renderBillPreview(plan, { ok: true, existing: [], items: [{ ok: true, label: 'vendor exists', detail: '' }] });
    expect(text).toContain('Bill from invoice CN-1042 (TxnID 2AB4-1758412800)');
    expect(text).toMatch(/Vendor\s+Blue Diamond Growers\s+\[bill\.items\."Shelled Almonds"\.vendor\]/);
    expect(text).toMatch(/Terms\s+Net 120\s+\[invoice terms\]/);
    expect(text).toMatch(/1\s+Cost of Goods Sold:Almonds\s+651,217\.60\s+176000 Almond Kernels/);
    expect(text).toMatch(/C\s+Commissions Income\s+-13,024\.35\s+Commission 2% on invoice CN-1042/);
    expect(text).toMatch(/Goods subtotal\s+651,217\.60/);
    expect(text).toMatch(/Commission 2%\s+-13,024\.35/);
    expect(text).toMatch(/Bill total\s+638,193\.25/);
    expect(text).toContain('✓ vendor exists');
    expect(renderBillPreview(plan, null, { ascii: true })).not.toContain('Checks');
  });

  it('lists refusals', () => {
    expect(renderBillRefusals(['one', 'two'], { ascii: true })).toBe('No bill was built from this invoice:\n  [XX] one\n  [XX] two');
  });
});

describe('the bill writer', () => {
  it('checks for a duplicate, the vendor and every account, sending only queries', async () => {
    const transport = new FileQbxmlTransport({ responses: HAPPY });
    const writer = new QuickBooksBillWriter(transport, config());
    const checks = await writer.check(planFor());
    expect(checks.ok).toBe(true);
    expect(checks.items.map((item) => item.label)).toEqual([
      'no bill numbered CN-1042 for Blue Diamond Growers',
      'vendor "Blue Diamond Growers" is in the company file',
      'account "Cost of Goods Sold:Almonds" exists',
      'account "Commissions Income" exists',
    ]);
    expect(sentTypes(transport)).toEqual(['BillQueryRq', 'VendorQueryRq', 'AccountQueryRq']);
  });

  it('refuses a duplicate for the same vendor, and only notes one for another vendor', async () => {
    const dup = new FileQbxmlTransport({ responses: { ...HAPPY, BillQueryRq: fixture('bill-query-match.xml') } });
    const checks = await new QuickBooksBillWriter(dup, config()).check(planFor());
    expect(checks.ok).toBe(false);
    expect(checks.items[0]).toMatchObject({ ok: false, label: 'a bill numbered CN-1042 already exists for Blue Diamond Growers' });
    expect(checks.items[0]?.detail).toContain('TxnID 3C1E-1758500000');

    const other = new FileQbxmlTransport({
      responses: { ...HAPPY, BillQueryRq: fixture('bill-query-match.xml').replace('Blue Diamond Growers', 'Someone Else') },
    });
    const noted = await new QuickBooksBillWriter(other, config()).check(planFor());
    expect(noted.ok).toBe(true);
    expect(noted.items[0]?.detail).toContain('Someone Else');
  });

  it('refuses a vendor or account QuickBooks does not have, or has made inactive', async () => {
    const noVendor = new FileQbxmlTransport({ responses: { ...HAPPY, VendorQueryRq: fixture('bill-query-no-match.xml').replace(/BillQueryRs/g, 'VendorQueryRs') } });
    const missing = await new QuickBooksBillWriter(noVendor, config()).check(planFor());
    expect(missing.items[1]).toMatchObject({ ok: false, label: 'vendor "Blue Diamond Growers" is not in the company file' });

    const inactive = new FileQbxmlTransport({ responses: { ...HAPPY, AccountQueryRq: fixture('account-query.xml').replace(/<IsActive>true<\/IsActive>(\s*)<AccountType>Income/, '<IsActive>false</IsActive>$1<AccountType>Income') } });
    const flagged = await new QuickBooksBillWriter(inactive, config()).check(planFor());
    expect(flagged.ok).toBe(false);
    expect(flagged.items[3]).toMatchObject({ ok: false, label: 'account "Commissions Income" is inactive' });

    const oneAccount = new FileQbxmlTransport({ responses: { ...HAPPY, AccountQueryRq: fixture('account-query.xml').replace(/<AccountRet>[\s\S]*?Commissions Income[\s\S]*?<\/AccountRet>/, '') } });
    const short = await new QuickBooksBillWriter(oneAccount, config()).check(planFor());
    expect(short.items[3]).toMatchObject({ ok: false, label: 'account "Commissions Income" is not in the chart of accounts' });
  });

  it('writes exactly one BillAddRq, after its own checks, and reports the bill QuickBooks made', async () => {
    const transport = new FileQbxmlTransport({ responses: HAPPY });
    const outcome = await new QuickBooksBillWriter(transport, config()).write(planFor());
    expect(outcome.checks.ok).toBe(true);
    expect(outcome.written).toEqual({
      txnId: '3C1E-1758500000',
      refNumber: 'CN-1042',
      vendor: 'Blue Diamond Growers',
      amountDue: 638193.25,
      editSequence: '1758500000',
      lineCount: 2,
    });
    expect(sentTypes(transport)).toEqual(['BillQueryRq', 'VendorQueryRq', 'AccountQueryRq', 'BillAddRq']);
    const add = transport.sent[3] as string;
    expect(add).toContain('<FullName>Blue Diamond Growers</FullName>');
    expect(add).toContain('<RefNumber>CN-1042</RefNumber>');
    expect(add).toContain('<TxnDate>2026-09-21</TxnDate>');
    expect(add).toContain('<DueDate>2027-01-19</DueDate>');
    expect(add).toContain('<FullName>Net 120</FullName>');
    expect(add).toContain('<Amount>651217.60</Amount>');
    expect(add).toContain('<Amount>-13024.35</Amount>');
    expect(add).not.toContain('<CustomerRef>');
  });

  it('tags the goods lines with the customer only when asked', async () => {
    const transport = new FileQbxmlTransport({ responses: HAPPY });
    await new QuickBooksBillWriter(transport, config({ tagLinesWithCustomer: true })).write(planFor());
    const add = transport.sent[3] as string;
    expect(add).toContain('<CustomerRef>');
    expect(add).toContain('<FullName>Aydin Kuruyemis San Ve Tic A.S</FullName>');
    expect(add.match(/<BillableStatus>NotBillable<\/BillableStatus>/g)).toHaveLength(1);
  });

  it('sends no BillAddRq when a check fails', async () => {
    const transport = new FileQbxmlTransport({ responses: { ...HAPPY, BillQueryRq: fixture('bill-query-match.xml') } });
    await expect(new QuickBooksBillWriter(transport, config()).write(planFor())).rejects.toThrow(BillRefusedError);
    await expect(new QuickBooksBillWriter(transport, config()).write(planFor())).rejects.toThrow(/already exists/);
    expect(sentTypes(transport)).not.toContain('BillAddRq');
  });

  it("surfaces QuickBooks' rejection of the add", async () => {
    const transport = new FileQbxmlTransport({ responses: { ...HAPPY, BillAddRq: fixture('bill-add-error.xml') } });
    await expect(new QuickBooksBillWriter(transport, config()).write(planFor())).rejects.toThrow(/Commissions Incom/);
  });
});

describe('the calculation workbook', () => {
  function sheets(bytes: Uint8Array) {
    const workbook = XLSX.read(bytes, { type: 'buffer' });
    return { names: workbook.SheetNames, sheet: (name: string) => workbook.Sheets[name] as XLSX.WorkSheet };
  }
  function cellsWhere(sheet: XLSX.WorkSheet, predicate: (cell: XLSX.CellObject) => boolean): XLSX.CellObject[] {
    return Object.entries(sheet)
      .filter(([key]) => !key.startsWith('!'))
      .map(([, cell]) => cell as XLSX.CellObject)
      .filter(predicate);
  }

  it('lays out the invoice, the bill and the commission as live formulas with cached values', () => {
    const plan = planFor();
    const invoice = invoiceFrom('invoice-single-line.xml');
    const { names, sheet } = sheets(buildBillWorkbook(plan, invoice, { checks: null, written: null }, { generatedBy: 'test' }));
    expect(names).toEqual(['Bill', 'Invoice']);

    const bill = sheet('Bill');
    const rows = XLSX.utils.sheet_to_json<string[]>(bill, { header: 1, raw: false });
    expect(rows[0]).toEqual(['Bill', 'CN-1042']);
    expect(rows[1]).toEqual(['Status', 'preview only: nothing written']);
    expect(rows[2]).toEqual(['Vendor', 'Blue Diamond Growers', 'bill.items."Shelled Almonds".vendor']);

    const formulas = cellsWhere(bill, (cell) => typeof cell.f === 'string');
    const byFormula = Object.fromEntries(formulas.map((cell) => [cell.f as string, cell.v]));
    expect(byFormula['SUM(D14:D14)']).toBe(651217.6);
    expect(byFormula['-ROUND(D16*D17,2)']).toBe(-13024.35);
    expect(byFormula['D16+D18']).toBe(638193.25);
    expect(byFormula['IF(ABS(D16-D21)<0.005,"OK","DIFFERS")']).toBe('OK');

    const invoiceRows = XLSX.utils.sheet_to_json<string[]>(sheet('Invoice'), { header: 1, raw: false });
    expect(invoiceRows[0]).toEqual(['Invoice', 'CN-1042']);
    expect(invoiceRows[8]).toEqual(['#', 'Item', 'Description', 'Quantity', 'Unit', 'Rate', 'Amount']);
    expect(invoiceRows[9]?.[1]).toBe('Shelled Almonds');
    expect(invoiceRows.at(-1)?.slice(5)).toEqual(['Invoice total', '651,217.60']);
  });

  it('records the TxnID and the checks once the bill was written', () => {
    const plan = planFor();
    const checks = { ok: true, existing: [], items: [{ ok: true, label: 'vendor exists', detail: '' }] };
    const written = { txnId: '3C1E-1758500000', refNumber: 'CN-1042', vendor: 'Blue Diamond Growers', amountDue: 638193.25, editSequence: '1', lineCount: 2 };
    const { names, sheet } = sheets(buildBillWorkbook(plan, invoiceFrom('invoice-single-line.xml'), { checks, written }));
    expect(names).toEqual(['Bill', 'Invoice', 'Checks']);
    expect(XLSX.utils.sheet_to_json<string[]>(sheet('Bill'), { header: 1 })[1]).toEqual(['Status', 'written to QuickBooks: TxnID 3C1E-1758500000']);
    expect(XLSX.utils.sheet_to_json<string[]>(sheet('Checks'), { header: 1 })[1]?.slice(0, 2)).toEqual(['ok', 'vendor exists']);
  });

  it('flags a goods total that differs from the invoice, and a bill with no commission', () => {
    const plan = planFor('invoice-single-line.xml', { vendors: {} });
    const invoice = { ...invoiceFrom('invoice-single-line.xml'), subtotal: 600000 };
    const { sheet } = sheets(buildBillWorkbook(plan, invoice, { checks: null, written: null }));
    // No commission: the total formula is the subtotal cell alone.
    const total = cellsWhere(sheet('Bill'), (cell) => typeof cell.f === 'string' && /^D\d+$/.test(cell.f));
    expect(total[0]?.v).toBe(651217.6);
    expect(cellsWhere(sheet('Bill'), (cell) => typeof cell.f === 'string' && cell.f.startsWith('-ROUND'))).toEqual([]);
    const tie = cellsWhere(sheet('Bill'), (cell) => typeof cell.f === 'string' && cell.f.startsWith('IF('));
    expect(tie[0]?.v).toBe('DIFFERS');
  });

  it('writes the file under the configured name and refuses to clobber it', () => {
    const directory = scratch();
    const plan = planFor();
    const invoice = invoiceFrom('invoice-single-line.xml');
    const result = writeBillWorkbook(plan, invoice, { checks: null, written: null }, { directory, fileNameOrPattern: 'Bill_{refNumber}.xlsx' });
    expect(result.fileName).toBe('Bill_CN-1042.xlsx');
    expect(readdirSync(directory)).toEqual(['Bill_CN-1042.xlsx']);
    expect(() => writeBillWorkbook(plan, invoice, { checks: null, written: null }, { directory, fileNameOrPattern: 'Bill_{refNumber}.xlsx' })).toThrow(/already exists/);
    expect(() => writeBillWorkbook(plan, invoice, { checks: null, written: null }, { directory, fileNameOrPattern: 'Bill_{refNumber}.xlsx', failIfExists: false })).not.toThrow();
  });
});

describe('ace-export bill', () => {
  function configFile(overrides: Partial<AceExportConfig['bill']> = {}): string {
    const path = join(scratch(), 'ace-export.config.json');
    writeFileSync(path, JSON.stringify(config(overrides), null, 2));
    return path;
  }

  function capture(responses: Record<string, string> = HAPPY) {
    const transport = new FileQbxmlTransport({ responses });
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = { out: (text) => out.push(text), err: (text) => err.push(text), makeTransport: () => transport };
    return { io, transport, text: () => out.join('\n'), errors: () => err.join('\n') };
  }

  it('previews the bill and runs the checks, sending no BillAddRq', async () => {
    const { io, transport, text } = capture();
    expect(await runCli(['bill', 'CN-1042', '--config', configFile()], io)).toBe(0);
    expect(text()).toContain('Bill from invoice CN-1042');
    expect(text()).toContain('Bill total');
    expect(text()).toContain('✓ no bill numbered CN-1042 for Blue Diamond Growers');
    expect(text()).toContain('Preview only: nothing was written to QuickBooks. Re-run with --write');
    expect(sentTypes(transport)).toEqual(['InvoiceQueryRq', 'BillQueryRq', 'VendorQueryRq', 'AccountQueryRq']);
  });

  it('writes on --write, exactly once, and says what QuickBooks made', async () => {
    const { io, transport, text } = capture();
    expect(await runCli(['bill', 'CN-1042', '--write', '--config', configFile()], io)).toBe(0);
    expect(text()).toContain('Added bill: TxnID 3C1E-1758500000, Blue Diamond Growers, ref CN-1042, total 638,193.25.');
    expect(sentTypes(transport).filter((type) => type === 'BillAddRq')).toHaveLength(1);
  });

  it('exits non-zero, sending no BillAddRq, when a check fails', async () => {
    const dup = { ...HAPPY, BillQueryRq: fixture('bill-query-match.xml') };
    const preview = capture(dup);
    expect(await runCli(['bill', 'CN-1042', '--config', configFile()], preview.io)).toBe(1);
    expect(preview.text()).toContain('✗ a bill numbered CN-1042 already exists');
    expect(preview.text()).toContain('--write would refuse');

    const write = capture(dup);
    expect(await runCli(['bill', 'CN-1042', '--write', '--config', configFile()], write.io)).toBe(1);
    expect(write.errors()).toMatch(/Refused to add the bill.*already exists/);
    expect(sentTypes(write.transport)).not.toContain('BillAddRq');
  });

  it('refuses --write with --from-file', async () => {
    const { io, transport, errors } = capture();
    expect(await runCli(['bill', 'CN-1042', '--write', '--from-file', 'x.xml', '--config', configFile()], io)).toBe(1);
    expect(errors()).toMatch(/--write needs QuickBooks/);
    expect(sentTypes(transport)).toEqual(['InvoiceQueryRq']);
  });

  it('stops at the rules when an item has none, asking nothing more of QuickBooks', async () => {
    const { io, transport, text } = capture();
    expect(await runCli(['bill', 'CN-1042', '--config', configFile({ items: {} })], io)).toBe(1);
    expect(text()).toContain('No bill was built from this invoice');
    expect(sentTypes(transport)).toEqual(['InvoiceQueryRq']);
  });

  it('writes the calculation workbook on --excel, recording the TxnID after a write', async () => {
    const directory = scratch();
    const preview = capture();
    expect(await runCli(['bill', 'CN-1042', '--excel', '--out', directory, '--config', configFile()], preview.io)).toBe(0);
    expect(preview.text()).toMatch(/Calculation: .*Bill_CN-1042\.xlsx/);
    expect(readdirSync(directory)).toEqual(['Bill_CN-1042.xlsx']);

    const written = capture();
    expect(await runCli(['bill', 'CN-1042', '--write', '--excel', '--force', '--out', directory, '--config', configFile()], written.io)).toBe(0);
    const workbook = XLSX.read(readFileSync(join(directory, 'Bill_CN-1042.xlsx')), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['Bill'] as XLSX.WorkSheet, { header: 1 });
    expect(rows[1]).toEqual(['Status', 'written to QuickBooks: TxnID 3C1E-1758500000']);
    expect(workbook.SheetNames).toContain('Checks');
  });

  it('needs an invoice', async () => {
    const { io, errors } = capture();
    expect(await runCli(['bill'], io)).toBe(1);
    expect(errors()).toMatch(/Which invoice/);
  });
});

describe('the local window, vendor bill', () => {
  function context(responses: Record<string, string> = HAPPY, bill: Partial<AceExportConfig['bill']> = {}): RequestContext & { transport: FileQbxmlTransport } {
    const transport = new FileQbxmlTransport({ responses });
    const cfg = config(bill);
    const options: ResolvedOptions = {
      config: cfg,
      configPath: null,
      fromFile: null,
      launch: false,
      ascii: false,
      force: true,
      dryRun: false,
      outputDirectory: null,
      fileName: null,
      overrides: {},
      lineOverrides: {},
      limit: null,
      contains: null,
      customer: null,
      dateFrom: null,
      dateTo: null,
      port: null,
    };
    return {
      adapter: new QuickBooksDesktopAdapter(transport, cfg),
      bills: new QuickBooksBillWriter(transport, cfg),
      token: 'secret-token',
      options,
      transport,
    };
  }
  const query = (token = 'secret-token') => new URLSearchParams({ t: token });
  const body = (payload: unknown) => JSON.stringify(payload);

  it('previews the bill as JSON without writing', async () => {
    const ctx = context();
    const reply = await handleRequest(ctx, 'POST', '/api/bill', query(), body({ id: 'CN-1042' }));
    expect(reply.status).toBe(200);
    const data = JSON.parse(reply.body);
    expect(data.ok).toBe(true);
    expect(data.plan.vendor).toBe('Blue Diamond Growers');
    expect(data.plan.total).toBe(638193.25);
    expect(data.checks).toHaveLength(4);
    expect(data.preview).toContain('Bill total');
    expect(data.written).toBeNull();
    expect(sentTypes(ctx.transport)).not.toContain('BillAddRq');
  });

  it('writes on write:true and returns what QuickBooks made', async () => {
    const ctx = context();
    const reply = await handleRequest(ctx, 'POST', '/api/bill', query(), body({ id: 'CN-1042', write: true }));
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body).written.txnId).toBe('3C1E-1758500000');
    expect(sentTypes(ctx.transport).filter((type) => type === 'BillAddRq')).toHaveLength(1);
  });

  it('answers 409 and writes nothing when a check fails', async () => {
    const ctx = context({ ...HAPPY, BillQueryRq: fixture('bill-query-match.xml') });
    const reply = await handleRequest(ctx, 'POST', '/api/bill', query(), body({ id: 'CN-1042', write: true }));
    expect(reply.status).toBe(409);
    expect(JSON.parse(reply.body).refusals[0]).toMatch(/already exists/);
    expect(sentTypes(ctx.transport)).not.toContain('BillAddRq');
  });

  it('reports rule refusals as a plan that was not built', async () => {
    const reply = await handleRequest(context(HAPPY, { items: {} }), 'POST', '/api/bill', query(), body({ id: 'CN-1042' }));
    expect(reply.status).toBe(200);
    const data = JSON.parse(reply.body);
    expect(data.ok).toBe(false);
    expect(data.plan).toBeNull();
    expect(data.refusals[0]).toMatch(/No bill rules/);
  });

  it('refuses to write from a replayed file, and without the token', async () => {
    const ctx = context();
    ctx.options.fromFile = 'saved.xml';
    expect((await handleRequest(ctx, 'POST', '/api/bill', query(), body({ id: 'CN-1042', write: true }))).status).toBe(400);
    expect((await handleRequest(context(), 'POST', '/api/bill', query('wrong'), body({ id: 'CN-1042' }))).status).toBe(403);
    expect((await handleRequest(context(), 'POST', '/api/bill', query(), body({ id: '' }))).status).toBe(400);
  });

  it('writes the calculation workbook on excel:true', async () => {
    const ctx = context();
    ctx.options.outputDirectory = scratch();
    const reply = await handleRequest(ctx, 'POST', '/api/bill', query(), body({ id: 'CN-1042', excel: true }));
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body).excel.fileName).toBe('Bill_CN-1042.xlsx');
    expect(readdirSync(ctx.options.outputDirectory as string)).toEqual(['Bill_CN-1042.xlsx']);
  });

  it('has a bill panel whose Write button starts disabled and asks first', () => {
    expect(PAGE_HTML).toContain('id="bill"');
    expect(PAGE_HTML).toMatch(/<button id="billWrite"[^>]*disabled>/);
    expect(PAGE_HTML).toContain('id="billExcel"');
    expect(PAGE_JS).toContain("confirm('Add this bill to QuickBooks?");
    expect(PAGE_JS).toContain("post('/api/bill'");
  });
});
