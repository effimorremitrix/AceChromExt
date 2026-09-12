/**
 * Safe arithmetic parser.
 *
 * Hand-written tokenizer + recursive-descent parser. There is deliberately NO
 * eval(), no `new Function(...)`, and no dynamic code of any kind: the only
 * thing this module can ever produce is a number or an error.
 *
 * Grammar:
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/') unary)*
 *   unary      := ('+' | '-') unary | primary
 *   primary    := NUMBER | '(' expression ')'
 */

export type CalcErrorCode =
  | 'EMPTY'
  | 'UNSUPPORTED_CHARACTER'
  | 'SYNTAX'
  | 'UNBALANCED_PARENS'
  | 'DIVIDE_BY_ZERO'
  | 'NOT_FINITE';

export class CalcError extends Error {
  readonly code: CalcErrorCode;
  readonly position: number | null;

  constructor(code: CalcErrorCode, message: string, position: number | null = null) {
    super(message);
    this.name = 'CalcError';
    this.code = code;
    this.position = position;
  }
}

type TokenType = 'number' | 'op' | 'lparen' | 'rparen';

interface Token {
  type: TokenType;
  /** Numeric value for 'number' tokens, operator character for 'op'. */
  value: string;
  position: number;
}

const OPERATORS = new Set(['+', '-', '*', '/']);

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * Tokenize an arithmetic expression.
 *
 * Thousands separators are accepted only between digits ("79,833" -> 79833) so
 * that values pasted straight out of a spreadsheet work; a comma anywhere else
 * is an unsupported character.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i] as string;

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    if (OPERATORS.has(ch)) {
      tokens.push({ type: 'op', value: ch, position: i });
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch, position: i });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch, position: i });
      i += 1;
      continue;
    }

    if (isDigit(ch) || ch === '.') {
      const start = i;
      let digits = '';
      let seenDot = false;

      while (i < input.length) {
        const c = input[i] as string;
        if (isDigit(c)) {
          digits += c;
          i += 1;
          continue;
        }
        if (c === '.') {
          if (seenDot) {
            throw new CalcError('SYNTAX', 'A number cannot contain two decimal points.', i);
          }
          seenDot = true;
          digits += c;
          i += 1;
          continue;
        }
        // Thousands separator: only valid strictly between digits, and only
        // before the decimal point.
        if (c === ',' && !seenDot && isDigit(input[i + 1] ?? '') && digits.length > 0) {
          i += 1;
          continue;
        }
        break;
      }

      if (digits === '.' || digits === '') {
        throw new CalcError('SYNTAX', 'Expected a number.', start);
      }

      const parsed = Number(digits);
      if (!Number.isFinite(parsed)) {
        throw new CalcError('NOT_FINITE', `"${digits}" is not a finite number.`, start);
      }

      tokens.push({ type: 'number', value: digits, position: start });
      continue;
    }

    throw new CalcError(
      'UNSUPPORTED_CHARACTER',
      `"${ch}" is not allowed. Use digits, . , + - * / and parentheses.`,
      i,
    );
  }

  return tokens;
}

class Parser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): number {
    if (this.tokens.length === 0) {
      throw new CalcError('EMPTY', 'Enter an expression.');
    }
    const value = this.parseExpression();
    const leftover = this.peek();
    if (leftover) {
      if (leftover.type === 'rparen') {
        throw new CalcError('UNBALANCED_PARENS', 'Unmatched ")".', leftover.position);
      }
      throw new CalcError('SYNTAX', `Unexpected "${leftover.value}".`, leftover.position);
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token | undefined {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  private parseExpression(): number {
    let left = this.parseTerm();
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== 'op' || (token.value !== '+' && token.value !== '-')) {
        return left;
      }
      this.next();
      const right = this.parseTerm();
      left = token.value === '+' ? left + right : left - right;
      this.guardFinite(left, token.position);
    }
  }

  private parseTerm(): number {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (!token || token.type !== 'op' || (token.value !== '*' && token.value !== '/')) {
        return left;
      }
      this.next();
      const right = this.parseUnary();
      if (token.value === '*') {
        left = left * right;
      } else {
        if (right === 0) {
          throw new CalcError('DIVIDE_BY_ZERO', 'Cannot divide by zero.', token.position);
        }
        left = left / right;
      }
      this.guardFinite(left, token.position);
    }
  }

  private parseUnary(): number {
    const token = this.peek();
    if (token && token.type === 'op' && (token.value === '+' || token.value === '-')) {
      this.next();
      const operand = this.parseUnary();
      return token.value === '-' ? -operand : operand;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.next();
    if (!token) {
      throw new CalcError('SYNTAX', 'Expression ends unexpectedly.');
    }

    if (token.type === 'number') {
      return Number(token.value);
    }

    if (token.type === 'lparen') {
      const value = this.parseExpression();
      const closing = this.next();
      if (!closing || closing.type !== 'rparen') {
        throw new CalcError('UNBALANCED_PARENS', 'Missing ")".', token.position);
      }
      return value;
    }

    if (token.type === 'rparen') {
      throw new CalcError('UNBALANCED_PARENS', 'Unmatched ")".', token.position);
    }

    throw new CalcError('SYNTAX', `Unexpected "${token.value}".`, token.position);
  }

  private guardFinite(value: number, position: number): void {
    if (!Number.isFinite(value)) {
      throw new CalcError('NOT_FINITE', 'The result is not a finite number.', position);
    }
  }
}

/**
 * Parse and evaluate an expression.
 * Throws CalcError on any invalid input; never returns NaN or Infinity.
 */
export function parseExpression(input: string): number {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new CalcError('EMPTY', 'Enter an expression.');
  }
  const result = new Parser(tokenize(input)).parse();
  if (Number.isNaN(result)) {
    throw new CalcError('NOT_FINITE', 'The result is not a number.');
  }
  if (!Number.isFinite(result)) {
    throw new CalcError('NOT_FINITE', 'The result is not a finite number.');
  }
  return result;
}
