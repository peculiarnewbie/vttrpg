import * as Schema from "effect/Schema";

export const slugPattern = /^[a-z0-9][a-z0-9_-]{0,59}$/;
export const fieldKeyPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const sha256HexPattern = /^[a-f0-9]{64}$/;
export const MAX_VERSION = 2_147_483_647;

export const isSlug = (value: string): boolean => slugPattern.test(value);
const isLibrarySource = (value: string): boolean => value !== "world";
export const isSourceSlug = (value: string): boolean => isSlug(value) && isLibrarySource(value);
export const isFieldKey = (value: string): boolean => fieldKeyPattern.test(value);
export const isSha256Hex = (value: string): boolean => sha256HexPattern.test(value);
export const isSafePositiveInteger = (value: number, maximum = Number.MAX_SAFE_INTEGER): boolean =>
  Number.isSafeInteger(value) && value >= 1 && value <= maximum;
export const isSafeNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export const Slug = Schema.String.check(Schema.isPattern(slugPattern));
export const SourceSlug = Slug.check(
  Schema.makeFilter(isLibrarySource, { message: "Invalid source id" }),
);
export const FieldKey = Schema.String.check(Schema.isPattern(fieldKeyPattern));
export const Sha256Hex = Schema.String.check(Schema.isPattern(sha256HexPattern));

/** Surrounding whitespace is preserved; only blank strings are rejected. */
export const NonEmptyTrimmed = (maximum: number) =>
  Schema.String.check(
    Schema.isMaxLength(maximum),
    Schema.makeFilter((value) => value.trim().length > 0, { message: "Must not be blank" }),
  );

export const SafePositiveInteger = (maximum = Number.MAX_SAFE_INTEGER) =>
  Schema.Number.check(
    Schema.makeFilter((value) => isSafePositiveInteger(value, maximum), {
      message: "Invalid positive safe integer",
    }),
  );
export const Revision = SafePositiveInteger();
export const Version = Schema.Number.check(
  Schema.makeFilter((value) => isSafePositiveInteger(value, MAX_VERSION), {
    message: "Invalid source version",
  }),
);
export const SafeNonNegativeInteger = Schema.Number.check(
  Schema.makeFilter(isSafeNonNegativeInteger, { message: "Invalid nonnegative safe integer" }),
);

/** JSON-shaped values are decoded by their owning schema; this checks their numbers. */
export const finiteValues = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteValues);
  if (typeof value === "object" && value !== null) return Object.values(value).every(finiteValues);
  return true;
};
export const isFiniteJson = Schema.makeFilter(finiteValues, {
  message: "JSON numbers must be finite",
});
export const FiniteJson = Schema.Json.check(isFiniteJson);

export const jsonBytes = (value: unknown): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(JSON.stringify(value));
export const maxJsonBytes = (maximum: number, message: string) =>
  Schema.makeFilter(
    (value: unknown) => {
      try {
        return jsonBytes(value).byteLength <= maximum;
      } catch {
        return "Must be JSON serializable";
      }
    },
    { message },
  );
