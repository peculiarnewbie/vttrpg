import type { Parsed, Ref } from "./dice-notation";
import type { DerivedValue } from "./sheet-layout";

/*
 * Derived display values: numbers a sheet author defines from other values —
 * a modifier from a score, a total from several fields. They are computed on
 * every render and on the server when a roll refers to them, and never stored
 * or written back (docs/v1-scope.md).
 *
 * Grammar (no eval, a hand-written parser):
 *
 *   expr     := compare
 *   compare  := sum [("<" | "<=" | ">" | ">=" | "==" | "!=") sum]    1 or 0
 *   sum      := product (("+" | "-") product)*
 *   product  := unary (("*" | "/") unary)*
 *   unary    := "-" unary | atom
 *   atom     := number | ref | call | "(" expr ")"
 *   number   := digits ["." digits]
 *   ref      := same as dice notation: @key, @key.column, @{key}
 *   call     := fn "(" expr ("," expr)* ")"
 *   fn       := floor | ceil | round | abs  (1 arg)
 *             | min | max                  (1+ args)
 *             | if                         (3 args: cond, then, else; cond ≠ 0 is true)
 *
 * Example: floor((@str - 10) / 2), @level >= 5, min(@dex_mod, 2),
 * ceil(@level / 4) + 1, sum of a list column via @inventory.weight.
 */

export const DERIVED_LIMITS = {
  /** Characters in one expression. */
  length: 200,
  /** Nesting depth of parentheses and calls. */
  depth: 32,
  /** Derived values per layout. */
  count: 50,
} as const;

export type BinaryOp = "+" | "-" | "*" | "/" | "<" | "<=" | ">" | ">=" | "==" | "!=";
export type Fn = "floor" | "ceil" | "round" | "abs" | "min" | "max" | "if";

export type Expr =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "ref"; readonly ref: Ref }
  | { readonly kind: "negate"; readonly arg: Expr }
  | { readonly kind: "binary"; readonly op: BinaryOp; readonly left: Expr; readonly right: Expr }
  | { readonly kind: "call"; readonly fn: Fn; readonly args: readonly Expr[] };

/**
 * Resolve a ref to a number. `undefined` counts as 0 — an empty field is 0,
 * not an error, so half-filled sheets still show something.
 */
export type ExprScope = (ref: Ref) => number | undefined;

type Token =
  | { kind: "number"; value: number; position: number }
  | { kind: "ref"; ref: Ref; position: number }
  | { kind: "name" | "symbol" | "end"; text: string; position: number };

const fail: (message: string, position: number) => never = (message, position) => {
  throw new Error(`${message} at ${position}`);
};

const tokenize = (input: string): Token[] => {
  const tokens: Token[] = [];
  let position = 0;
  while (position < input.length) {
    const rest = input.slice(position);
    const space = /^\s+/.exec(rest);
    if (space) {
      position += space[0].length;
      continue;
    }
    const start = position;
    if (rest[0] === "@") {
      position++;
      let key: string;
      let column: string | undefined;
      if (input[position] === "{") {
        const close = input.indexOf("}", position + 1);
        if (close < 0) fail("Expected “}”", input.length);
        const parts = input.slice(position + 1, close).split(".");
        if (parts.length > 2 || parts.some((part) => !part.trim() || /[{}]/.test(part)))
          fail("Invalid reference", start);
        [key, column] = parts;
        position = close + 1;
      } else {
        const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(position));
        if (!name) fail("Expected a reference name", position);
        key = name[0];
        position += key.length;
        if (input[position] === ".") {
          position++;
          const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(position));
          if (!name) fail("Expected a column name", position);
          column = name[0];
          position += column.length;
        }
      }
      tokens.push({
        kind: "ref",
        ref: column === undefined ? { key } : { key, column },
        position: start,
      });
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(rest);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]), position: start });
      position += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (name) {
      tokens.push({ kind: "name", text: name[0], position: start });
      position += name[0].length;
      continue;
    }
    const symbol = /^(?:<=|>=|==|!=|[+*/(),<>-])/.exec(rest);
    if (!symbol) fail(`Unexpected “${rest[0]}”`, start);
    tokens.push({ kind: "symbol", text: symbol[0], position: start });
    position += symbol[0].length;
  }
  tokens.push({ kind: "end", text: "", position });
  return tokens;
};

