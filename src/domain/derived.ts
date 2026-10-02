import type { Parsed, Ref } from "./dice-notation";
import type { DerivedValue } from "./sheet-layout";

/*
 * Formulas: values a sheet author defines from other values — a modifier from
 * a score, a total over a list, a label from a choice. They are computed on
 * every render and on the server when a roll refers to them, and never stored
 * or written back (docs/v1-scope.md). Formulas never roll dice: dice belong to
 * roll notation, so a value can't change between two looks at the sheet.
 *
 * Values are numbers or text. Grammar (no eval, a hand-written parser):
 *
 *   expr     := or
 *   or       := and ("or" and)*
 *   and      := not ("and" not)*
 *   not      := "not" not | compare
 *   compare  := sum (("<" | "<=" | ">" | ">=" | "==" | "!=") sum)*   chains: a < b < c
 *   sum      := product (("+" | "-") product)*
 *   product  := unary (("*" | "/" | "%") unary)*
 *   unary    := "-" unary | atom
 *   atom     := number | text | true | false | ref | call | "(" expr ")"
 *   number   := digits ["." digits]
 *   text     := "…" | '…'
 *   ref      := same as dice notation: @key, @key.column, @{key}
 *   call     := fn "(" args ")"
 *
 * Functions:
 *   floor ceil round abs (x)        min max (x, …)        clamp(x, low, high)
 *   if(cond, then, else)            pick(n, first, second, …)       1-based
 *   step(x, 1: a, 5: b, …)          the value at the highest threshold ≤ x (0 below all)
 *   text(a, b, …)                   joins values into text
 *   sum(@list, expr)  highest(@list, expr)  lowest(@list, expr)   over rows; @row is each row
 *   count(@list)  count(@list, cond)  count(@checks)              rows, matching rows, or ticks
 *   has(@checks, "Athletics")       a ticked option, or a list row named so
 *
 * Text compares case-insensitively ("wizard" == "Wizard"); arithmetic reads
 * numeric text as a number and other text as 0; true is 1 and false is 0;
 * "and"/"or"/"not"/comparisons give 1 or 0; text is true when not blank.
 *
 * Examples: floor((@str - 10) / 2), @level >= 5 and @class_name == "Wizard",
 * step(@level, 1: 2, 5: 3, 9: 4, 13: 5, 17: 6), sum(@inventory, @row.slots * @row.qty),
 * count(@spells, @row.prepared), if(@load > @str, "Encumbered", "").
 */

export const DERIVED_LIMITS = {
  /** Characters in one expression. */
  length: 400,
  /** Nesting depth of parentheses and calls. */
  depth: 32,
  /** Derived values per layout. */
  count: 50,
  /** Steps one evaluation may take (aggregates over long lists add up). */
  steps: 50_000,
} as const;

export type Scalar = number | string;

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "and"
  | "or";
export type Fn =
  | "floor"
  | "ceil"
  | "round"
  | "abs"
  | "min"
  | "max"
  | "if"
  | "clamp"
  | "pick"
  | "text";
export type AggregateFn = "sum" | "count" | "highest" | "lowest" | "has";

export type Expr =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "ref"; readonly ref: Ref }
  | { readonly kind: "negate"; readonly arg: Expr }
  | { readonly kind: "not"; readonly arg: Expr }
  | { readonly kind: "binary"; readonly op: BinaryOp; readonly left: Expr; readonly right: Expr }
  | { readonly kind: "call"; readonly fn: Fn; readonly args: readonly Expr[] }
  | {
      readonly kind: "step";
      readonly input: Expr;
      readonly steps: readonly { readonly at: number; readonly value: Expr }[];
    }
  | {
      readonly kind: "aggregate";
      readonly fn: AggregateFn;
      /** The list (or checks) key the function reads. */
      readonly list: string;
      /** Per-row expression (sum, highest, lowest, count) or the option looked for (has). */
      readonly arg?: Expr;
    };

