/**
 * The dashboard rendered in a DOM: the operator can import, extract, approve,
 * build, read where a value came from, and download - and nothing tries to
 * leave the page while they do.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountDashboard, type DashboardActions } from '../../web/src/app.js';
import { approveExtraction, buildPackage, extractDocument, importWorkbook } from '../../web/src/workflow.js';
import { DEFAULT_SETTINGS } from '../../src/core/settings.js';
import { deckhandText, quickBooksWorkbook, type QuickBooksWorkbook } from './fixtures.js';

let quickbooks: QuickBooksWorkbook;
let root: HTMLElement;
let app: DashboardActions;
const clicks: string[] = [];
const network = vi.fn(() => {
  throw new Error('The dashboard must never make a request.');
});

beforeAll(async () => {
  quickbooks = await quickBooksWorkbook();
});

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root') as HTMLElement;
  clicks.length = 0;
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('XMLHttpRequest', network);
  (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = vi.fn(() => 'blob:dashboard/test');
  (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(`${this.getAttribute('download')}|${this.getAttribute('href')}`);
  });
  app = mountDashboard(root);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const text = (): string => root.textContent ?? '';
const button = (label: string): HTMLButtonElement => {
  const found = Array.from(root.querySelectorAll('button')).find((node) => node.textContent?.trim() === label);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};
const tab = (id: string): void => (root.querySelector(`[data-tab="${id}"]`) as HTMLButtonElement).click();

describe('the dashboard page', () => {
  it('opens on an empty shipment with the step list and the local-only promise', () => {
    expect(text()).toContain('What you still need to do');
    expect(text()).toContain('Nothing is uploaded');
    expect(root.querySelector('.web-step-next')?.textContent).toContain('Import the invoice');
    expect((root.querySelector('.web-shipments select') as HTMLSelectElement).options).toHaveLength(1);
    expect(root.querySelectorAll('.tab')).toHaveLength(7);
  });

  it('walks the whole workflow through the shared tabs and shows provenance and readiness', () => {
    app.update((record) => importWorkbook(record, quickbooks.bytes, quickbooks.fileName, DEFAULT_SETTINGS));
    expect(root.querySelector('.status')?.textContent).toContain('QuickBooks export imported');
    tab('import');
    expect(text()).toContain('CN-1042');
    expect(text()).toContain('Data quality checks');

    // Deckhand: the panels' own tab, fed from the paste box.
    tab('deckhand');
    const box = root.querySelector('textarea') as HTMLTextAreaElement;
    box.value = deckhandText('04-booking-confirmation.txt');
    box.dispatchEvent(new Event('input'));
    button('Extract').click();
    expect(app.record?.extraction?.shipment.containers).toHaveLength(3);
    expect(text()).toContain('MSCU1234566');
    button('Approve Shipment Data').click();
    expect(app.record?.extraction?.approvedAt).not.toBeNull();

    // Package: the panels' own tab.
    tab('package');
    button('Build filing package').click();
    expect(app.record?.pkg?.packageId).toBe('CN-1042_EBKG18531408');
    expect(text()).toContain('Ready.');
    expect(text()).toContain('Deckhand, confirmed by QuickBooks');

    tab('provenance');
    const rows = Array.from(root.querySelectorAll('tbody tr')).map((row) => row.textContent ?? '');
    expect(rows.some((row) => row.includes('Booking reference') && row.includes('EBKG18531408') && row.includes('Deckhand, confirmed by QuickBooks'))).toBe(true);
    expect(rows.some((row) => row.includes('Weight (kg)') && row.includes('176000') && row.includes('0.45359237'))).toBe(true);

    tab('ace');
    expect(text()).toContain('ACE readiness');
    expect(text()).toContain('Mapping status');
    expect(text()).toContain('submit, in ACE yourself');

    tab('inttra');
    expect(text()).toContain('General Details');
    expect(text()).toContain('Copy Container Details');
    expect(text()).toContain('placeholders');
    expect(text()).toContain('submit in INTTRA yourself');

    tab('overview');
    expect(root.querySelector('.web-step-next')?.textContent).toContain('no source holds');
    expect(network).not.toHaveBeenCalled();
  });

  it('downloads the package and the workbook as files written by this page', () => {
    app.update((record) => approveExtraction(buildPackage(extractDocument(importWorkbook(record, quickbooks.bytes, quickbooks.fileName, DEFAULT_SETTINGS), { kind: 'text', text: deckhandText('04-booking-confirmation.txt'), name: 'email' }))));
    tab('overview');
    button('Download filing-package.json').click();
    expect(clicks).toEqual(['filing-package-CN-1042_EBKG18531408.json|blob:dashboard/test']);
    expect(root.querySelector('.status')?.textContent).toContain('written to this machine only');
    button('Download ACE workbook (.xlsx)').click();
    expect(clicks[1]).toBe('ACE_Invoice_CN-1042.xlsx|blob:dashboard/test');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledTimes(0 + 3);
    expect(network).not.toHaveBeenCalled();
  });

  it('holds several shipments side by side and forgets a closed one', () => {
    app.update((record) => importWorkbook(record, quickbooks.bytes, quickbooks.fileName, DEFAULT_SETTINGS));
    button('New shipment').click();
    const select = root.querySelector('.web-shipments select') as HTMLSelectElement;
    expect(select.options).toHaveLength(2);
    expect(app.record?.commercial).toBeNull();
    select.value = select.options[0]!.value;
    select.dispatchEvent(new Event('change'));
    expect(app.record?.commercial?.shipment.invoice.invoiceNumber).toBe('CN-1042');
    tab('overview');
    button('Close shipment').click();
    expect((root.querySelector('.web-shipments select') as HTMLSelectElement).options).toHaveLength(1);
    expect(app.record?.commercial).toBeNull();
  });

  it('reports a refused file in the status line instead of throwing', () => {
    app.update((record) => importWorkbook(record, new TextEncoder().encode('a,b'), 'rows.csv', DEFAULT_SETTINGS));
    expect(root.querySelector('.status')?.className).toContain('status-error');
    expect(root.querySelector('.status')?.textContent).toContain('.xlsx workbook');
    expect(app.record?.commercial).toBeNull();
  });
});
