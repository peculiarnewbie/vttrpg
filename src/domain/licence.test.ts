import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { inheritLicence, licenceError, Licence } from "./licence";

const base: Licence = {
  id: "invented-by-sa",
  name: "Example Attribution Share-Alike",
  url: "https://example.org/licence",
  attribution: "Original text by the Lantern Collective.",
  shareAlike: true,
};

it("accepts bounded text attribution without restricting licence identifiers", () => {
  expect(licenceError(base)).toBeUndefined();
  expect(
    licenceError({ ...base, id: "Custom negotiated permission", shareAlike: false }),
  ).toBeUndefined();
  for (const invalid of [
    { ...base, id: " " },
    { ...base, id: "x".repeat(121) },
    { ...base, name: " " },
    { ...base, name: "x".repeat(201) },
    { ...base, attribution: " " },
    { ...base, attribution: "x".repeat(8_001) },
    { ...base, url: "javascript:alert(1)" },
    { ...base, url: "https://secret@example.org/licence" },
    { ...base, url: "not a URL" },
    { ...base, url: `https://example.org/${"x".repeat(2_048)}` },
    { ...base, shareAlike: "yes" },
    { ...base, artwork: true },
    { ...base, endorsement: true },
  ]) {
    expect(licenceError(invalid as Licence)).toBeTypeOf("string");
    expect(() => Schema.decodeUnknownSync(Licence)(invalid)).toThrow();
  }
});

it("retains source rights and attribution despite proposed weakening", () => {
  const proposed = {
    id: "replacement",
    name: "Replacement",
    attribution: "World additions by our group.",
    shareAlike: false,
  };
  expect(inheritLicence(base, proposed)).toEqual({
    ...base,
    attribution: `${base.attribution}\n\n${proposed.attribution}`,
  });
  expect(inheritLicence(base)).toEqual(base);
  expect(inheritLicence(base)).not.toBe(base);
  expect(base.shareAlike).toBe(true);
  expect(proposed.shareAlike).toBe(false);
});

it("does not duplicate inherited attribution and preserves additional obligations", () => {
  expect(inheritLicence(base, base)).toEqual(base);
  const attributed = { ...base, attribution: `${base.attribution}\nAdditional author.` };
  expect(inheritLicence(base, attributed).attribution).toBe(attributed.attribution);
  expect(inheritLicence({ ...base, shareAlike: false }, base).shareAlike).toBe(true);
  expect(() => inheritLicence(base, { ...base, attribution: "" })).toThrow();
});

it("bounds the new combined attribution", () => {
  const long = { ...base, attribution: "a".repeat(4_000) };
  expect(() => inheritLicence(long, { ...base, attribution: "b".repeat(4_000) })).toThrow();
});
