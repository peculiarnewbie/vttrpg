import { describe, expect, it } from "vitest";
import {
  computeDerived,
  DERIVED_LIMITS,
  evaluate,
  exprRefs,
  parseExpr,
  type Expr,
  type ExprScope,
} from "./derived";

const expr = (input: string): Expr => {
  const parsed = parseExpr(input);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
};
const run = (input: string, scope: ExprScope = () => undefined) => evaluate(expr(input), scope);
const derived = (key: string, expr: string) => ({ key, label: key, expr });

describe("parseExpr", () => {
  it("builds a typed AST with multiplication before addition", () => {
    expect(parseExpr("1 + 2 * 3")).toEqual({
      ok: true,
      value: {
        kind: "binary",
        op: "+",
        left: { kind: "number", value: 1 },
        right: {
          kind: "binary",
          op: "*",
          left: { kind: "number", value: 2 },
          right: { kind: "number", value: 3 },
        },
      },
    });
  });

  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["8 / 2 / 2", 2],
    ["8 - 3 - 2", 3],
    ["-2 * -3", 6],
    ["--2", 2],
    ["-(2 + 3)", -5],
    ["1.25 + 2.5", 3.75],
    ["2 + 3 > 2 * 2", 1],
    ["  floor ( ( 13 - 10 ) / 2 ) ", 1],
  ])("parses precedence and whitespace in %s", (input, result) => {
    expect(run(input)).toBe(result);
  });

  it("collects every ref in appearance order, including duplicates", () => {
    expect(
      exprRefs(expr("-@str + if(@row.qty >= 2, @{hp-max}, @{pack-items.unit-weight}) + @str")),
    ).toEqual([
      { key: "str" },
      { key: "row", column: "qty" },
      { key: "hp-max" },
      { key: "pack-items", column: "unit-weight" },
      { key: "str" },
    ]);
    expect(exprRefs(expr("1"))).toEqual([]);
    expect(exprRefs(expr("@_key2 + @{inventory.weight}"))).toEqual([
      { key: "_key2" },
      { key: "inventory", column: "weight" },
    ]);
  });

  it.each([
    "floor()",
    "ceil(1,2)",
    "round(1,2)",
    "abs()",
    "min()",
    "max()",
    "if(1,2)",
    "if(1,2,3,4)",
  ])("checks arity in %s", (input) => {
    const parsed = parseExpr(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/needs .*arguments? at 0$/);
  });

  it.each([
    "",
    " ",
    "+1",
    "1e2",
    ".5",
    "1.",
    "1 2",
    "1;2",
    "1 % 2",
    "2 ** 3",
    "2d6",
    "1 < 2 < 3",
    "@9",
    "@str.",
    "@str.dex.mod",
    "@{}",
    "@{a.b.c}",
    "@{a.}",
    "floor(1,)",
    "(1",
    "1)",
    "floor 1",
    "if(,1,2)",
  ])("rejects garbage or incomplete input %j", (input) => {
    expect(parseExpr(input).ok).toBe(false);
  });

  it("reports actionable errors with zero-based positions", () => {
    expect(parseExpr("sqrt(4)")).toEqual({ ok: false, error: "Unknown function “sqrt” at 0" });
    expect(parseExpr("(1 + 2")).toEqual({ ok: false, error: "Expected “)” at 6" });
    expect(parseExpr("1 + ?")).toEqual({ ok: false, error: "Unexpected “?” at 4" });
    expect(parseExpr("@{hp")).toEqual({ ok: false, error: "Expected “}” at 4" });
  });

  it("enforces expression length and nesting at their boundaries", () => {
    expect(parseExpr(`1${" ".repeat(DERIVED_LIMITS.length - 1)}`).ok).toBe(true);
    expect(parseExpr(`1${" ".repeat(DERIVED_LIMITS.length)}`).ok).toBe(false);
    expect(parseExpr(`${"(".repeat(32)}1${")".repeat(32)}`).ok).toBe(true);
    expect(parseExpr(`${"(".repeat(33)}1${")".repeat(33)}`).ok).toBe(false);
    expect(parseExpr(`${"abs(".repeat(32)}1${")".repeat(32)}`).ok).toBe(true);
    expect(parseExpr(`${"abs(".repeat(33)}1${")".repeat(33)}`).ok).toBe(false);
    expect(parseExpr(`${"(".repeat(16)}${"abs(".repeat(17)}1${")".repeat(33)}`).ok).toBe(false);
    expect(run(`${"-".repeat(100)}1`)).toBe(1);
  });
});