/** One list row: a column's value. */
export type RowScope = (column: string) => Scalar | undefined;

/**
 * What formulas read. `value` resolves a ref; `undefined` counts as empty (0
 * in arithmetic), so half-filled sheets still show something. `rows` gives a
 * list's rows (inside an aggregate, `@row.column` reads the row and every
 * other ref reads `value`); `checked` gives a checks block's ticked options.
 */
export type Scope = {
  readonly value: (ref: Ref) => Scalar | undefined;
  readonly rows?: (key: string) => readonly RowScope[] | undefined;
  readonly checked?: (key: string) => readonly string[] | undefined;
};

/** `scope` with `@row.column` reading `row`. */
export const withRow = (scope: Scope, row: RowScope): Scope => ({
  ...scope,
  value: (ref) =>
    ref.key === "row" ? (ref.column === undefined ? undefined : row(ref.column)) : scope.value(ref),
});
/** A {@link Scope}, or just its `value` resolver. */
export type ExprScope = Scope | ((ref: Ref) => Scalar | undefined);

const toScope = (scope: ExprScope): Scope =>
  typeof scope === "function" ? { value: scope } : scope;

type Token =
  | { kind: "number"; value: number; position: number }
  | { kind: "text"; value: string; position: number }
  | { kind: "ref"; ref: Ref; position: number }
  | { kind: "name" | "symbol" | "end"; text: string; position: number };

const fail: (message: string, position: number) => never = (message, position) => {
  throw new Error(`${message} at ${position}`);
};

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
// "2d6", "d20", "3d6kh2": a formula never rolls.
const DICE = /^\d*d\d+[A-Za-z0-9]*/i;

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
        const name = NAME.exec(input.slice(position));
        if (!name) fail("Expected a reference name", position);
        key = name[0];
        position += key.length;
        if (input[position] === ".") {
          position++;
          const name = NAME.exec(input.slice(position));
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
    if (rest[0] === '"' || rest[0] === "'") {
      const close = input.indexOf(rest[0], position + 1);
      if (close < 0) fail(`Expected a closing ${rest[0]}`, input.length);
      tokens.push({ kind: "text", value: input.slice(position + 1, close), position: start });
      position = close + 1;
      continue;
    }
    const dice = DICE.exec(rest);
    if (dice) fail(`Formulas can't roll dice (“${dice[0]}”); put dice in a roll instead`, start);
    const number = /^\d+(?:\.\d+)?/.exec(rest);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]), position: start });
      position += number[0].length;
      continue;
    }
    const name = NAME.exec(rest);
    if (name) {
      tokens.push({ kind: "name", text: name[0], position: start });
      position += name[0].length;
      continue;
    }
    const symbol = /^(?:<=|>=|==|!=|[+*/%(),:<>-])/.exec(rest);
    if (!symbol) fail(`Unexpected “${rest[0]}”`, start);
    tokens.push({ kind: "symbol", text: symbol[0], position: start });
    position += symbol[0].length;
  }
  tokens.push({ kind: "end", text: "", position });
  return tokens;
};

const FNS: Record<Fn, { min: number; max?: number }> = {
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  round: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  min: { min: 1 },
  max: { min: 1 },
  if: { min: 3, max: 3 },
  clamp: { min: 3, max: 3 },
  pick: { min: 2 },
  text: { min: 1 },
};
const AGGREGATES: Record<AggregateFn, { min: number; max: number; example: string }> = {
  sum: { min: 2, max: 2, example: "sum(@inventory, @row.weight)" },
  highest: { min: 2, max: 2, example: "highest(@weapons, @row.damage)" },
  lowest: { min: 2, max: 2, example: "lowest(@weapons, @row.damage)" },
  count: { min: 1, max: 2, example: "count(@spells, @row.prepared)" },
  has: { min: 2, max: 2, example: 'has(@skills, "Athletics")' },
};
const isFn = (name: string): name is Fn => Object.hasOwn(FNS, name);
const isAggregate = (name: string): name is AggregateFn => Object.hasOwn(AGGREGATES, name);
const COMPARE = new Set(["<", "<=", ">", ">=", "==", "!="]);