const isFn = (name: string): name is Fn =>
  name === "floor" ||
  name === "ceil" ||
  name === "round" ||
  name === "abs" ||
  name === "min" ||
  name === "max" ||
  name === "if";

/** Parse an expression; errors read like "Expected “)” at 12", "Unknown function “sqrt”". */
export const parseExpr = (input: string): Parsed<Expr> => {
  if (input.length > DERIVED_LIMITS.length)
    return {
      ok: false,
      error: `At most ${DERIVED_LIMITS.length} characters at ${DERIVED_LIMITS.length}`,
    };
  try {
    const tokens = tokenize(input);
    let index = 0;
    const peek = (): Token => tokens[index];
    const accept = (text: string): boolean => {
      const token = peek();
      if (token.kind !== "symbol" || token.text !== text) return false;
      index++;
      return true;
    };
    const expect = (text: string) => {
      if (!accept(text)) fail(`Expected “${text}”`, peek().position);
    };
    const nested = (depth: number, position: number) => {
      if (depth >= DERIVED_LIMITS.depth)
        fail(`At most ${DERIVED_LIMITS.depth} nested parentheses or calls`, position);
      return depth + 1;
    };
    const atom = (depth: number): Expr => {
      const token = peek();
      index++;
      switch (token.kind) {
        case "number":
          return { kind: "number", value: token.value };
        case "ref":
          return { kind: "ref", ref: token.ref };
        case "name": {
          if (!isFn(token.text)) fail(`Unknown function “${token.text}”`, token.position);
          expect("(");
          const nextDepth = nested(depth, token.position);
          const args: Expr[] = [];
          if (!accept(")")) {
            args.push(compare(nextDepth));
            while (accept(",")) args.push(compare(nextDepth));
            expect(")");
          }
          const count =
            token.text === "if" ? 3 : token.text === "min" || token.text === "max" ? undefined : 1;
          if (count === undefined ? args.length === 0 : args.length !== count)
            fail(
              `Function “${token.text}” needs ${count ?? "at least 1"} argument${count === 1 ? "" : "s"}`,
              token.position,
            );
          return { kind: "call", fn: token.text, args };
        }
        case "symbol":
          if (token.text === "(") {
            const expr = compare(nested(depth, token.position));
            expect(")");
            return expr;
          }
          return fail(`Unexpected “${token.text}”`, token.position);
        case "end":
          return fail("Expected an expression", token.position);
      }
    };
    const unary = (depth: number): Expr =>
      accept("-") ? { kind: "negate", arg: unary(depth) } : atom(depth);
    const product = (depth: number): Expr => {
      let left = unary(depth);
      while (true) {
        const token = peek();
        if (token.kind !== "symbol" || (token.text !== "*" && token.text !== "/")) return left;
        index++;
        left = { kind: "binary", op: token.text, left, right: unary(depth) };
      }
    };
    const sum = (depth: number): Expr => {
      let left = product(depth);
      while (true) {
        const token = peek();
        if (token.kind !== "symbol" || (token.text !== "+" && token.text !== "-")) return left;
        index++;
        left = { kind: "binary", op: token.text, left, right: product(depth) };
      }
    };
    const compare = (depth: number): Expr => {
      const left = sum(depth);
      const token = peek();
      if (token.kind !== "symbol") return left;
      switch (token.text) {
        case "<":
        case "<=":
        case ">":
        case ">=":
        case "==":
        case "!=":
          index++;
          return { kind: "binary", op: token.text, left, right: sum(depth) };
        default:
          return left;
      }
    };
    const value = compare(0);
    const trailing = peek();
    if (trailing.kind !== "end") {
      const text =
        trailing.kind === "number"
          ? String(trailing.value)
          : trailing.kind === "ref"
            ? "@"
            : trailing.text;
      fail(`Unexpected “${text}”`, trailing.position);
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid expression" };
  }
};

/** Every ref in the expression, in order of appearance. */
export const exprRefs = (expr: Expr): Ref[] => {
  switch (expr.kind) {
    case "number":
      return [];
    case "ref":
      return [expr.ref];
    case "negate":
      return exprRefs(expr.arg);
    case "binary":
      return [...exprRefs(expr.left), ...exprRefs(expr.right)];
    case "call":
      return expr.args.flatMap(exprRefs);
  }
};

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

/**
 * Evaluate. Never throws: division by zero is 0, comparisons give 1 or 0,
 * and a non-finite result is 0. `round` rounds half away from zero.
 */
export const evaluate = (expr: Expr, scope: ExprScope): number => {
  const visit = (expr: Expr): number => {
    switch (expr.kind) {
      case "number":
        return expr.value;
      case "ref":
        return scope(expr.ref) ?? 0;
      case "negate":
        return -evaluate(expr.arg, scope);
      case "binary": {
        const left = evaluate(expr.left, scope);
        const right = evaluate(expr.right, scope);
        switch (expr.op) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            return right === 0 ? 0 : left / right;
          case "<":
            return Number(left < right);
          case "<=":
            return Number(left <= right);
          case ">":
            return Number(left > right);
          case ">=":
            return Number(left >= right);
          case "==":
            return Number(left === right);
          case "!=":
            return Number(left !== right);
        }
      }
      case "call": {
        if (expr.fn === "if")
          return evaluate(expr.args[evaluate(expr.args[0], scope) !== 0 ? 1 : 2], scope);
        const args = expr.args.map((arg) => evaluate(arg, scope));
        switch (expr.fn) {
          case "floor":
            return Math.floor(args[0]);
          case "ceil":
            return Math.ceil(args[0]);
          case "round":
            return Math.sign(args[0]) * Math.floor(Math.abs(args[0]) + 0.5);
          case "abs":
            return Math.abs(args[0]);
          case "min":
            return Math.min(...args);
          case "max":
            return Math.max(...args);
        }
      }
    }
  };
  try {
    const value = finite(visit(expr));
    return value === 0 ? 0 : value;
  } catch {
    return 0;
  }
};

