/**
 * The ACE Export Helper window.
 *
 *   Invoice:   [ search ]
 *   Customer:  ...
 *   Date:      ...
 *   Items:     n
 *   [ Preview ]  [ Export ACE Excel ]
 *
 * It is a local web page rather than a desktop shell: an Electron or WebView2
 * wrapper would add a large dependency tree to a repository whose build is
 * checked for exactly that, and buy nothing an operator can see.
 *
 * Local means local:
 *  - the listener binds to 127.0.0.1, so nothing on the network can reach it;
 *  - every request must carry a per-run token, so another program on the same
 *    machine cannot drive it by guessing the port;
 *  - the page loads no external script, style or font, and the response CSP
 *    forbids any outbound connection other than to the page itself.
 *
 * `handleRequest` is a pure function of (method, path, query, body), so the
 * whole UI is testable without opening a socket.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { validateShipment, type ValidationResult } from '../../../src/excel/validator.js';
import type { InvoiceSourceAdapter } from '../adapter/InvoiceSourceAdapter.js';
import type { QbInvoice } from '../qbxml/types.js';
import type { CanonicalMapping } from '../mapping/types.js';
import { renderChecklist, renderPreview } from './preview.js';
import { buildAdapter, type CliIo, type ResolvedOptions } from './cli.js';
import { PAGE_CSS, PAGE_HTML, PAGE_JS } from './page.js';

export interface HttpReply {
  status: number;
  contentType: string;
  body: string;
}

export interface RequestContext {
  adapter: InvoiceSourceAdapter<QbInvoice>;
  token: string;
  options: ResolvedOptions;
}

function json(status: number, payload: unknown): HttpReply {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(payload) };
}

/**
 * No external origins at all, and no inline script: the page's JavaScript is
 * served from its own path so 'unsafe-inline' is never needed.
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; form-action 'none'; base-uri 'none'";

function summaryPayload(mapping: CanonicalMapping, validation: ValidationResult, ascii: boolean): unknown {
  const { invoice, commodities } = mapping.shipment;
  return {
    invoice: {
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customerName,
      invoiceDate: invoice.invoiceDate,
      destination: invoice.destination,
      vessel: invoice.vessel,
      bookingNumber: invoice.bookingNumber,
      containerNumber: invoice.containerNumber,
      sealNumber: invoice.sealNumber,
      carrier: invoice.carrier,
      freightTerms: invoice.freightTerms,
    },
    origins: mapping.origins.invoice,
    itemCount: commodities.length,
    checklist: renderChecklist(mapping, validation, { ascii }),
    preview: renderPreview(mapping, validation, { ascii }),
    errors: validation.errors,
    warnings: validation.warnings,
    unmappedCustomFields: mapping.unmappedCustomFields,
  };
}

export async function handleRequest(
  context: RequestContext,
  method: string,
  path: string,
  query: URLSearchParams,
  body: string,
): Promise<HttpReply> {
  if (method !== 'GET' && method !== 'POST') {
    return json(405, { error: `${method} is not allowed here.` });
  }

  if (path === '/' || path === '/index.html') {
    return { status: 200, contentType: 'text/html; charset=utf-8', body: PAGE_HTML };
  }
  if (path === '/app.js') {
    return { status: 200, contentType: 'text/javascript; charset=utf-8', body: PAGE_JS };
  }
  if (path === '/app.css') {
    return { status: 200, contentType: 'text/css; charset=utf-8', body: PAGE_CSS };
  }

  if (!path.startsWith('/api/')) return json(404, { error: 'Not found.' });

  // The token is what stops any other local process from driving this.
  if (query.get('t') !== context.token) {
    return json(403, { error: 'Wrong or missing token. Reopen the link the command printed.' });
  }

  try {
    if (method === 'GET' && path === '/api/source') {
      return json(200, { label: context.adapter.label, id: context.adapter.id });
    }

    if (method === 'GET' && path === '/api/invoices') {
      const contains = query.get('contains') ?? '';
      const limit = Number(query.get('limit') ?? '25');
      const summaries = await context.adapter.listInvoices({
        ...(contains.trim() === '' ? {} : { referenceContains: contains.trim() }),
        limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 25,
      });
      return json(200, { invoices: summaries });
    }

    if (method === 'GET' && path === '/api/invoice') {
      const id = query.get('id') ?? '';
      if (id.trim() === '') return json(400, { error: 'Which invoice?' });
      const invoice = await context.adapter.getInvoice(id);
      const overrides = readOverrides(query.get('overrides'));
      const mapping = context.adapter.toCanonicalInvoice(invoice, { overrides });
      const validation = validateShipment(mapping.shipment);
      return json(200, summaryPayload(mapping, validation, context.options.ascii));
    }

    if (method === 'POST' && path === '/api/export') {
      const request = parseJsonBody(body);
      const id = typeof request['id'] === 'string' ? request['id'] : '';
      if (id.trim() === '') return json(400, { error: 'Which invoice?' });
      const overrides = readOverrides(request['overrides']);

      const invoice = await context.adapter.getInvoice(id);
      const mapping = context.adapter.toCanonicalInvoice(invoice, { overrides });
      const validation = validateShipment(mapping.shipment);
      const result = await context.adapter.exportAceExcel({
        mapping,
        validation,
        ...(context.options.outputDirectory ? { directory: context.options.outputDirectory } : {}),
        failIfExists: !context.options.force,
      });
      return json(200, { ...result, errors: validation.errors, warnings: validation.warnings });
    }

    return json(404, { error: 'Not found.' });
  } catch (error) {
    return json(400, { error: (error as Error).message });
  }
}

function parseJsonBody(body: string): Record<string, unknown> {
  if (body.trim() === '') return {};
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

/** Field overrides from the form: an object of field -> string, nothing else. */
function readOverrides(raw: unknown): Record<string, string> {
  if (raw === null || raw === undefined || raw === '') return {};
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === '__proto__') continue;
    if (typeof item === 'string' && item.trim() !== '') out[key] = item;
  }
  return out;
}

async function readBody(request: IncomingMessage, limit = 256 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Start the local window and block until the process is stopped. */
export async function runGui(options: ResolvedOptions, io: CliIo): Promise<number> {
  const adapter = buildAdapter(options, io);
  const token = randomBytes(16).toString('hex');
  const context: RequestContext = { adapter, token, options };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const body = request.method === 'POST' ? await readBody(request) : '';
        const reply = await handleRequest(context, request.method ?? 'GET', url.pathname, url.searchParams, body);
        response.writeHead(reply.status, {
          'content-type': reply.contentType,
          'content-security-policy': CONTENT_SECURITY_POLICY,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        });
        response.end(reply.body);
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: (error as Error).message }));
      }
    })();
  });

  return await new Promise<number>((resolvePromise) => {
    server.on('error', (error) => {
      io.err(`Could not start the local window: ${error.message}`);
      resolvePromise(1);
    });
    // 127.0.0.1, never 0.0.0.0: this must not be reachable from the network.
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      io.out('ACE Export Helper is running locally.');
      io.out('');
      io.out(`  http://127.0.0.1:${port}/?t=${token}`);
      io.out('');
      io.out(`Source: ${adapter.label}`);
      io.out('Only this machine can reach it. Press Ctrl+C to stop.');
    });

    const stop = (): void => {
      server.close();
      void adapter.close();
      resolvePromise(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