const plural = (count: number) => `${count} argument${count === 1 ? "" : "s"}`;

/** Parse an expression; errors read like "Expected “)” at 12", "Unknown function “sqrt” at 0". */
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
    const acceptName = (text: string): boolean => {
      const token = peek();
      if (token.kind !== "name" || token.text !== text) return false;
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
    const args = (depth: number): Expr[] => {
      const list: Expr[] = [];
      if (accept(")")) return list;
      list.push(or(depth));
      while (accept(",")) list.push(or(depth));
      expect(")");
      return list;
    };
    const step = (depth: number): Expr => {
      const input = or(depth);
      const steps: { at: number; value: Expr }[] = [];
      while (accept(",")) {
        const token = peek();
        const negative = accept("-");
        const at = peek();
        if (at.kind !== "number") fail("Expected a threshold number, like 5: 3", at.position);
        index++;
        expect(":");
        const threshold = negative ? -at.value : at.value;
        if (steps.length && threshold <= steps[steps.length - 1].at)
          fail("Thresholds must go up", token.position);
        steps.push({ at: threshold, value: or(depth) });
      }
      expect(")");
      if (!steps.length) fail("“step” needs at least one threshold, like step(@level, 1: 2)", 0);
      return { kind: "step", input, steps };
    };
    const call = (name: { text: string; position: number }, depth: number): Expr => {
      expect("(");
      const inner = nested(depth, name.position);
      if (name.text === "step") return step(inner);
      if (isAggregate(name.text)) {
        const spec = AGGREGATES[name.text];
        const list = peek();
        if (list.kind !== "ref" || list.ref.column !== undefined)
          fail(`“${name.text}” needs a list first, like ${spec.example}`, list.position);
        index++;
        const rest = accept(",") ? [or(inner)] : [];
        expect(")");
        if (rest.length + 1 < spec.min)
          fail(`“${name.text}” needs ${plural(spec.min)}, like ${spec.example}`, name.position);
        return { kind: "aggregate", fn: name.text, list: list.ref.key, arg: rest[0] };
      }
      if (!isFn(name.text)) fail(`Unknown function “${name.text}”`, name.position);
      const list = args(inner);
      const spec = FNS[name.text];
      if (list.length < spec.min || (spec.max !== undefined && list.length > spec.max))
        fail(
          `Function “${name.text}” needs ${spec.max === spec.min ? plural(spec.min) : `at least ${plural(spec.min)}`}`,
          name.position,
        );
      return { kind: "call", fn: name.text, args: list };
    };
    const atom = (depth: number): Expr => {
      const token = peek();
      index++;
      switch (token.kind) {
        case "number":
          return { kind: "number", value: token.value };
        case "text":
          return { kind: "text", value: token.value };
        case "ref":
          return { kind: "ref", ref: token.ref };
        case "name":
          if (token.text === "true") return { kind: "number", value: 1 };
          if (token.text === "false") return { kind: "number", value: 0 };
          if (peek().kind === "symbol" && (peek() as { text: string }).text === "(")
            return call(token, depth);
          return fail(
            isFn(token.text) || isAggregate(token.text) || token.text === "step"
              ? `Expected “(” after “${token.text}”`
              : `Unknown name “${token.text}” (refer to values with @, like @${token.text})`,
            token.position,
          );
        case "symbol":
          if (token.text === "(") {
            const expr = or(nested(depth, token.position));
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
        if (
          token.kind !== "symbol" ||
          (token.text !== "*" && token.text !== "/" && token.text !== "%")
        )
          return left;
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
    // a < b < c means a < b and b < c.
    const compare = (depth: number): Expr => {
      let left = sum(depth);
      let chain: Expr | undefined;
      while (true) {
        const token = peek();
        if (token.kind !== "symbol" || !COMPARE.has(token.text)) return chain ?? left;
        index++;
        const right = sum(depth);
        const link: Expr = { kind: "binary", op: token.text as BinaryOp, left, right };
        chain = chain ? { kind: "binary", op: "and", left: chain, right: link } : link;
        left = right;
      }
    };
    const not = (depth: number): Expr =>
      acceptName("not") ? { kind: "not", arg: not(depth) } : compare(depth);
    const and = (depth: number): Expr => {
      let left = not(depth);
      while (acceptName("and")) left = { kind: "binary", op: "and", left, right: not(depth) };
      return left;
    };
    const or = (depth: number): Expr => {
      let left = and(depth);
      while (acceptName("or")) left = { kind: "binary", op: "or", left, right: and(depth) };
      return left;
    };
    const value = or(0);
    const trailing = peek();
    if (trailing.kind !== "end") {
      const text =
        trailing.kind === "number"
          ? String(trailing.value)
          : trailing.kind === "ref"
            ? "@"
            : trailing.kind === "text"
              ? `"${trailing.value}"`
              : trailing.text;
      fail(`Unexpected “${text}”`, trailing.position);
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid expression" };
  }
};

/**
 * Every ref the expression reads, in order of appearance: a list an
 * aggregate reads counts as `@list`; `@row` refs inside an aggregate are that
 * list's rows, so they're in {@link exprLists} instead.
 */
export const exprRefs = (expr: Expr): Ref[] => {
  switch (expr.kind) {
    case "number":
    case "text":
      return [];
    case "ref":
      return [expr.ref];
    case "negate":
    case "not":
      return exprRefs(expr.arg);
    case "binary":
      return [...exprRefs(expr.left), ...exprRefs(expr.right)];
    case "call":
      return expr.args.flatMap(exprRefs);
    case "step":
      return [...exprRefs(expr.input), ...expr.steps.flatMap((step) => exprRefs(step.value))];
    case "aggregate":
      return [
        { key: expr.list },
        ...(expr.arg ? exprRefs(expr.arg).filter((ref) => ref.key !== "row") : []),
      ];
  }
};

/** The lists aggregates read, with the row columns each reads (for checking they exist). */
export const exprLists = (expr: Expr): { list: string; columns: string[] }[] => {
  switch (expr.kind) {
    case "number":
    case "text":
    case "ref":
      return [];
    case "negate":
    case "not":
      return exprLists(expr.arg);
    case "binary":
      return [...exprLists(expr.left), ...exprLists(expr.right)];
    case "call":
      return expr.args.flatMap(exprLists);
    case "step":
      return [...exprLists(expr.input), ...expr.steps.flatMap((step) => exprLists(step.value))];
    case "aggregate": {
      const columns = expr.arg
        ? exprRefs(expr.arg).flatMap((ref) =>
            ref.key === "row" && ref.column !== undefined ? [ref.column] : [],
          )
        : [];
      return [{ list: expr.list, columns }, ...(expr.arg ? exprLists(expr.arg) : [])];
    }
  }
};

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);
const normal = (value: number): number => {
  const number = finite(value);
  return number === 0 ? 0 : number;
};

/** A value as a number: numeric text reads as its number, other text and empty as 0. */
export const toNumber = (value: Scalar | undefined): number => {
  if (typeof value === "number") return finite(value);
  if (typeof value !== "string" || !value.trim()) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const truthy = (value: Scalar | undefined): boolean =>
  typeof value === "string" ? value.trim() !== "" : toNumber(value) !== 0;
const isNumeric = (value: Scalar | undefined): boolean =>
  typeof value === "number" ||
  (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
const comparable = (value: Scalar | undefined) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const compareValues = (op: BinaryOp, left: Scalar | undefined, right: Scalar | undefined) => {
  // Numbers compare as numbers (empty counts as 0); text compares case-insensitively.
  const numeric =
    (isNumeric(left) || left === undefined) && (isNumeric(right) || right === undefined);
  const a = numeric ? toNumber(left) : comparable(left);
  const b = numeric ? toNumber(right) : comparable(right);
  switch (op) {
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "==":
      return a === b;
    default:
      return a !== b;
  }
};

/** How a number shows as text: integers plainly, others to two places. */
const textOf = (value: Scalar | undefined): string =>
  typeof value === "number"
    ? Number.isInteger(value)
      ? String(value)
      : String(Math.round(value * 100) / 100)
    : (value ?? "");

/** A ref the evaluation read, and what it read: the parts of "where this number comes from". */
export type Term = { readonly ref: Ref; readonly value: Scalar | undefined };

const run = (expr: Expr, input: ExprScope, terms?: Term[]): Scalar => {
  let steps = 0;
  // A value, or `undefined` for an empty ref (so `@name == ""` holds for a blank field).
  const operand = (expr: Expr, scope: Scope, top: boolean): Scalar | undefined => {
    if (expr.kind !== "ref") return visit(expr, scope, top);
    if (++steps > DERIVED_LIMITS.steps) throw new Error("Too many steps");
    const value = scope.value(expr.ref);
    if (top) terms?.push({ ref: expr.ref, value });
    return typeof value === "number" ? finite(value) : value;
  };
  const visit = (expr: Expr, scope: Scope, top: boolean): Scalar => {
    if (++steps > DERIVED_LIMITS.steps) throw new Error("Too many steps");
    switch (expr.kind) {
      case "number":
      case "text":
        return expr.value;
      case "ref":
        return operand(expr, scope, top) ?? 0;
      case "negate":
        return -toNumber(visit(expr.arg, scope, top));
      case "not":
        return Number(!truthy(visit(expr.arg, scope, top)));
      case "binary": {
        if (expr.op === "and")
          return Number(
            truthy(visit(expr.left, scope, top)) && truthy(visit(expr.right, scope, top)),
          );
        if (expr.op === "or")
          return Number(
            truthy(visit(expr.left, scope, top)) || truthy(visit(expr.right, scope, top)),
          );
        const left = operand(expr.left, scope, top);
        const right = operand(expr.right, scope, top);
        if (COMPARE.has(expr.op)) return Number(compareValues(expr.op, left, right));
        const a = toNumber(left);
        const b = toNumber(right);
        switch (expr.op) {
          case "+":
            return a + b;
          case "-":
            return a - b;
          case "*":
            return a * b;
          case "/":
            return b === 0 ? 0 : a / b;
          default:
            return b === 0 ? 0 : a % b;
        }
      }
      case "call": {
        if (expr.fn === "if")
          return visit(expr.args[truthy(visit(expr.args[0], scope, top)) ? 1 : 2], scope, top);
        if (expr.fn === "pick") {
          const index = Math.floor(toNumber(visit(expr.args[0], scope, top)));
          return index >= 1 && index < expr.args.length ? visit(expr.args[index], scope, top) : 0;
        }
        const values = expr.args.map((arg) => visit(arg, scope, top));
        if (expr.fn === "text") return values.map(textOf).join("");
        const args = values.map(toNumber);
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
          default:
            return Math.min(Math.max(args[0], args[1]), args[2]);
        }
      }
      case "step": {
        const at = toNumber(visit(expr.input, scope, top));
        const reached = expr.steps.findLast((step) => step.at <= at);
        return reached ? visit(reached.value, scope, top) : 0;
      }
      case "aggregate": {
        if (top) terms?.push({ ref: { key: expr.list }, value: undefined });
        const rows = scope.rows?.(expr.list);
        if (expr.fn === "has") {
          const wanted = comparable(visit(expr.arg!, scope, top));
          const ticked = scope.checked?.(expr.list);
          if (ticked) return Number(ticked.some((option) => comparable(option) === wanted));
          return Number((rows ?? []).some((row) => comparable(row("name")) === wanted));
        }
        if (expr.fn === "count" && !expr.arg)
          return rows?.length ?? scope.checked?.(expr.list)?.length ?? 0;
        const each = (rows ?? []).map((row) => visit(expr.arg!, withRow(scope, row), false));
        switch (expr.fn) {
          case "count":
            return each.filter(truthy).length;
          case "sum":
            return each.reduce<number>((total, value) => total + toNumber(value), 0);
          case "highest":
            return each.length ? Math.max(...each.map(toNumber)) : 0;
          default:
            return each.length ? Math.min(...each.map(toNumber)) : 0;
        }
      }
    }
  };
  try {
    const value = visit(expr, toScope(input), true);
    return typeof value === "number" ? normal(value) : value;
  } catch {
    return 0;
  }
};

/**
 * Evaluate. Never throws: division by zero is 0, a non-finite result is 0,
 * and a scope that throws or an evaluation past the step limit gives 0.
 * `round` rounds half away from zero.
 */
export const evaluate = (expr: Expr, scope: ExprScope): Scalar => run(expr, scope);

/** {@link evaluate}, as a number (text reads as {@link toNumber} does). */
export const evaluateNumber = (expr: Expr, scope: ExprScope): number =>
  toNumber(evaluate(expr, scope));

/**
 * Evaluate and list what it read: each ref outside per-row expressions, with
 * its value (an aggregate's list is listed with no value). The sheet shows
 * these as "where this number comes from".
 */
export const explain = (expr: Expr, scope: ExprScope): { value: Scalar; terms: Term[] } => {
  const terms: Term[] = [];
  const value = run(expr, scope, terms);
  const seen = new Set<string>();
  return {
    value,
    terms: terms.filter((term) => {
      const id = `${term.ref.key}.${term.ref.column ?? ""}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  };
};

export type DerivedResult = {
  /** Every derived key → its value (0 when it failed). */
  readonly values: Readonly<Record<string, Scalar>>;
  /** Derived key → why it failed: a parse error, or "Refers to itself" for every key on a cycle. */
  readonly errors: Readonly<Record<string, string>>;
};

/**
 * Compute every derived value. `base` resolves refs to non-derived values
 * (see sheet-refs.ts); a derived value may refer to other derived values in
 * any order.
 */
export const computeDerived = (derived: readonly DerivedValue[], base: ExprScope): DerivedResult =>
  computeDerivedWith(derived, () => toScope(base));

/**
 * {@link computeDerived} where the base scope can read derived values too —
 * a list column computed per row (`@row.attack + @prof`) that a derived value
 * sums. `makeBase` gets the finished scope; a value read while it's still
 * being computed (a loop through such a column) reads as 0.
 */
export const computeDerivedWith = (
  derived: readonly DerivedValue[],
  makeBase: (self: Scope) => Scope,
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
  const values = new Map<string, Scalar>();
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
  const pending = new Set<string>();
  const resolve = (key: string): Scalar => {
    const cached = values.get(key);
    if (cached !== undefined) return cached;
    if (pending.has(key)) return 0;
    pending.add(key);
    const parsed = expressions.get(key);
    const value = parsed?.ok ? evaluate(parsed.value, withDerived) : 0;
    pending.delete(key);
    values.set(key, value);
    return value;
  };
  const withDerived: Scope = {
    value: (ref) =>
      ref.column === undefined && expressions.has(ref.key) ? resolve(ref.key) : scope.value(ref),
    rows: (key) => scope.rows?.(key),
    checked: (key) => scope.checked?.(key),
  };
  const scope = makeBase(withDerived);
  for (const key of expressions.keys()) resolve(key);
  return { values: Object.fromEntries(values), errors: Object.fromEntries(errors) };
};
