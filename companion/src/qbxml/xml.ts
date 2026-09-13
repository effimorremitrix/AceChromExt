/**
 * A deliberately small XML reader for qbXML responses.
 *
 * Why hand-written rather than a dependency: the repository ships one runtime
 * dependency (SheetJS) and checks its bundles for network and dynamic-code
 * APIs. qbXML is a closed, generated dialect - elements, attributes, text,
 * the odd CDATA - so the subset below is enough, and it can refuse the parts
 * of XML that carry risk instead of implementing them:
 *
 *   - `<!DOCTYPE ...>` is rejected outright, so there are no entity
 *     definitions, no external entities, and no billion-laughs expansion;
 *   - only the five predefined entities and numeric character references are
 *     decoded;
 *   - input size and nesting depth are capped.
 *
 * Attribute bags are null-prototype objects, so an attribute literally called
 * `__proto__` in a response cannot reach Object.prototype.
 */

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlParseError';
  }
}

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text content, entity-decoded and trimmed. */
  text: string;
}

/** 40 MB of XML is far beyond any plausible invoice query response. */
export const MAX_XML_BYTES = 40 * 1024 * 1024;
export const MAX_XML_DEPTH = 100;

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.-]/;

function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    switch (body) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        // An undefined entity is left verbatim rather than expanded: qbXML
        // never emits one, and guessing would be worse than showing it.
        return whole;
    }
  });
}

class Reader {
  private index = 0;

  constructor(private readonly source: string) {}

  get position(): number {
    return this.index;
  }

  eof(): boolean {
    return this.index >= this.source.length;
  }

  peekIs(token: string): boolean {
    return this.source.startsWith(token, this.index);
  }

  advance(count: number): void {
    this.index += count;
  }

  current(): string {
    return this.source.charAt(this.index);
  }

  skipWhitespace(): void {
    while (this.index < this.source.length && /\s/.test(this.source.charAt(this.index))) this.index += 1;
  }

  /** Consume up to and including `token`. Throws when it never appears. */
  skipThrough(token: string, what: string): void {
    const end = this.source.indexOf(token, this.index);
    if (end === -1) throw new XmlParseError(`Unterminated ${what} at offset ${this.index}.`);
    this.index = end + token.length;
  }

  /** Is `token` anywhere in what is left? */
  remainingHas(token: string): boolean {
    return this.source.indexOf(token, this.index) !== -1;
  }

  /** Consume up to `token`, returning the text in between. */
  takeUntil(token: string, what: string): string {
    const end = this.source.indexOf(token, this.index);
    if (end === -1) throw new XmlParseError(`Unterminated ${what} at offset ${this.index}.`);
    const value = this.source.slice(this.index, end);
    this.index = end;
    return value;
  }

  readName(): string {
    const start = this.index;
    if (this.eof() || !NAME_START.test(this.current())) {
      throw new XmlParseError(`Expected an element or attribute name at offset ${this.index}.`);
    }
    this.index += 1;
    while (this.index < this.source.length && NAME_CHAR.test(this.source.charAt(this.index))) this.index += 1;
    return this.source.slice(start, this.index);
  }

  expect(token: string): void {
    if (!this.peekIs(token)) {
      throw new XmlParseError(`Expected "${token}" at offset ${this.index}.`);
    }
    this.index += token.length;
  }
}

function parseAttributes(reader: Reader): Record<string, string> {
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
  for (;;) {
    reader.skipWhitespace();
    if (reader.peekIs('/>') || reader.peekIs('>')) return attributes;
    const name = reader.readName();
    reader.skipWhitespace();
    reader.expect('=');
    reader.skipWhitespace();
    const quote = reader.current();
    if (quote !== '"' && quote !== "'") {
      throw new XmlParseError(`Attribute "${name}" is not quoted at offset ${reader.position}.`);
    }
    reader.advance(1);
    const raw = reader.takeUntil(quote, `attribute "${name}"`);
    reader.advance(1);
    if (name !== '__proto__') attributes[name] = decodeEntities(raw);
  }
}

