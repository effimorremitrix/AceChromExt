/**
 * How a qbXML request reaches QuickBooks.
 *
 * Separating the transport from the adapter is what makes this testable at
 * all: the COM transport needs Windows, a QuickBooks installation, an open
 * company file and a granted certificate, while the file transport needs a
 * saved response. Both answer the same question - "here is a request, give me
 * the response document" - so every layer above them is covered by tests that
 * run anywhere.
 */

export interface QbxmlTransport {
  /** Short identifier used in logs and the preview header. */
  readonly id: string;
  /** One line describing what this transport will actually talk to. */
  describe(): string;
  /** Send a qbXML request document, return the qbXML response document. */
  send(requestXml: string): Promise<string>;
  /** Release anything held open. Safe to call more than once. */
  close(): Promise<void>;
}

export class TransportError extends Error {
  /** Anything QuickBooks or the shell wrote to stderr, when there was any. */
  readonly detail: string;

  constructor(message: string, detail = '') {
    super(message);
    this.name = 'TransportError';
    this.detail = detail;
  }
}

/**
 * The request element of a qbXML document, e.g. "InvoiceQueryRq".
 *
 * The envelope element `QBXMLMsgsRq` also ends in "Rq", so it is skipped: the
 * interesting name is the first one inside it.
 */
export function requestTypeOf(requestXml: string): string {
  const matches = requestXml.matchAll(/<(\w+Rq)[\s>/]/g);
  for (const match of matches) {
    const name = match[1] as string;
    if (name !== 'QBXMLMsgsRq') return name;
  }
  return '';
}
