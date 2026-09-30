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

/** Parse an expression; errors read like "Expected “)” at 12", "Unknown function “sqrt”". */
export const parseExpr = (_input: string): Parsed<Expr> => {
  throw new Error("not implemented");
};

/** Every ref in the expression, in order of appearance. */
export const exprRefs = (_expr: Expr): Ref[] => {
  throw new Error("not implemented");
};

/**
 * Evaluate. Never throws: division by zero is 0, comparisons give 1 or 0,
 * and a non-finite result is 0. `round` rounds half away from zero.
 */
export const evaluate = (_expr: Expr, _scope: ExprScope): number => {
  throw new Error("not implemented");
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
  _derived: readonly DerivedValue[],
  _base: ExprScope,
): DerivedResult => {
  throw new Error("not implemented");
};