function parseElement(reader: Reader, depth: number): XmlElement {
  if (depth > MAX_XML_DEPTH) {
    throw new XmlParseError(`XML nested deeper than ${MAX_XML_DEPTH} levels.`);
  }

  reader.expect('<');
  const name = reader.readName();
  const attributes = parseAttributes(reader);

  const element: XmlElement = { name, attributes, children: [], text: '' };

  if (reader.peekIs('/>')) {
    reader.advance(2);
    return element;
  }
  reader.expect('>');

  const textParts: string[] = [];

  for (;;) {
    if (reader.eof()) throw new XmlParseError(`Element <${name}> is never closed.`);

    if (reader.peekIs('</')) {
      reader.advance(2);
      const closing = reader.readName();
      if (closing !== name) {
        throw new XmlParseError(`</${closing}> closes <${name}>.`);
      }
      reader.skipWhitespace();
      reader.expect('>');
      element.text = decodeEntities(textParts.join('')).trim();
      return element;
    }

    if (reader.peekIs('<![CDATA[')) {
      reader.advance('<![CDATA['.length);
      textParts.push(reader.takeUntil(']]>', 'CDATA section'));
      reader.advance(']]>'.length);
      continue;
    }

    if (reader.peekIs('<!--')) {
      reader.advance(4);
      reader.skipThrough('-->', 'comment');
      continue;
    }

    if (reader.peekIs('<?')) {
      reader.advance(2);
      reader.skipThrough('?>', 'processing instruction');
      continue;
    }

    if (reader.peekIs('<!')) {
      throw new XmlParseError('Declarations (DOCTYPE, ENTITY) are not accepted.');
    }

    if (reader.peekIs('<')) {
      element.children.push(parseElement(reader, depth + 1));
      continue;
    }

    // Text that runs to the end of the document means the element never
    // closed; saying so is more useful than "unterminated text".
    if (!reader.remainingHas('<')) throw new XmlParseError(`Element <${name}> is never closed.`);
    textParts.push(reader.takeUntil('<', `text content of <${name}>`));
  }
}

/** Parse a qbXML document and return its root element. */
export function parseXml(input: string): XmlElement {
  if (typeof input !== 'string') throw new XmlParseError('XML input must be a string.');
  if (input.length > MAX_XML_BYTES) {
    throw new XmlParseError(`XML input is larger than ${Math.round(MAX_XML_BYTES / (1024 * 1024))} MB.`);
  }

  // Strip a UTF-8 BOM: QuickBooks writes one when a response is saved to disk.
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const reader = new Reader(source);

  for (;;) {
    reader.skipWhitespace();
    if (reader.peekIs('<?')) {
      reader.advance(2);
      reader.skipThrough('?>', 'processing instruction');
      continue;
    }
    if (reader.peekIs('<!--')) {
      reader.advance(4);
      reader.skipThrough('-->', 'comment');
      continue;
    }
    if (reader.peekIs('<!')) {
      throw new XmlParseError('Declarations (DOCTYPE, ENTITY) are not accepted.');
    }
    break;
  }

  if (!reader.peekIs('<')) throw new XmlParseError('No XML element was found.');

  const root = parseElement(reader, 0);

  reader.skipWhitespace();
  if (!reader.eof()) {
    // Trailing comments or processing instructions are fine; content is not.
    for (;;) {
      reader.skipWhitespace();
      if (reader.eof()) break;
      if (reader.peekIs('<!--')) {
        reader.advance(4);
        reader.skipThrough('-->', 'comment');
        continue;
      }
      if (reader.peekIs('<?')) {
        reader.advance(2);
        reader.skipThrough('?>', 'processing instruction');
        continue;
      }
      throw new XmlParseError(`Unexpected content after the root element at offset ${reader.position}.`);
    }
  }

  return root;
}

// ---------------------------------------------------------------------------
// Navigation helpers. Element names in qbXML are unique enough that a slash
// path ("CustomerRef/FullName") reads better than nested find() calls.
// ---------------------------------------------------------------------------

export function childrenNamed(element: XmlElement | undefined, name: string): XmlElement[] {
  if (!element) return [];
  return element.children.filter((child) => child.name === name);
}

export function childNamed(element: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!element) return undefined;
  return element.children.find((child) => child.name === name);
}

/** Follow a slash-separated path of element names. */
export function elementAt(element: XmlElement | undefined, path: string): XmlElement | undefined {
  let current = element;
  for (const step of path.split('/')) {
    if (!current) return undefined;
    current = childNamed(current, step);
  }
  return current;
}

/** Text at a slash path, or '' when any step is missing. */
export function textAt(element: XmlElement | undefined, path: string): string {
  return elementAt(element, path)?.text ?? '';
}

/** Escape a string for use as XML text or an attribute value. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