describe("evaluate", () => {
  it.each([
    ["3 < 4", 1],
    ["3 <= 3", 1],
    ["3 > 4", 0],
    ["3 >= 3", 1],
    ["3 == 3", 1],
    ["3 != 3", 0],
    ["floor(-1.2)", -2],
    ["ceil(-1.2)", -1],
    ["round(1.5)", 2],
    ["round(-1.5)", -2],
    ["round(-0.5)", -1],
    ["round(-0.4)", 0],
    ["abs(-2)", 2],
    ["min(5, 2, -3)", -3],
    ["max(5, 2, -3)", 5],
    ["min(4)", 4],
    ["if(0, 4, 5)", 5],
    ["if(-1, 4, 5)", 4],
    ["1 / 0", 0],
    ["4 + 1 / 0", 4],
    ["if(2 >= 1, 3, 4)", 3],
  ])("evaluates %s", (input, result) => expect(run(input)).toBe(result));

  it("treats absent and non-finite refs as zero", () => {
    expect(run("@missing + 2")).toBe(2);
    expect(run("@bad + 2", () => Infinity)).toBe(2);
    expect(run("@bad + 2", () => NaN)).toBe(2);
    expect(run("@big * @big", () => Number.MAX_VALUE)).toBe(0);
    expect(evaluate({ kind: "number", value: Infinity }, () => undefined)).toBe(0);
  });

  it("evaluates only the selected if branch and never throws for a throwing scope", () => {
    const reads: string[] = [];
    expect(
      run("if(0, @unused, @used)", (ref) => {
        reads.push(ref.key);
        return 4;
      }),
    ).toBe(4);
    expect(reads).toEqual(["used"]);
    expect(
      run("@broken", () => {
        throw new Error("broken");
      }),
    ).toBe(0);
  });
});

describe("computeDerived", () => {
  it("resolves chains in any order", () => {
    const items = [
      derived("total", "@mod + @level"),
      derived("mod", "floor((@str - 10) / 2)"),
      derived("level", "@base + 1"),
    ];
    const base: ExprScope = (ref) => (ref.key === "str" ? 15 : ref.key === "base" ? 3 : undefined);
    expect(computeDerived(items, base)).toEqual({
      values: { total: 6, mod: 2, level: 4 },
      errors: {},
    });
    expect(computeDerived([...items].reverse(), base)).toEqual(computeDerived(items, base));
  });

  it("memoises shared dependencies so each expression is evaluated once", () => {
    let reads = 0;
    const result = computeDerived(
      [derived("a", "@shared + 1"), derived("b", "@shared + 2"), derived("shared", "@base")],
      () => {
        reads++;
        return 3;
      },
    );
    expect(result.values).toEqual({ a: 4, b: 5, shared: 3 });
    expect(reads).toBe(1);
  });

  it("zeroes self references and cycle members, while dependents use zero without errors", () => {
    const items = [
      derived("downstream", "@a + 5"),
      derived("a", "@b + 1"),
      derived("b", "@a + 2"),
      derived("self", "@self + 7"),
      derived("other", "@self + @downstream"),
    ];
    const expected = {
      values: { downstream: 5, a: 0, b: 0, self: 0, other: 5 },
      errors: { a: "Refers to itself", b: "Refers to itself", self: "Refers to itself" },
    };
    expect(computeDerived(items, () => undefined)).toEqual(expected);
    expect(computeDerived([...items].reverse(), () => undefined)).toEqual(expected);
  });

  it("detects every member of intersecting cycles", () => {
    expect(
      computeDerived(
        [
          derived("a", "@b + @c"),
          derived("b", "@a"),
          derived("c", "@b"),
          derived("dependent", "@c + 9"),
        ],
        () => undefined,
      ),
    ).toEqual({
      values: { a: 0, b: 0, c: 0, dependent: 9 },
      errors: { a: "Refers to itself", b: "Refers to itself", c: "Refers to itself" },
    });
  });

  it("finds syntactic cycles even in unselected branches", () => {
    expect(computeDerived([derived("a", "if(0, @a, 5)")], () => undefined)).toEqual({
      values: { a: 0 },
      errors: { a: "Refers to itself" },
    });
  });

  it("preserves parse errors, and dependent values still compute", () => {
    const result = computeDerived(
      [derived("bad", "1 +"), derived("dependent", "@bad + 4")],
      () => undefined,
    );
    expect(result.values).toEqual({ bad: 0, dependent: 4 });
    expect(result.errors.bad).toBe("Expected an expression at 3");
  });

  it("keeps the first duplicate and treats qualified refs as base refs", () => {
    expect(
      computeDerived([derived("a", "@a.weight + 1"), derived("a", "@a")], (ref) =>
        ref.column ? 2 : 99,
      ),
    ).toEqual({ values: { a: 3 }, errors: {} });
    expect(
      computeDerived([derived("a", "bad()"), derived("a", "3")], () => undefined).values,
    ).toEqual({ a: 0 });
  });

  it("supports keys that match object prototype properties", () => {
    const result = computeDerived(
      [derived("__proto__", "3"), derived("constructor", "@__proto__ + 1")],
      () => undefined,
    );
    expect(Object.keys(result.values)).toEqual(["__proto__", "constructor"]);
    expect(result.values.__proto__).toBe(3);
    expect(result.values.constructor).toBe(4);
    expect(computeDerived([], () => undefined)).toEqual({ values: {}, errors: {} });
  });
});
