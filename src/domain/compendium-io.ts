import * as Schema from "effect/Schema";
import { CompendiumPack, compendiumLimits, type Compendium } from "./compendium";

export const exportPack = (compendium: Compendium, name: string): string => {
  const pack: CompendiumPack = {
    format: "ttrpg-pack",
    version: 2,
    name,
    types: compendium.types,
    entries: compendium.entries.map(({ updatedAt: _updatedAt, rev: _rev, ...entry }) => entry),
  };
  return JSON.stringify(pack, null, 2);
};

/** A name as a file name: ASCII letters and digits joined by dashes. */
export const fileSlug = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const packFileName = (name: string): string =>
  `${fileSlug(name) || "compendium"}.ttrpg-pack.json`;

export const parsePack = (
  text: string,
): { ok: true; pack: CompendiumPack } | { ok: false; error: string } => {
  if (new TextEncoder().encode(text).byteLength > compendiumLimits.packBytes)
    return { ok: false, error: "Pack JSON must be at most 4 MB" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
  const header = Schema.decodeUnknownResult(Schema.Struct({ format: Schema.String }))(parsed);
  if (header._tag === "Failure" || header.success.format !== "ttrpg-pack")
    return { ok: false, error: "Expected ttrpg-pack format" };
  const version = Schema.decodeUnknownResult(Schema.Struct({ version: Schema.Literals([1, 2]) }))(
    parsed,
  );
  if (version._tag === "Failure") return { ok: false, error: "Unsupported pack version" };
  const decoded = Schema.decodeUnknownResult(CompendiumPack)(parsed);
  return decoded._tag === "Failure"
    ? { ok: false, error: "Invalid compendium pack data" }
    : { ok: true, pack: decoded.success };
};
