/**
 * The qbXML layer: reading the XML, building requests, parsing responses.
 *
 * These are the tests that stand in for a QuickBooks installation. They cannot
 * prove that QuickBooks accepts a request - only a Windows machine with the SDK
 * can do that - but they do prove the request is the shape the schema
 * documents, and that the parser survives what real responses contain.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { childrenNamed, escapeXml, parseXml, textAt, XmlParseError } from '../companion/src/qbxml/xml.js';
import {
  buildCustomerQuery,
  buildEnvelope,
  buildHostQuery,
  buildInvoiceQuery,
  buildInvoiceQueryBody,
  DEFAULT_QBXML_VERSION,
  QbxmlRequestError,
} from '../companion/src/qbxml/requests.js';
import {
  customFieldNames,
  customFieldValue,
  parseHostQueryResponse,
  parseInvoiceQueryResponse,
  parseInvoiceQuerySummaries,
  QbxmlResponseError,
  STATUS_NO_MATCH,
} from '../companion/src/qbxml/parse.js';
import { formatAddress } from '../companion/src/qbxml/types.js';

const FIXTURES = join(__dirname, 'fixtures', 'qbxml');

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('XML reader', () => {
  it('reads elements, attributes and text', () => {
    const root = parseXml('<a x="1"><b>hello</b><c/></a>');
    expect(root.name).toBe('a');
    expect(root.attributes['x']).toBe('1');
    expect(textAt(root, 'b')).toBe('hello');
    expect(childrenNamed(root, 'c')).toHaveLength(1);
  });

  it('decodes the predefined entities and numeric references', () => {
    const root = parseXml('<a>AT&amp;T &lt;x&gt; &quot;q&quot; &#65;&#x42;</a>');
    expect(root.text).toBe('AT&T <x> "q" AB');
  });

  it('keeps CDATA verbatim', () => {
    const root = parseXml('<a><![CDATA[ 1 < 2 & 3 > 2 ]]></a>');
    expect(root.text).toBe('1 < 2 & 3 > 2');
  });

  it('skips comments and processing instructions', () => {
    const root = parseXml('<?xml version="1.0"?><!-- note --><a><?pi data?><b>1</b></a>');
    expect(textAt(root, 'b')).toBe('1');
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseXml('﻿<a>1</a>').text).toBe('1');
  });

  it('refuses a DOCTYPE, so entity expansion attacks cannot start', () => {
    const bomb = '<!DOCTYPE lolz [<!ENTITY lol "lol">]><a>&lol;</a>';
    expect(() => parseXml(bomb)).toThrow(XmlParseError);
    expect(() => parseXml(bomb)).toThrow(/Declarations/);
  });

  it('leaves an unknown entity alone rather than expanding it', () => {
    expect(parseXml('<a>&nbsp;x</a>').text).toBe('&nbsp;x');
  });

  it('does not let an attribute named __proto__ reach Object.prototype', () => {
    const root = parseXml('<a __proto__="polluted">x</a>');
    expect(root.attributes['__proto__']).toBeUndefined();
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.getPrototypeOf(root.attributes)).toBeNull();
  });

  it('rejects mismatched and unterminated tags', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/closes/);
    expect(() => parseXml('<a>text')).toThrow(/never closed/);
    expect(() => parseXml('not xml')).toThrow(/No XML element/);
  });

  it('rejects content after the root element', () => {
    expect(() => parseXml('<a/><b/>')).toThrow(/after the root element/);
    expect(() => parseXml('<a/><!-- fine -->')).not.toThrow();
  });

  it('caps nesting depth', () => {
    const deep = '<a>'.repeat(200) + '</a>'.repeat(200);
    expect(() => parseXml(deep)).toThrow(/nested deeper/);
  });

  it('escapes text for requests', () => {
    expect(escapeXml(`AT&T <"x"> 'y'`)).toBe('AT&amp;T &lt;&quot;x&quot;&gt; &apos;y&apos;');
  });
});

describe('qbXML request building', () => {
  it('wraps requests in the QBXML envelope with a version instruction', () => {
    const xml = buildEnvelope(['    <HostQueryRq requestID="1" />']);
    expect(xml).toContain(`<?qbxml version="${DEFAULT_QBXML_VERSION}"?>`);
    expect(xml).toContain('<QBXMLMsgsRq onError="stopOnError">');
    expect(parseXml(xml).name).toBe('QBXML');
  });

  it('rejects a version that is not N.N', () => {
    expect(() => buildEnvelope([], { version: 'latest' })).toThrow(QbxmlRequestError);
  });

  it('asks for line items and UI custom fields by default', () => {
    const body = buildInvoiceQueryBody({ refNumber: 'CN-1042' });
    expect(body).toContain('<RefNumber>CN-1042</RefNumber>');
    expect(body).toContain('<IncludeLineItems>true</IncludeLineItems>');
    // OwnerID 0 is what makes DataExtRet elements appear at all.
    expect(body).toContain('<OwnerID>0</OwnerID>');
  });

  it('emits filters in schema order, because qbXML validates a sequence', () => {
    const body = buildInvoiceQueryBody({
      maxReturned: 10,
      txnDateFrom: '2026-09-01',
      txnDateTo: '2026-09-30',
      customerFullName: 'Aydin Kuruyemis San Ve Tic A.S',
      refNumberContains: 'CN-',
    });
    const order = ['MaxReturned', 'TxnDateRangeFilter', 'EntityFilter', 'RefNumberFilter', 'IncludeLineItems', 'OwnerID'];
    const positions = order.map((name) => body.indexOf(`<${name}`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('refuses to combine an ID lookup with filters, which the schema forbids', () => {
    expect(() => buildInvoiceQueryBody({ refNumber: 'CN-1042', maxReturned: 5 })).toThrow(/cannot be combined/);
    expect(() => buildInvoiceQueryBody({ txnId: 'A-1', refNumber: 'CN-1042' })).toThrow(/not both/);
  });

  it('insists on YYYY-MM-DD dates', () => {
    expect(() => buildInvoiceQueryBody({ txnDateFrom: '09/21/2026' })).toThrow(/YYYY-MM-DD/);
  });

  it('rejects a nonsensical MaxReturned', () => {
    expect(() => buildInvoiceQueryBody({ maxReturned: 0 })).toThrow(/positive whole number/);
  });

  it('escapes values that would otherwise break the document', () => {
    const body = buildInvoiceQueryBody({ customerFullName: 'Smith & Sons <Export>' });
    expect(body).toContain('<FullName>Smith &amp; Sons &lt;Export&gt;</FullName>');
    expect(() => parseXml(buildInvoiceQuery({ customerFullName: 'Smith & Sons <Export>' }))).not.toThrow();
  });

  it('builds valid customer and host queries', () => {
    expect(parseXml(buildCustomerQuery({ fullName: 'Aydin' })).name).toBe('QBXML');
    expect(buildHostQuery()).toContain('<HostQueryRq');
    expect(() => buildCustomerQuery({ listId: 'A', fullName: 'B' })).toThrow(/not both/);
  });

  it('can suppress line items for a picker query', () => {
    const body = buildInvoiceQueryBody({ maxReturned: 25, includeLineItems: false, ownerIds: [] });
    expect(body).toContain('<IncludeLineItems>false</IncludeLineItems>');
    expect(body).not.toContain('<OwnerID>');
  });
});

describe('qbXML response parsing', () => {
  it('parses the single-line sample invoice', () => {
    const parsed = parseInvoiceQueryResponse(fixture('invoice-single-line.xml'));
    expect(parsed.status.code).toBe(0);
    expect(parsed.results).toHaveLength(1);

    const invoice = parsed.results[0]!;
    expect(invoice.txnId).toBe('2AB4-1758412800');
    expect(invoice.refNumber).toBe('CN-1042');
    expect(invoice.txnDate).toBe('2026-09-21');
    expect(invoice.customer.fullName).toBe('Aydin Kuruyemis San Ve Tic A.S');
    expect(invoice.poNumber).toBe('3993');
    expect(invoice.terms.fullName).toBe('Net 120');
    expect(invoice.dueDate).toBe('2027-01-19');
    expect(invoice.fob).toBe('FOB dock');
    expect(invoice.shipMethod.fullName).toBe('MSC Line');
    expect(invoice.totalAmount).toBe(651217.6);
    expect(invoice.other).toBe('EXPORT');
    expect(invoice.isPending).toBe(false);
  });

  it('prefers the printed address block for display', () => {
    const invoice = parseInvoiceQueryResponse(fixture('invoice-single-line.xml')).results[0]!;
    expect(invoice.billAddress?.country).toBe('Turkey');
    expect(formatAddress(invoice.billAddress)).toBe(
      'Aydin Kuruyemis San Ve Tic A.S, Organize Sanayi Bolgesi 3. Cadde No 14, Aydin 09100, Turkey',
    );
  });

  it('builds a one-line address from the structured fields when no block is given', () => {
    const invoice = parseInvoiceQueryResponse(fixture('invoice-multi-line.xml')).results[0]!;
    expect(formatAddress(invoice.billAddress)).toBe('Aydin Kuruyemis San Ve Tic A.S, Aydin, Turkey');
    expect(formatAddress(null)).toBe('');
  });

  it('parses one invoice line with its unit of measure', () => {
    const invoice = parseInvoiceQueryResponse(fixture('invoice-single-line.xml')).results[0]!;
    expect(invoice.lines).toHaveLength(1);
    const line = invoice.lines[0]!;
    expect(line.item.fullName).toBe('Shelled Almonds');
    expect(line.quantity).toBe(176000);
    expect(line.unitOfMeasure).toBe('lb');
    expect(line.rate).toBe(3.7001);
    expect(line.amount).toBe(651217.6);
    expect(line.groupItem).toBeNull();
  });

  it('parses several lines and flattens group members in document order', () => {
    const invoice = parseInvoiceQueryResponse(fixture('invoice-multi-line.xml')).results[0]!;
    expect(invoice.lines.map((line) => line.item.fullName)).toEqual([
      'Shelled Almonds',
      'Dried Fruit:Dried Prunes',
      'Shelled Almonds',
    ]);
    expect(invoice.lines[2]!.groupItem?.fullName).toBe('Sample Pack');
    expect(invoice.lines[0]!.other1).toBe('LOT-2026-114');
  });

  it('reads custom fields on the invoice and on a line', () => {
    const invoice = parseInvoiceQueryResponse(fixture('invoice-single-line.xml')).results[0]!;
    expect(customFieldValue(invoice.customFields, 'Vessel')).toBe('MSC FIRENZE V.541W');
    expect(customFieldValue(invoice.customFields, 'booking')).toBe('EBKG18531408');
    expect(customFieldValue(invoice.customFields, 'Nope')).toBe('');
    expect(customFieldNames(invoice)).toEqual(['Vessel', 'Booking', 'Container', 'Seal', 'Destination', 'Broker']);

    const multi = parseInvoiceQueryResponse(fixture('invoice-multi-line.xml')).results[0]!;
    expect(customFieldNames(multi)).toContain('Schedule B');
  });

  it('defaults every missing element rather than throwing', () => {
    const invoice = parseInvoiceQueryResponse(fixture('invoice-sparse.xml')).results[0]!;
    expect(invoice.fob).toBe('');
    expect(invoice.terms.fullName).toBe('');
    expect(invoice.dueDate).toBe('');
    expect(invoice.billAddress).toBeNull();
    expect(invoice.totalAmount).toBeNull();
    expect(invoice.customFields).toEqual([]);
    expect(invoice.lines[0]!.amount).toBeNull();
    expect(invoice.lines[0]!.desc).toBe('');
    expect(invoice.lines[0]!.unitOfMeasure).toBe('');
  });

  it('treats "no matching object" as an empty result, not a failure', () => {
    const parsed = parseInvoiceQueryResponse(fixture('no-match.xml'));
    expect(parsed.status.code).toBe(STATUS_NO_MATCH);
    expect(parsed.results).toEqual([]);
  });

  it("reports QuickBooks' own error message for a rejected request", () => {
    expect(() => parseInvoiceQueryResponse(fixture('query-error.xml'))).toThrow(QbxmlResponseError);
    expect(() => parseInvoiceQueryResponse(fixture('query-error.xml'))).toThrow(/status 3000/);
    expect(() => parseInvoiceQueryResponse(fixture('query-error.xml'))).toThrow(/is invalid/);
  });

  it('explains a response that is not the one asked for', () => {
    expect(() => parseInvoiceQueryResponse(fixture('host-query.xml'))).toThrow(/no <InvoiceQueryRs>/);
    expect(() => parseInvoiceQueryResponse('<html>nope</html>')).toThrow(/Expected a <QBXML> response/);
    expect(() => parseInvoiceQueryResponse('not xml at all')).toThrow(/not valid XML/);
  });

  it('summarises a listing without line items', () => {
    const parsed = parseInvoiceQuerySummaries(fixture('invoice-list.xml'));
    expect(parsed.results.map((row) => row.refNumber)).toEqual(['CN-1042', 'CN-1043']);
    expect(parsed.results[0]!.customerName).toBe('Aydin Kuruyemis San Ve Tic A.S');
    expect(parsed.results[0]!.totalAmount).toBe(651217.6);
    expect(parsed.results[0]!.lineCount).toBeNull();
  });

  it('parses the host query, including the qbXML versions on offer', () => {
    const parsed = parseHostQueryResponse(fixture('host-query.xml'));
    const host = parsed.results[0]!;
    expect(host.productName).toBe('QuickBooks Desktop Pro Plus 2024');
    expect(host.country).toBe('US');
    expect(host.supportedQbxmlVersions).toContain('16.0');
  });
});
