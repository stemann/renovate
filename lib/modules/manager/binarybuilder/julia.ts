// Minimal Julia parser/evaluator for `build_tarballs.jl` recipes.
//
// This implements a deliberately narrow subset of Julia: the constructs
// needed to follow `include("../common.jl")` indirection and resolve a
// `versions = Dict("1.2.3" => (source_hash = "...",))` style lookup so
// that an `ArchiveSource(url, hash)` call inside `sources = [...]` can
// be statically evaluated.
//
// What is parsed: top-level assignments, `const` bindings, `include(...)`
// directives, expression statements, string literals (including
// interpolation), v-strings (e.g. `v"1.2.3"`), identifiers, indexing
// (`d["k"]`), field access (`x.field`), function-call expressions,
// array literals, tuple/named-tuple literals, `Dict(...)` literals, and
// `Pair`s written with the `=>` operator.
//
// What is *not* parsed (intentionally): function definitions, loops,
// conditionals, macros (except `v"..."`). Block-like constructs are
// recognised by their leading keyword and skipped until the matching
// `end`, so they do not derail parsing of the rest of the file.

import { logger } from '../../../logger/index.ts';

// =====================================================================
// Token types
// =====================================================================

export type StringPart =
  | { kind: 'literal'; text: string }
  | { kind: 'interp'; source: string };

type TokenKind =
  | 'IDENT'
  | 'STRING'
  | 'VSTRING'
  | 'NUMBER'
  | 'OP'
  | 'NEWLINE'
  | 'EOF';

interface Token {
  kind: TokenKind;
  value: string;
  parts?: StringPart[];
}

const BLOCK_KEYWORDS = new Set([
  'function',
  'if',
  'for',
  'while',
  'begin',
  'try',
  'let',
  'struct',
  'macro',
  'module',
  'quote',
]);

// =====================================================================
// Tokenizer
// =====================================================================

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = src.length;

  const emit = (kind: TokenKind, value: string, parts?: StringPart[]): void => {
    const tok: Token = { kind, value };
    if (parts) {
      tok.parts = parts;
    }
    tokens.push(tok);
  };

  while (i < len) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }

    if (c === '\n') {
      emit('NEWLINE', '\n');
      i++;
      continue;
    }

    // Block comment #= ... =#
    if (c === '#' && src[i + 1] === '=') {
      i += 2;
      let depth = 1;
      while (i + 1 < len && depth > 0) {
        if (src[i] === '#' && src[i + 1] === '=') {
          depth++;
          i += 2;
        } else if (src[i] === '=' && src[i + 1] === '#') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    // Line comment
    if (c === '#') {
      while (i < len && src[i] !== '\n') {
        i++;
      }
      continue;
    }

    // v-string: v"..."
    if (c === 'v' && src[i + 1] === '"') {
      i += 2;
      const start = i;
      while (i < len && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < len) {
          i++;
        }
        i++;
      }
      const value = src.slice(start, i);
      if (i < len) {
        i++;
      }
      emit('VSTRING', value);
      continue;
    }

    // raw"..." (no interpolation)
    if (
      c === 'r' &&
      src[i + 1] === 'a' &&
      src[i + 2] === 'w' &&
      src[i + 3] === '"'
    ) {
      i += 4;
      // Could be raw"..." or raw"""..."""
      if (src[i] === '"' && src[i + 1] === '"') {
        i += 2;
        const start = i;
        while (
          i + 2 < len &&
          !(src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"')
        ) {
          i++;
        }
        const text = src.slice(start, i);
        if (i + 2 < len) {
          i += 3;
        }
        emit('STRING', '', [{ kind: 'literal', text }]);
        continue;
      }
      const start = i;
      while (i < len && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < len) {
          i++;
        }
        i++;
      }
      const text = src.slice(start, i);
      if (i < len) {
        i++;
      }
      emit('STRING', '', [{ kind: 'literal', text }]);
      continue;
    }

    // Triple-quoted string """..."""
    if (c === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
      i += 3;
      const parts: StringPart[] = [];
      let lit = '';
      while (i < len) {
        if (src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
          i += 3;
          break;
        }
        if (src[i] === '$' && i + 1 < len) {
          if (lit) {
            parts.push({ kind: 'literal', text: lit });
            lit = '';
          }
          const interp = readInterp(src, i + 1);
          parts.push({ kind: 'interp', source: interp.source });
          i = interp.next;
          continue;
        }
        if (src[i] === '\\' && i + 1 < len) {
          lit += unescape(src[i + 1]);
          i += 2;
          continue;
        }
        lit += src[i++];
      }
      if (lit) {
        parts.push({ kind: 'literal', text: lit });
      }
      emit('STRING', '', parts);
      continue;
    }

    // Regular string "..."
    if (c === '"') {
      i++;
      const parts: StringPart[] = [];
      let lit = '';
      while (i < len && src[i] !== '"') {
        if (src[i] === '$' && i + 1 < len) {
          if (lit) {
            parts.push({ kind: 'literal', text: lit });
            lit = '';
          }
          const interp = readInterp(src, i + 1);
          parts.push({ kind: 'interp', source: interp.source });
          i = interp.next;
          continue;
        }
        if (src[i] === '\\' && i + 1 < len) {
          lit += unescape(src[i + 1]);
          i += 2;
          continue;
        }
        lit += src[i++];
      }
      if (lit) {
        parts.push({ kind: 'literal', text: lit });
      }
      if (i < len) {
        i++;
      }
      emit('STRING', '', parts);
      continue;
    }

    if (isDigit(c)) {
      const start = i;
      while (
        i < len &&
        (isDigit(src[i]) ||
          src[i] === '.' ||
          src[i] === 'e' ||
          src[i] === 'E' ||
          src[i] === '_')
      ) {
        i++;
      }
      emit('NUMBER', src.slice(start, i));
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (i < len && isIdentCont(src[i])) {
        i++;
      }
      emit('IDENT', src.slice(start, i));
      continue;
    }

    // Multi-char operators (longest first)
    if (src.startsWith('...', i)) {
      emit('OP', '...');
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['=>', '::', '<:', '==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      emit('OP', two);
      i += 2;
      continue;
    }

    if ('=,;.()[]{}+-*/<>&|^!?:%'.includes(c)) {
      emit('OP', c);
      i++;
      continue;
    }

    // Unknown character — skip.
    i++;
  }

  emit('EOF', '');
  return tokens;
}

