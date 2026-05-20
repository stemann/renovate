import {
  type Env,
  type Expr,
  type Value,
  evaluate,
  findSourceCalls,
  parse,
  processInclude,
  resolveSourceCall,
  stringPartsToLiteral,
  tokenize,
} from './julia.ts';

function asString(v: Value): string {
  if (v.kind !== 'string') {
    throw new Error(`expected resolved string, got ${v.kind}`);
  }
  return v.value;
}

function parseExpr(src: string): Expr {
  const stmts = parse(tokenize(src));
  expect(stmts).toHaveLength(1);
  expect(stmts[0].kind).toBe('expr');
  return (stmts[0] as { kind: 'expr'; expr: Expr }).expr;
}

describe('modules/manager/binarybuilder/julia', () => {
  describe('tokenize()', () => {
    it('skips whitespace, single-line and block comments', () => {
      const toks = tokenize(
        '  # leading comment\n#= block\ncomment =# x = 1 # trailing\n',
      );
      const kinds = toks.map((t) => t.kind);
      expect(kinds).toContain('IDENT');
      expect(kinds).toContain('OP');
      expect(kinds).toContain('NUMBER');
      expect(kinds).toContain('EOF');
    });

    it('handles nested block comments', () => {
      const toks = tokenize('#= outer #= inner =# still outer =# x = 1\n');
      expect(toks.find((t) => t.value === 'x')).toBeDefined();
    });

    it('produces STRING tokens with literal parts only when no interpolation', () => {
      const toks = tokenize('"hello world"');
      expect(toks[0].kind).toBe('STRING');
      expect(toks[0].parts).toEqual([{ kind: 'literal', text: 'hello world' }]);
    });

    it('produces STRING tokens with interp parts for $name and $(expr)', () => {
      const toks = tokenize('"a $name b $(other.field) c"');
      expect(toks[0].kind).toBe('STRING');
      expect(toks[0].parts).toEqual([
        { kind: 'literal', text: 'a ' },
        { kind: 'interp', source: 'name' },
        { kind: 'literal', text: ' b ' },
        { kind: 'interp', source: 'other.field' },
        { kind: 'literal', text: ' c' },
      ]);
    });

    it('handles balanced parens inside interpolation', () => {
      const toks = tokenize('"$(f(a, g(b)))"');
      expect(toks[0].parts).toEqual([{ kind: 'interp', source: 'f(a, g(b))' }]);
    });

    it('handles escape sequences in strings', () => {
      const toks = tokenize('"\\n\\t\\\\\\"\\$end\\0"');
      expect(toks[0].parts).toEqual([
        { kind: 'literal', text: '\n\t\\"$end\0' },
      ]);
    });

    it('handles unknown escape sequences by passing through', () => {
      const toks = tokenize('"\\q"');
      expect(toks[0].parts).toEqual([{ kind: 'literal', text: 'q' }]);
    });

    it('handles v-strings without parsing interpolation', () => {
      const toks = tokenize('v"1.2.3-rc1"');
      expect(toks[0].kind).toBe('VSTRING');
      expect(toks[0].value).toBe('1.2.3-rc1');
    });

    it('handles raw"..." strings (no interpolation)', () => {
      const toks = tokenize('raw"$name not interpolated"');
      expect(toks[0].kind).toBe('STRING');
      expect(toks[0].parts).toEqual([
        { kind: 'literal', text: '$name not interpolated' },
      ]);
    });

    it('handles triple-quoted strings with interpolation', () => {
      const toks = tokenize('"""line\n$x more"""');
      expect(toks[0].kind).toBe('STRING');
      expect(toks[0].parts).toEqual([
        { kind: 'literal', text: 'line\n' },
        { kind: 'interp', source: 'x' },
        { kind: 'literal', text: ' more' },
      ]);
    });

    it('processes \\r and other escape sequences', () => {
      const toks = tokenize('"\\r"');
      expect(toks[0].parts).toEqual([{ kind: 'literal', text: '\r' }]);
    });

    it('handles backslash inside v-strings as escape skip', () => {
      const toks = tokenize('v"1\\".0"');
      expect(toks[0].kind).toBe('VSTRING');
      // The backslash escape skips over the next char, so the closing
      // `"` is the one after `0`. The captured value contains the
      // backslash-escaped quote and `.0`.
      expect(toks[0].value).toBe('1\\".0');
    });

    it('handles backslash inside non-triple raw strings', () => {
      const toks = tokenize('raw"a\\\\b"');
      expect(toks[0].kind).toBe('STRING');
      expect(toks[0].parts).toEqual([{ kind: 'literal', text: 'a\\\\b' }]);
    });

    it('handles escape sequences inside triple-quoted strings', () => {
      const toks = tokenize('"""line\\nbreak"""');
      expect(toks[0].parts).toEqual([{ kind: 'literal', text: 'line\nbreak' }]);
    });

    it('handles raw triple-quoted strings', () => {
      const toks = tokenize('raw"""$x literal $(y)"""');
      expect(toks[0].kind).toBe('STRING');
      expect(toks[0].parts).toEqual([
        { kind: 'literal', text: '$x literal $(y)' },
      ]);
    });

    it('tokenises numbers including decimal and exponent forms', () => {
      const toks = tokenize('1 2.5 1e10 1_000');
      const numbers = toks
        .filter((t) => t.kind === 'NUMBER')
        .map((t) => t.value);
      expect(numbers).toEqual(['1', '2.5', '1e10', '1_000']);
    });

    it('tokenises identifiers that contain `!` continuation chars', () => {
      const toks = tokenize('foo! bar123 _baz');
      const idents = toks.filter((t) => t.kind === 'IDENT').map((t) => t.value);
      expect(idents).toEqual(['foo!', 'bar123', '_baz']);
    });

    it('tokenises multi-character operators (=>, ::, ==, etc.)', () => {
      const toks = tokenize('a => b :: T && c == d || e ... f');
      const ops = toks.filter((t) => t.kind === 'OP').map((t) => t.value);
      expect(ops).toEqual(['=>', '::', '&&', '==', '||', '...']);
    });

    it('handles unterminated single-quote strings without crashing', () => {
      expect(() => tokenize('"unterminated')).not.toThrow();
      expect(() => tokenize('v"unclosed')).not.toThrow();
      expect(() => tokenize('raw"unclosed')).not.toThrow();
      expect(() => tokenize('raw"""unclosed')).not.toThrow();
      expect(() => tokenize('"""unclosed')).not.toThrow();
    });

    it('handles strings that begin with interpolation', () => {
      expect(tokenize('"$x"')[0].parts).toEqual([
        { kind: 'interp', source: 'x' },
      ]);
      expect(tokenize('"""$x"""')[0].parts).toEqual([
        { kind: 'interp', source: 'x' },
      ]);
    });

    it('handles unterminated interpolation `$(...` without crashing', () => {
      expect(() => tokenize('"$(unclosed')).not.toThrow();
    });

    it('skips unknown punctuation characters silently', () => {
      const toks = tokenize('@macrocall x');
      // `@` is unknown and gets skipped; `macrocall` and `x` remain.
      const idents = toks.filter((t) => t.kind === 'IDENT').map((t) => t.value);
      expect(idents).toEqual(['macrocall', 'x']);
    });
  });

  describe('parse()', () => {
    it('parses const-prefixed assignments by stripping the keyword', () => {
      const stmts = parse(tokenize('const x = "literal"\n'));
      expect(stmts).toEqual([
        {
          kind: 'assign',
          name: 'x',
          value: {
            kind: 'string',
            parts: [{ kind: 'literal', text: 'literal' }],
          },
        },
      ]);
    });

    it('parses include with a literal string path', () => {
      const stmts = parse(tokenize('include("../common.jl")\n'));
      expect(stmts).toEqual([{ kind: 'include', path: '../common.jl' }]);
    });

    it('treats include with an interpolated path as skip', () => {
      const stmts = parse(tokenize('include("$dir/common.jl")\n'));
      expect(stmts[0].kind).toBe('skip');
    });

    it('treats include with non-string arg as skip', () => {
      const stmts = parse(tokenize('include(some_path)\n'));
      expect(stmts[0].kind).toBe('skip');
    });

    it('treats include without parens as bare expression', () => {
      // `include` alone (no call) is not a recognised include directive;
      // the parser falls through to an expression statement.
      const stmts = parse(tokenize('include\n'));
      expect(stmts[0].kind).toBe('expr');
    });

    it('skips function definitions until the matching end', () => {
      const stmts = parse(
        tokenize(
          [
            'function f(x)',
            '    if x > 0',
            '        return x',
            '    end',
            'end',
            'after = "kept"',
          ].join('\n'),
        ),
      );
      expect(stmts.some((s) => s.kind === 'skip')).toBe(true);
      const assign = stmts.find((s) => s.kind === 'assign');
      expect(assign).toBeDefined();
      expect(assign?.kind === 'assign' && assign.name).toBe('after');
    });

    it('skips mutable struct and abstract type blocks', () => {
      const stmts = parse(
        tokenize(
          [
            'mutable struct S',
            '    x::Int',
            'end',
            'abstract type T end',
            'after = "kept"',
          ].join('\n'),
        ),
      );
      const assign = stmts.find((s) => s.kind === 'assign');
      expect(assign?.kind === 'assign' && assign.name).toBe('after');
    });

    it('skips using / import / export statements', () => {
      const stmts = parse(
        tokenize(
          [
            'using BinaryBuilder',
            'import Pkg',
            'export foo, bar',
            'x = "kept"',
          ].join('\n'),
        ),
      );
      const assign = stmts.find((s) => s.kind === 'assign');
      expect(assign?.kind === 'assign' && assign.name).toBe('x');
    });

    it('parses Dict literal as a function call expression', () => {
      const expr = parseExpr('Dict("a" => "1", "b" => (source_hash = "abc",))');
      expect(expr.kind).toBe('call');
      expect(expr.kind === 'call' && expr.callee).toBe('Dict');
    });

    it('parses array literals with trailing commas', () => {
      const expr = parseExpr('[1, 2, 3,]');
      expect(expr).toEqual({
        kind: 'array',
        elements: [
          { kind: 'number', value: '1' },
          { kind: 'number', value: '2' },
          { kind: 'number', value: '3' },
        ],
      });
    });

    it('parses parenthesised expressions vs tuples by comma presence', () => {
      const paren = parseExpr('("x")');
      expect(paren.kind).toBe('string');
      const tuple = parseExpr('("x",)');
      expect(tuple.kind).toBe('tuple');
    });

    it('parses named-tuple literals (a = "x", b = "y")', () => {
      const expr = parseExpr('(a = "x", b = "y")');
      expect(expr.kind).toBe('tuple');
      if (expr.kind !== 'tuple') {
        return;
      }
      expect(expr.elements).toEqual([]);
      expect(Object.keys(expr.namedFields).sort()).toEqual(['a', 'b']);
    });

    it('parses keyword args separated from positional args by `;`', () => {
      const expr = parseExpr('f(a, b; kw = "v")');
      expect(expr.kind).toBe('call');
      if (expr.kind !== 'call') {
        return;
      }
      expect(expr.args).toHaveLength(2);
      expect(expr.kwargs.kw).toBeDefined();
    });

    it('parses kwargs that appear before any `;` separator', () => {
      const expr = parseExpr('f(kw = "v", other = "w")');
      expect(expr.kind).toBe('call');
      if (expr.kind !== 'call') {
        return;
      }
      expect(expr.args).toEqual([]);
      expect(Object.keys(expr.kwargs).sort()).toEqual(['kw', 'other']);
    });

    it('discards positional args that appear after `;` in a call', () => {
      // Unusual but the parser should accept it without crashing.
      const expr = parseExpr('f(a; b, c = "x")');
      expect(expr.kind).toBe('call');
      if (expr.kind !== 'call') {
        return;
      }
      expect(expr.args).toHaveLength(1);
      expect(expr.kwargs.c).toBeDefined();
    });

    it('returns unknown primary when parsePrimary is called at EOF', () => {
      // `f(kw=` leaves the parser inside parseCallArgs expecting an
      // expression value for `kw`, with EOF as the next token.
      const stmts = parse(tokenize('f(kw='));
      expect(stmts[0].kind).toBe('expr');
    });

    it('parses chained field access and indexing', () => {
      const expr = parseExpr('a.b[c.d]');
      expect(expr).toEqual({
        kind: 'index',
        obj: {
          kind: 'field',
          obj: { kind: 'ident', name: 'a' },
          name: 'b',
        },
        index: {
          kind: 'field',
          obj: { kind: 'ident', name: 'c' },
          name: 'd',
        },
      });
    });

    it('aborts postfix chain when `.` is followed by non-identifier', () => {
      // `a.[bad]` parses as `a` (an ident expression) followed by a
      // separate statement starting with `.`; the postfix loop bails
      // when the lookahead isn't an identifier.
      const stmts = parse(tokenize('a.[bad]\n'));
      expect(stmts[0].kind).toBe('expr');
      expect((stmts[0] as { expr: Expr }).expr.kind).toBe('ident');
    });

    it('emits unknown when index is unterminated', () => {
      const expr = parseExpr('a[b');
      expect(expr.kind).toBe('unknown');
    });

    it('emits unknown when call args are unterminated', () => {
      const expr = parseExpr('f(a, b');
      expect(expr.kind).toBe('unknown');
    });

    it('parses bare expression statements at the top level', () => {
      const stmts = parse(tokenize('build_tarballs(args)\n'));
      expect(stmts[0].kind).toBe('expr');
    });

    it('handles empty parentheses as an empty tuple', () => {
      const expr = parseExpr('()');
      expect(expr).toEqual({
        kind: 'tuple',
        elements: [],
        namedFields: {},
      });
    });

    it('returns unknown for an unparseable leading token', () => {
      // `=` at the start of an expression yields the `unknown` primary.
      const stmts = parse(tokenize('= bad\n'));
      expect(stmts[0].kind).toBe('expr');
      expect((stmts[0] as { expr: Expr }).expr.kind).toBe('unknown');
    });

    it('parses === as not-an-assignment (treats next token as expression)', () => {
      const stmts = parse(tokenize('x == y\n'));
      // x == y is an expression, not an assignment.
      expect(stmts[0].kind).toBe('expr');
    });
  });

  describe('evaluate()', () => {
    const env: Env = new Map();

    beforeEach(() => {
      env.clear();
    });

    it('resolves a literal string', () => {
      expect(asString(evaluate(parseExpr('"hello"'), env))).toBe('hello');
    });

    it('resolves a v-string as its inner value', () => {
      expect(asString(evaluate(parseExpr('v"1.2.3"'), env))).toBe('1.2.3');
    });

    it('resolves a number expression as its source text', () => {
      expect(asString(evaluate(parseExpr('42'), env))).toBe('42');
    });

    it('resolves identifiers against the env', () => {
      env.set('x', { kind: 'string', value: 'world' });
      expect(asString(evaluate(parseExpr('x'), env))).toBe('world');
    });

    it('returns unresolved for unknown identifiers', () => {
      expect(evaluate(parseExpr('missing'), env)).toEqual({
        kind: 'unresolved',
      });
    });

    it('resolves string interpolation against the env', () => {
      env.set('name', { kind: 'string', value: 'Foo' });
      env.set('v', { kind: 'string', value: '1.0' });
      expect(asString(evaluate(parseExpr('"$name-$(v)"'), env))).toBe(
        'Foo-1.0',
      );
    });

    it('returns unresolved when interpolation references unknown ident', () => {
      expect(evaluate(parseExpr('"$missing"'), env)).toEqual({
        kind: 'unresolved',
      });
    });

    it('resolves Dict() literal and a string-keyed index', () => {
      const dict = evaluate(parseExpr('Dict("k" => (a = "v",))'), env);
      expect(dict.kind).toBe('dict');
      env.set('d', dict);
      const accessed = evaluate(parseExpr('d["k"].a'), env);
      expect(asString(accessed)).toBe('v');
    });

    it('resolves Pair(k, v) as a one-entry dict', () => {
      const v = evaluate(parseExpr('Pair("k", "v")["k"]'), env);
      expect(asString(v)).toBe('v');
    });

    it('returns unresolved for Pair with non-string key', () => {
      expect(evaluate(parseExpr('Pair(x, "v")'), env).kind).toBe('unresolved');
    });

    it('returns unresolved when Dict contains a non-pair argument', () => {
      expect(evaluate(parseExpr('Dict("oops")'), env).kind).toBe('unresolved');
    });

    it('returns unresolved when Dict has an unresolvable key', () => {
      expect(evaluate(parseExpr('Dict(x => "v")'), env).kind).toBe(
        'unresolved',
      );
    });

    it('returns unresolved for index on non-dict / non-array', () => {
      env.set('s', { kind: 'string', value: 'abc' });
      expect(evaluate(parseExpr('s["k"]'), env).kind).toBe('unresolved');
    });

    it('returns unresolved for index with non-string key on dict', () => {
      const dict = evaluate(parseExpr('Dict("k" => "v")'), env);
      env.set('d', dict);
      expect(evaluate(parseExpr('d[missing]'), env).kind).toBe('unresolved');
    });

    it('returns unresolved for missing key on dict', () => {
      const dict = evaluate(parseExpr('Dict("k" => "v")'), env);
      env.set('d', dict);
      expect(evaluate(parseExpr('d["nope"]'), env).kind).toBe('unresolved');
    });

    it('resolves array index by 1-based integer-in-string', () => {
      const arr = evaluate(parseExpr('["a", "b", "c"]'), env);
      env.set('xs', arr);
      expect(asString(evaluate(parseExpr('xs["2"]'), env))).toBe('b');
    });

    it('returns unresolved for out-of-range array index', () => {
      const arr = evaluate(parseExpr('["a"]'), env);
      env.set('xs', arr);
      expect(evaluate(parseExpr('xs["5"]'), env).kind).toBe('unresolved');
    });

    it('resolves field access on a named tuple', () => {
      env.set(
        'pkg',
        evaluate(parseExpr('(name = "foo", version = "1.0")'), env),
      );
      expect(asString(evaluate(parseExpr('pkg.version'), env))).toBe('1.0');
    });

    it('returns unresolved for field access on non-tuple', () => {
      env.set('s', { kind: 'string', value: 'abc' });
      expect(evaluate(parseExpr('s.field'), env).kind).toBe('unresolved');
    });

    it('returns unresolved for missing field on named tuple', () => {
      env.set('t', evaluate(parseExpr('(a = "x",)'), env));
      expect(evaluate(parseExpr('t.missing'), env).kind).toBe('unresolved');
    });

    it('evaluates string() as concatenation', () => {
      env.set('v', { kind: 'string', value: '1.0' });
      expect(asString(evaluate(parseExpr('string("v", v)'), env))).toBe('v1.0');
    });

    it('returns unresolved when string() receives non-string arg', () => {
      expect(evaluate(parseExpr('string(missing)'), env).kind).toBe(
        'unresolved',
      );
    });

    it('evaluates replace(s, "from" => "to")', () => {
      env.set('v', { kind: 'string', value: '1.2.3' });
      expect(asString(evaluate(parseExpr('replace(v, "." => "_")'), env))).toBe(
        '1_2_3',
      );
    });

    it('returns unresolved when replace receives non-string source', () => {
      expect(
        evaluate(parseExpr('replace(missing, "." => "_")'), env).kind,
      ).toBe('unresolved');
    });

    it('returns unresolved when replace receives non-pair pattern', () => {
      env.set('v', { kind: 'string', value: 'abc' });
      expect(evaluate(parseExpr('replace(v, "raw")'), env).kind).toBe(
        'unresolved',
      );
    });

    it('returns unresolved when replace pattern halves are unresolvable', () => {
      env.set('v', { kind: 'string', value: 'abc' });
      expect(evaluate(parseExpr('replace(v, missing => "_")'), env).kind).toBe(
        'unresolved',
      );
    });

    it('evaluates basename() by stripping directory components', () => {
      env.set('u', {
        kind: 'string',
        value: 'https://example.com/a/b/file.tar.gz',
      });
      expect(asString(evaluate(parseExpr('basename(u)'), env))).toBe(
        'file.tar.gz',
      );
    });

    it('evaluates basename() on a slash-free string', () => {
      env.set('u', { kind: 'string', value: 'file.tar.gz' });
      expect(asString(evaluate(parseExpr('basename(u)'), env))).toBe(
        'file.tar.gz',
      );
    });

    it('returns unresolved for basename() with non-string arg', () => {
      expect(evaluate(parseExpr('basename(missing)'), env).kind).toBe(
        'unresolved',
      );
    });

    it('returns unresolved for unknown function calls', () => {
      expect(evaluate(parseExpr('unknown_fn(1)'), env).kind).toBe('unresolved');
    });

    it('returns unresolved for pair and unknown expressions', () => {
      expect(evaluate(parseExpr('"a" => "b"'), env).kind).toBe('unresolved');
    });

    it('evaluates tuples and arrays recursively', () => {
      env.set('x', { kind: 'string', value: 'X' });
      const tuple = evaluate(parseExpr('("a", x, (z = "Z",))'), env);
      expect(tuple.kind).toBe('tuple');
      if (tuple.kind === 'tuple') {
        expect(asString(tuple.elements[0])).toBe('a');
        expect(asString(tuple.elements[1])).toBe('X');
        expect(tuple.elements[2].kind).toBe('tuple');
      }
      const arr = evaluate(parseExpr('["a", x]'), env);
      expect(arr.kind).toBe('array');
      if (arr.kind === 'array') {
        expect(asString(arr.elements[0])).toBe('a');
        expect(asString(arr.elements[1])).toBe('X');
      }
    });

    it('returns unresolved for malformed interpolation source', () => {
      // An interp whose contents fail to parse as a single expression.
      // `;` separates statements; we get >1 stmt back.
      env.set('x', { kind: 'string', value: 'X' });
      expect(evaluate(parseExpr('"$(x; y)"'), env).kind).toBe('unresolved');
    });
  });

  describe('findSourceCalls() / resolveSourceCall()', () => {
    const env: Env = new Map();

    it('finds source-ctor calls nested in arrays, tuples, dicts, pairs, indices, fields', () => {
      const program = parse(
        tokenize(
          [
            'sources = [',
            '    ArchiveSource("u1", "h1"),',
            '    Dict("k" => Pair("a", FileSource("u2", "h2"))),',
            '    (extra = GitSource("u3", "h3"),),',
            '    foo[GitSource("u4", "h4")].field,',
            ']',
          ].join('\n'),
        ),
      );
      const expr = (program[0] as { value: Expr }).value;
      const calls = findSourceCalls(expr);
      const urls = calls.map((c) => c.args[0]);
      expect(urls).toHaveLength(4);
    });

    it('walks into tuple positional elements and kwargs of source calls', () => {
      const expr = parseExpr(
        [
          '(',
          '    "tag",',
          '    ArchiveSource("u-pos", "h-pos"),',
          '    foo(kw = GitSource("u-kw", "h-kw")),',
          ')',
        ].join('\n'),
      );
      const calls = findSourceCalls(expr);
      const urls = calls
        .map((c) => c.args[0])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      expect(urls).toHaveLength(2);
    });

    it('resolves a source call with literal args', () => {
      const expr = parseExpr('ArchiveSource("https://x/file.tar.gz", "abc")');
      const calls = findSourceCalls(expr);
      expect(resolveSourceCall(calls[0], env)).toEqual({
        ctor: 'ArchiveSource',
        url: 'https://x/file.tar.gz',
        hash: 'abc',
      });
    });

    it('returns null when the source call has too few args', () => {
      const expr = parseExpr('ArchiveSource("only-url")');
      const calls = findSourceCalls(expr);
      expect(resolveSourceCall(calls[0], env)).toBeNull();
    });

    it('returns null when args do not resolve to strings', () => {
      const expr = parseExpr('ArchiveSource("https://x/file.tar.gz", missing)');
      const calls = findSourceCalls(expr);
      expect(resolveSourceCall(calls[0], env)).toBeNull();
    });
  });

  describe('processInclude()', () => {
    it('resolves ../ relative paths against the including file', () => {
      expect(
        processInclude('B/Boost@1.83/build_tarballs.jl', '../common.jl'),
      ).toBe('B/common.jl');
    });

    it('handles ./ and bare-filename includes', () => {
      expect(processInclude('B/Boost/build_tarballs.jl', './sibling.jl')).toBe(
        'B/Boost/sibling.jl',
      );
      expect(processInclude('B/Boost/build_tarballs.jl', 'sibling.jl')).toBe(
        'B/Boost/sibling.jl',
      );
    });

    it('handles paths at repo root', () => {
      expect(processInclude('build_tarballs.jl', 'common.jl')).toBe(
        'common.jl',
      );
    });

    it('handles parent-of-parent traversal', () => {
      expect(processInclude('a/b/c/build_tarballs.jl', '../../shared.jl')).toBe(
        'a/shared.jl',
      );
    });
  });

  describe('stringPartsToLiteral()', () => {
    it('joins literal parts', () => {
      expect(
        stringPartsToLiteral([
          { kind: 'literal', text: 'a' },
          { kind: 'literal', text: 'b' },
        ]),
      ).toBe('ab');
    });

    it('returns null when an interp part is present', () => {
      expect(
        stringPartsToLiteral([
          { kind: 'literal', text: 'a' },
          { kind: 'interp', source: 'x' },
        ]),
      ).toBeNull();
    });
  });
});
