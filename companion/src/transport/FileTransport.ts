/**
 * A transport backed by saved qbXML responses.
 *
 * Two real uses beyond tests:
 *
 *  - **Capture once, work offline.** The SDK ships a "Raw Request Processor"
 *    sample that sends a request and saves the response. An operator can run a
 *    query on the QuickBooks machine, copy the XML, and everything downstream -
 *    mapping, preview, export - runs anywhere.
 *  - **Support.** A response file reproduces a mapping problem exactly, with
 *    no QuickBooks needed at the other end.
 */

import { readFileSync } from 'node:fs';
import { requestTypeOf, TransportError, type QbxmlTransport } from './QbxmlTransport.js';

export interface FileTransportOptions {
  /** Response per request type, e.g. { InvoiceQueryRq: '<QBXML>...' }. */
  responses?: Record<string, string>;
  /** Used when no per-type response matches. */
  fallback?: string;
  /** Recorded for the caller: every request that was sent. */
  log?: string[];
}

export class FileQbxmlTransport implements QbxmlTransport {
  readonly id = 'file';

  private readonly responses: Record<string, string>;
  private readonly fallback: string | undefined;
  readonly sent: string[];

  constructor(options: FileTransportOptions = {}) {
    this.responses = options.responses ?? {};
    this.fallback = options.fallback;
    this.sent = options.log ?? [];
  }

  /** Build a transport that answers every request with one saved document. */
  static fromFile(path: string): FileQbxmlTransport {
    let xml: string;
    try {
      xml = readFileSync(path, 'utf8');
    } catch (error) {
      throw new TransportError(`Could not read the saved qbXML response "${path}": ${(error as Error).message}`);
    }
    return new FileQbxmlTransport({ fallback: xml });
  }

  describe(): string {
    const types = Object.keys(this.responses);
    if (types.length) return `saved qbXML responses (${types.join(', ')})`;
    return 'a saved qbXML response';
  }

  async send(requestXml: string): Promise<string> {
    this.sent.push(requestXml);
    const type = requestTypeOf(requestXml);
    const response = this.responses[type] ?? this.fallback;
    if (response === undefined) {
      throw new TransportError(
        `No saved response for ${type || 'this request'}. This transport only replays responses it was given.`,
      );
    }
    return response;
  }

  async close(): Promise<void> {
    // Nothing is held open.
  }
}