function readInterp(
  src: string,
  start: number,
): { source: string; next: number } {
  if (src[start] !== '(') {
    let end = start;
    while (end < src.length && isIdentCont(src[end])) {
      end += 1;
    }
    return { source: src.slice(start, end), next: end };
  }
  const innerStart = start + 1;
  let pos = innerStart;
  let depth = 1;
  while (pos < src.length && depth > 0) {
    if (src[pos] === '(') {
      depth += 1;
    } else if (src[pos] === ')') {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
    pos += 1;
  }
  const source = src.slice(innerStart, pos);
  const next = pos < src.length ? pos + 1 : pos;
  return { source, next };
}

function unescape(c: string): string {
  switch (c) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case 'r':
      return '\r';
    case '\\':
      return '\\';
    case '"':
      return '"';
    case '$':
      return '$';
    case '0':
      return '\0';
    default:
      return c;
  }
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isIdentCont(c: string): boolean {
  return isIdentStart(c) || isDigit(c) || c === '!';
}

// =====================================================================
// AST types
// =====================================================================

export type Expr =
  | { kind: 'string'; parts: StringPart[] }
  | { kind: 'vstring'; value: string }
  | { kind: 'ident'; name: string }
  | { kind: 'number'; value: string }
  | { kind: 'index'; obj: Expr; index: Expr }
  | { kind: 'field'; obj: Expr; name: string }
  | {
      kind: 'call';
      callee: string;
      args: Expr[];
      kwargs: Record<string, Expr>;
    }
  | { kind: 'pair'; key: Expr; value: Expr }
  | { kind: 'array'; elements: Expr[] }
  | {
      kind: 'tuple';
      elements: Expr[];
      namedFields: Record<string, Expr>;
    }
  | { kind: 'unknown' };

export type Stmt =
  | { kind: 'assign'; name: string; value: Expr }
  | { kind: 'include'; path: string }
  | { kind: 'expr'; expr: Expr }
  | { kind: 'skip' };

// =====================================================================
// Parser
// =====================================================================

export function parse(tokens: Token[]): Stmt[] {
  return new Parser(tokens).parseProgram();
}

class Parser {
  private i = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    return this.tokens[this.i + offset];
  }

  private advance(): Token {
    return this.tokens[this.i++];
  }

  private match(kind: TokenKind, value?: string): boolean {
    const tok = this.peek();
    if (!tok || tok.kind !== kind) {
      return false;
    }
    return value === undefined || tok.value === value;
  }

  private eat(kind: TokenKind, value?: string): boolean {
    if (this.match(kind, value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private skipNewlines(): void {
    while (this.match('NEWLINE')) {
      this.advance();
    }
  }

  parseProgram(): Stmt[] {
    const stmts: Stmt[] = [];
    this.skipNewlines();
    while (!this.match('EOF')) {
      const stmt = this.parseStatement();
      stmts.push(stmt);
      this.skipNewlines();
    }
    return stmts;
  }

  private parseStatement(): Stmt {
    // `const x = ...` — strip the keyword and re-parse as assignment.
    if (this.match('IDENT', 'const')) {
      this.advance();
    }

    // `mutable struct` / `abstract type` — eat the modifier, fall through
    // to the block-keyword skip below.
    if (
      (this.match('IDENT', 'mutable') || this.match('IDENT', 'abstract')) &&
      this.peek(1)?.kind === 'IDENT' &&
      BLOCK_KEYWORDS.has(this.peek(1).value)
    ) {
      this.advance();
    }

    if (this.match('IDENT')) {
      const ident = this.peek().value;

      if (BLOCK_KEYWORDS.has(ident)) {
        this.skipBlock();
        return { kind: 'skip' };
      }

      if (ident === 'using' || ident === 'import' || ident === 'export') {
        this.advance();
        this.skipToStatementEnd();
        return { kind: 'skip' };
      }

      // include("path")
      if (
        ident === 'include' &&
        this.peek(1)?.kind === 'OP' &&
        this.peek(1).value === '('
      ) {
        this.advance(); // include
        this.advance(); // (
        const arg = this.parseExpression();
        this.eat('OP', ')');
        if (arg.kind === 'string') {
          const literal = stringPartsToLiteral(arg.parts);
          if (literal !== null) {
            return { kind: 'include', path: literal };
          }
        }
        return { kind: 'skip' };
      }

      // Assignment: `ident = expr` (but not `ident == expr`)
      if (
        this.peek(1)?.kind === 'OP' &&
        this.peek(1).value === '=' &&
        this.peek(2)?.value !== '='
      ) {
        const name = this.advance().value;
        this.advance(); // =
        const value = this.parseExpression();
        return { kind: 'assign', name, value };
      }
    }

    const expr = this.parseExpression();
    return { kind: 'expr', expr };
  }

  private skipToStatementEnd(): void {
    while (
      !this.match('NEWLINE') &&
      !this.match('EOF') &&
      !this.match('OP', ';')
    ) {
      this.advance();
    }
  }

  private skipBlock(): void {
    let depth = 1;
    this.advance(); // consume the leading block keyword
    while (depth > 0 && !this.match('EOF')) {
      const tok = this.peek();
      if (tok.kind === 'IDENT') {
        if (BLOCK_KEYWORDS.has(tok.value)) {
          depth++;
        } else if (tok.value === 'end') {
          depth--;
          this.advance();
          continue;
        }
      }
      this.advance();
    }
  }

  parseExpression(): Expr {
    return this.parsePair();
  }

  private parsePair(): Expr {
    const left = this.parsePostfix();
    if (this.eat('OP', '=>')) {
      const right = this.parsePair();
      return { kind: 'pair', key: left, value: right };
    }
    return left;
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    while (true) {
      if (this.match('OP', '.') && this.peek(1)?.kind === 'IDENT') {
        this.advance(); // .
        const name = this.advance().value;
        expr = { kind: 'field', obj: expr, name };
      } else if (this.match('OP', '[')) {
        this.advance();
        this.skipNewlines();
        const index = this.parseExpression();
        this.skipNewlines();
        if (!this.eat('OP', ']')) {
          return { kind: 'unknown' };
        }
        expr = { kind: 'index', obj: expr, index };
      } else if (expr.kind === 'ident' && this.match('OP', '(')) {
        this.advance();
        const { args, kwargs } = this.parseCallArgs();
        if (!this.eat('OP', ')')) {
          return { kind: 'unknown' };
        }
        expr = { kind: 'call', callee: expr.name, args, kwargs };
      } else {
        break;
      }
    }
    return expr;
  }

  private parseCallArgs(): {
    args: Expr[];
    kwargs: Record<string, Expr>;
  } {
    const args: Expr[] = [];
    const kwargs: Record<string, Expr> = {};
    this.skipNewlines();
    while (
      !this.match('OP', ')') &&
      !this.match('OP', ';') &&
      !this.match('EOF')
    ) {
      if (this.isKwargStart()) {
        const name = this.advance().value;
        this.advance(); // =
        kwargs[name] = this.parseExpression();
      } else {
        args.push(this.parseExpression());
      }
      this.skipNewlines();
      if (!this.eat('OP', ',')) {
        break;
      }
      this.skipNewlines();
    }
    // Eat optional `;` separator between positional and kwargs.
    if (this.eat('OP', ';')) {
      this.skipNewlines();
      while (!this.match('OP', ')') && !this.match('EOF')) {
        if (this.isKwargStart()) {
          const name = this.advance().value;
          this.advance();
          kwargs[name] = this.parseExpression();
        } else {
          this.parseExpression();
        }
        this.skipNewlines();
        if (!this.eat('OP', ',')) {
          break;
        }
        this.skipNewlines();
      }
    }
    return { args, kwargs };
  }

  private isKwargStart(): boolean {
    return (
      this.match('IDENT') &&
      this.peek(1)?.kind === 'OP' &&
      this.peek(1).value === '=' &&
      this.peek(2)?.value !== '='
    );
  }

  private parsePrimary(): Expr {
    const tok = this.peek();
    if (!tok || tok.kind === 'EOF') {
      return { kind: 'unknown' };
    }

    if (tok.kind === 'STRING') {
      this.advance();
      /* v8 ignore next -- the tokenizer always sets parts on STRING tokens */
      return { kind: 'string', parts: tok.parts ?? [] };
    }
    if (tok.kind === 'VSTRING') {
      this.advance();
      return { kind: 'vstring', value: tok.value };
    }
    if (tok.kind === 'NUMBER') {
      this.advance();
      return { kind: 'number', value: tok.value };
    }
    if (tok.kind === 'IDENT') {
      this.advance();
      return { kind: 'ident', name: tok.value };
    }
    if (this.eat('OP', '[')) {
      const elements: Expr[] = [];
      this.skipNewlines();
      while (!this.match('OP', ']') && !this.match('EOF')) {
        elements.push(this.parseExpression());
        this.skipNewlines();
        if (!this.eat('OP', ',')) {
          break;
        }
        this.skipNewlines();
      }
      this.eat('OP', ']');
      return { kind: 'array', elements };
    }
    if (this.eat('OP', '(')) {
      this.skipNewlines();
      if (this.eat('OP', ')')) {
        return { kind: 'tuple', elements: [], namedFields: {} };
      }
      const elements: Expr[] = [];
      const namedFields: Record<string, Expr> = {};
      let sawComma = false;
      while (!this.match('OP', ')') && !this.match('EOF')) {
        if (this.isKwargStart()) {
          const name = this.advance().value;
          this.advance();
          namedFields[name] = this.parseExpression();
        } else {
          elements.push(this.parseExpression());
        }
        this.skipNewlines();
        if (!this.eat('OP', ',')) {
          break;
        }
        sawComma = true;
        this.skipNewlines();
      }
      this.eat('OP', ')');
      if (
        !sawComma &&
        elements.length === 1 &&
        Object.keys(namedFields).length === 0
      ) {
        return elements[0];
      }
      return { kind: 'tuple', elements, namedFields };
    }
    // Unknown leading token — return unknown so callers can bail out.
    this.advance();
    return { kind: 'unknown' };
  }
}

// =====================================================================
// Evaluator
// =====================================================================

export type Value =
  | { kind: 'string'; value: string }
  | { kind: 'dict'; entries: Map<string, Value> }
  | {
      kind: 'tuple';
      elements: Value[];
      namedFields: Map<string, Value>;
    }
  | { kind: 'array'; elements: Value[] }
  | { kind: 'unresolved' };

export type Env = Map<string, Value>;

export const UNRESOLVED: Value = { kind: 'unresolved' };

export function evaluate(expr: Expr, env: Env): Value {
  switch (expr.kind) {
    case 'string': {
      let out = '';
      for (const part of expr.parts) {
        if (part.kind === 'literal') {
          out += part.text;
        } else {
          const sub = evaluateInterpSource(part.source, env);
          if (sub.kind !== 'string') {
            return UNRESOLVED;
          }
          out += sub.value;
        }
      }
      return { kind: 'string', value: out };
    }
    case 'vstring':
      return { kind: 'string', value: expr.value };
    case 'number':
      return { kind: 'string', value: expr.value };
    case 'ident': {
      const v = env.get(expr.name);
      return v ?? UNRESOLVED;
    }
    case 'field': {
      const obj = evaluate(expr.obj, env);
      if (obj.kind === 'tuple') {
        return obj.namedFields.get(expr.name) ?? UNRESOLVED;
      }
      return UNRESOLVED;
    }
    case 'index': {
      const obj = evaluate(expr.obj, env);
      const idx = evaluate(expr.index, env);
      if (obj.kind === 'dict' && idx.kind === 'string') {
        return obj.entries.get(idx.value) ?? UNRESOLVED;
      }
      if (obj.kind === 'array' && idx.kind === 'string') {
        const n = Number(idx.value);
        if (Number.isInteger(n) && n >= 1 && n <= obj.elements.length) {
          return obj.elements[n - 1];
        }
      }
      return UNRESOLVED;
    }
    case 'call':
      return evaluateCall(expr, env);
    case 'array': {
      const elements: Value[] = [];
      for (const el of expr.elements) {
        elements.push(evaluate(el, env));
      }
      return { kind: 'array', elements };
    }
    case 'tuple': {
      const elements: Value[] = [];
      const namedFields = new Map<string, Value>();
      for (const el of expr.elements) {
        elements.push(evaluate(el, env));
      }
      for (const [name, value] of Object.entries(expr.namedFields)) {
        namedFields.set(name, evaluate(value, env));
      }
      return { kind: 'tuple', elements, namedFields };
    }
    case 'pair':
    case 'unknown':
      return UNRESOLVED;
  }
}

function evaluateInterpSource(source: string, env: Env): Value {
  // Parse the interp expression source on demand and evaluate it.
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  // parseExpression is private; reach in via the parser's public API by
  // running a tiny "expr = <source>" program and pulling the value back.
  const stmts = parser.parseProgram();
  if (stmts.length === 1 && stmts[0].kind === 'expr') {
    return evaluate(stmts[0].expr, env);
  }
  return UNRESOLVED;
}

function evaluateCall(expr: Extract<Expr, { kind: 'call' }>, env: Env): Value {
  // `Dict(k1 => v1, k2 => v2, ...)` literal.
  if (expr.callee === 'Dict') {
    const entries = new Map<string, Value>();
    for (const arg of expr.args) {
      if (arg.kind !== 'pair') {
        return UNRESOLVED;
      }
      const k = evaluate(arg.key, env);
      if (k.kind !== 'string') {
        return UNRESOLVED;
      }
      entries.set(k.value, evaluate(arg.value, env));
    }
    return { kind: 'dict', entries };
  }

  // `Pair(k, v)`
  if (expr.callee === 'Pair' && expr.args.length === 2) {
    // Represent as a one-entry dict so subsequent indexing works.
    const k = evaluate(expr.args[0], env);
    if (k.kind !== 'string') {
      return UNRESOLVED;
    }
    const entries = new Map<string, Value>();
    entries.set(k.value, evaluate(expr.args[1], env));
    return { kind: 'dict', entries };
  }

  // `string(...)` — concatenate string-coercible args.
  if (expr.callee === 'string') {
    let out = '';
    for (const arg of expr.args) {
      const v = evaluate(arg, env);
      if (v.kind !== 'string') {
        return UNRESOLVED;
      }
      out += v.value;
    }
    return { kind: 'string', value: out };
  }

  // `replace(s, "from" => "to")` — common idiom for `version.replace`.
  if (expr.callee === 'replace' && expr.args.length >= 2) {
    const s = evaluate(expr.args[0], env);
    if (s.kind !== 'string') {
      return UNRESOLVED;
    }
    let out = s.value;
    for (let pi = 1; pi < expr.args.length; pi++) {
      const pair = expr.args[pi];
      if (pair.kind !== 'pair') {
        return UNRESOLVED;
      }
      const from = evaluate(pair.key, env);
      const to = evaluate(pair.value, env);
      if (from.kind !== 'string' || to.kind !== 'string') {
        return UNRESOLVED;
      }
      out = out.split(from.value).join(to.value);
    }
    return { kind: 'string', value: out };
  }

  // `basename(url)` — strip directory components.
  if (expr.callee === 'basename' && expr.args.length === 1) {
    const v = evaluate(expr.args[0], env);
    if (v.kind !== 'string') {
      return UNRESOLVED;
    }
    const idx = v.value.lastIndexOf('/');
    return {
      kind: 'string',
      value: idx === -1 ? v.value : v.value.slice(idx + 1),
    };
  }

  // Anything else: unresolvable in this evaluator.
  return UNRESOLVED;
}

// =====================================================================
// Helpers used by the integration layer
// =====================================================================

export function stringPartsToLiteral(parts: StringPart[]): string | null {
  let out = '';
  for (const part of parts) {
    if (part.kind === 'interp') {
      return null;
    }
    out += part.text;
  }
  return out;
}

export function processInclude(basePath: string, includePath: string): string {
  // Resolve a relative include path against the directory of the
  // including file. Paths in Julia are unix-style.
  const baseDir = basePath.replace(/[^/]+$/, '');
  const segments = (baseDir + includePath).split('/');
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(seg);
  }
  return resolved.join('/');
}

export interface SourceCall {
  ctor: 'ArchiveSource' | 'FileSource' | 'GitSource';
  url: string;
  hash: string;
}

export function findSourceCalls(expr: Expr): Extract<Expr, { kind: 'call' }>[] {
  const out: Extract<Expr, { kind: 'call' }>[] = [];
  walk(expr, out);
  return out;
}

function walk(expr: Expr, out: Extract<Expr, { kind: 'call' }>[]): void {
  switch (expr.kind) {
    case 'call':
      if (
        expr.callee === 'ArchiveSource' ||
        expr.callee === 'FileSource' ||
        expr.callee === 'GitSource'
      ) {
        out.push(expr);
      }
      for (const a of expr.args) {
        walk(a, out);
      }
      for (const a of Object.values(expr.kwargs)) {
        walk(a, out);
      }
      return;
    case 'array':
      for (const e of expr.elements) {
        walk(e, out);
      }
      return;
    case 'tuple':
      for (const e of expr.elements) {
        walk(e, out);
      }
      for (const e of Object.values(expr.namedFields)) {
        walk(e, out);
      }
      return;
    case 'pair':
      walk(expr.key, out);
      walk(expr.value, out);
      return;
    case 'index':
      walk(expr.obj, out);
      walk(expr.index, out);
      return;
    case 'field':
      walk(expr.obj, out);
      return;
    case 'string':
    case 'vstring':
    case 'ident':
    case 'number':
    case 'unknown':
      return;
  }
}

export function resolveSourceCall(
  call: Extract<Expr, { kind: 'call' }>,
  env: Env,
): SourceCall | null {
  if (call.args.length < 2) {
    return null;
  }
  const url = evaluate(call.args[0], env);
  const hash = evaluate(call.args[1], env);
  if (url.kind !== 'string' || hash.kind !== 'string') {
    logger.trace(
      { ctor: call.callee, urlKind: url.kind, hashKind: hash.kind },
      'binarybuilder: AST walker could not resolve source-call args',
    );
    return null;
  }
  return {
    ctor: call.callee as SourceCall['ctor'],
    url: url.value,
    hash: hash.value,
  };
}
