import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import {
  FieldKey,
  FiniteJson,
  MAX_VERSION,
  NonEmptyTrimmed,
  Revision,
  SafeNonNegativeInteger,
  SafePositiveInteger,
  Sha256Hex,
  Slug,
  SourceSlug,
  Version,
  finiteValues,
  isFieldKey,
  isSafeNonNegativeInteger,
  isSafePositiveInteger,
  isSha256Hex,
  isSlug,
  isSourceSlug,
  jsonBytes,
  maxJsonBytes,
} from "./constraints";

it("shares slug, source and field-key rules with plain predicates", () => {
  for (const [schema, predicate, maximum] of [
    [Slug, isSlug, 60],
    [SourceSlug, isSourceSlug, 60],
    [FieldKey, isFieldKey, 40],
  ] as const) {
    for (const value of ["a", "1", "one-two_three", "x".repeat(maximum)]) {
      expect(predicate(value)).toBe(true);
      expect(Schema.decodeUnknownSync(schema)(value)).toBe(value);
    }
    for (const value of [
      "",
      "_start",
      "-start",
      "Upper",
      "a/b",
      "a.b",
      "a\n",
      "x".repeat(maximum + 1),
    ]) {
      expect(predicate(value)).toBe(false);
      expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow();
    }
  }
  expect(Schema.decodeUnknownSync(Slug)("world")).toBe("world");
  expect(isSourceSlug("world")).toBe(false);
  expect(() => Schema.decodeUnknownSync(SourceSlug)("world")).toThrow();
});

it("requires exactly 64 lowercase hexadecimal digest characters", () => {
  const digest = "0123456789abcdef".repeat(4);
  expect(isSha256Hex(digest)).toBe(true);
  expect(Schema.decodeUnknownSync(Sha256Hex)(digest)).toBe(digest);
  for (const value of ["", digest.slice(1), `${digest}a`, digest.toUpperCase(), "g".repeat(64)]) {
    expect(isSha256Hex(value)).toBe(false);
    expect(() => Schema.decodeUnknownSync(Sha256Hex)(value)).toThrow();
  }
});

it("bounds nonblank text by original length and preserves whitespace", () => {
  const text = NonEmptyTrimmed(5);
  for (const value of ["a", "abcde", " a "])
    expect(Schema.decodeUnknownSync(text)(value)).toBe(value);
  for (const value of ["", " \t\n", "abcdef", "  abc "])
    expect(() => Schema.decodeUnknownSync(text)(value)).toThrow();
});

it("bounds safe revisions, versions and nonnegative ordinals", () => {
  for (const schema of [Revision, SafePositiveInteger()]) {
    expect(Schema.decodeUnknownSync(schema)(1)).toBe(1);
    expect(Schema.decodeUnknownSync(schema)(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isSafePositiveInteger(value)).toBe(false);
      expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow();
    }
  }
  expect(Schema.decodeUnknownSync(Version)(MAX_VERSION)).toBe(MAX_VERSION);
  expect(isSafePositiveInteger(MAX_VERSION + 1, MAX_VERSION)).toBe(false);
  expect(() => Schema.decodeUnknownSync(Version)(MAX_VERSION + 1)).toThrow();
  expect(Schema.decodeUnknownSync(SafePositiveInteger(5))(5)).toBe(5);
  expect(() => Schema.decodeUnknownSync(SafePositiveInteger(5))(6)).toThrow();
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
    expect(isSafeNonNegativeInteger(value)).toBe(true);
    expect(Schema.decodeUnknownSync(SafeNonNegativeInteger)(value)).toBe(value);
  }
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(isSafeNonNegativeInteger(value)).toBe(false);
    expect(() => Schema.decodeUnknownSync(SafeNonNegativeInteger)(value)).toThrow();
  }
});

it("rejects nonfinite numbers anywhere in JSON", () => {
  const valid = { a: [1, { b: -2.5, c: null }], d: true, e: "text" };
  expect(finiteValues(valid)).toBe(true);
  expect(Schema.decodeUnknownSync(FiniteJson)(valid)).toEqual(valid);
  for (const value of [NaN, Infinity, -Infinity, { a: [{ b: NaN }] }, [1, Infinity]]) {
    expect(finiteValues(value)).toBe(false);
    expect(() => Schema.decodeUnknownSync(FiniteJson)(value)).toThrow();
  }
});

it("measures JSON limits in UTF-8 bytes", () => {
  const bounded = Schema.String.check(maxJsonBytes(6, "Too large"));
  expect(jsonBytes("éé").byteLength).toBe(6);
  expect(Schema.decodeUnknownSync(bounded)("éé")).toBe("éé");
  expect(() => Schema.decodeUnknownSync(bounded)("ééé")).toThrow("Too large");
  const serializable = Schema.Unknown.check(maxJsonBytes(100, "Too large"));
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  for (const value of [1n, cycle])
    expect(Schema.decodeUnknownResult(serializable)(value)._tag).toBe("Failure");
});