export type DerivedResult = {
  /** Every derived key → its value (0 when it failed). */
  readonly values: Readonly<Record<string, number>>;
  /** Derived key → why it failed: a parse error, or "Refers to itself" for every key on a cycle. */
  readonly errors: Readonly<Record<string, string>>;
};

/**
 * Compute every derived value. `base` resolves refs to non-derived values
 * (see sheet-refs.ts); a derived value may refer to other derived values in
 * any order.
 */
export const computeDerived = (
  derived: readonly DerivedValue[],
  base: ExprScope,
): DerivedResult => {
  const expressions = new Map<string, Parsed<Expr>>();
  for (const item of derived)
    if (!expressions.has(item.key)) expressions.set(item.key, parseExpr(item.expr));
  const dependencies = new Map(
    [...expressions].map(([key, parsed]) => [
      key,
      parsed.ok
        ? exprRefs(parsed.value)
            .filter((ref) => ref.column === undefined && expressions.has(ref.key))
            .map((ref) => ref.key)
        : [],
    ]),
  );
  const values = new Map<string, number>();
  const errors = new Map<string, string>();
  // With at most 50 keys, checking reachability per key keeps cycle membership explicit,
  // including intersecting cycles, without confusing their downstream dependents.
  for (const [key, parsed] of expressions) {
    if (!parsed.ok) {
      errors.set(key, parsed.error);
      values.set(key, 0);
      continue;
    }
    const seen = new Set<string>();
    const reachesSelf = (current: string): boolean => {
      if (seen.has(current)) return false;
      seen.add(current);
      return (dependencies.get(current) ?? []).some((next) => next === key || reachesSelf(next));
    };
    if (reachesSelf(key)) {
      errors.set(key, "Refers to itself");
      values.set(key, 0);
    }
  }
  const resolve = (key: string): number => {
    const cached = values.get(key);
    if (cached !== undefined) return cached;
    const parsed = expressions.get(key);
    const value = parsed?.ok
      ? evaluate(parsed.value, (ref) =>
          ref.column === undefined && expressions.has(ref.key) ? resolve(ref.key) : base(ref),
        )
      : 0;
    values.set(key, value);
    return value;
  };
  for (const key of expressions.keys()) resolve(key);
  return { values: Object.fromEntries(values), errors: Object.fromEntries(errors) };
};
