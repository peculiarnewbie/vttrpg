import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Schema from "effect/Schema";

export type Data = Record<string, unknown>;
export const object = (value: unknown): Data =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Data) : {};
export const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const at = (value: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((part, key) => object(part)[key], value);
export const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
export const num = (value: unknown): number => Number(value ?? 0);
export const strings = (value: unknown): string[] => array(value).map(text);
export const title = (value: unknown): string =>
  text(value).replace(/(^|[ -])\w/g, (c) => c.toUpperCase());
export const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

const Document = Schema.Struct({
  _id: Schema.String,
  name: Schema.String,
  type: Schema.optional(Schema.String),
  system: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  items: Schema.optional(Schema.Array(Schema.Unknown)),
  pages: Schema.optional(Schema.Array(Schema.Unknown)),
  flags: Schema.optional(
    Schema.Struct({
      dnd5e: Schema.optional(
        Schema.Struct({
          statBlockOverride: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        }),
      ),
    }),
  ),
});
export type Document = typeof Document.Type;
export type Loaded = { doc: Document; pack: string; file: string };
export const packs = [
  "spells24",
  "actors24",
  "equipment24",
  "classes24",
  "origins24",
  "feats24",
  "content24",
  "tables24",
  "monsterfeatures24",
];

// YAML is already supplied by the Vite+ toolchain; do not add a second parser dependency.
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve("vite-plus/package.json"))("yaml") as {
  parse: (source: string) => unknown;
};
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
    );

export const readDocuments = (dir: string): Loaded[] =>
  packs.flatMap((pack) => {
    const path = join(dir, "packs", "_source", pack);
    // Fixture sources contain only representative packs.
    if (!existsSync(path)) return [];
    return files(path)
      .filter((file) => file.endsWith(".yml") && !file.endsWith("_folder.yml"))
      .map((file) => ({
        doc: Schema.decodeUnknownSync(Document)(yaml.parse(readFileSync(file, "utf8"))),
        pack,
        file,
      }));
  });

export const licensed = (doc: { system?: Data }): boolean =>
  at(doc.system, "source.license") === "CC-BY-4.0" &&
  (at(doc.system, "source.rules") === undefined || text(at(doc.system, "source.rules")) === "2024");
export const activities = (system: unknown): Data[] =>
  Object.values(object(at(system, "activities"))).map(object);
export const abilities: Record<string, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};
export const skills: Record<string, string> = {
  acr: "Acrobatics",
  ani: "Animal Handling",
  arc: "Arcana",
  ath: "Athletics",
  dec: "Deception",
  his: "History",
  ins: "Insight",
  itm: "Intimidation",
  inv: "Investigation",
  med: "Medicine",
  nat: "Nature",
  prc: "Perception",
  prf: "Performance",
  per: "Persuasion",
  rel: "Religion",
  slt: "Sleight of Hand",
  ste: "Stealth",
  sur: "Survival",
};
export const sizes: Record<string, string> = {
  tiny: "Tiny",
  sm: "Small",
  med: "Medium",
  lg: "Large",
  huge: "Huge",
  grg: "Gargantuan",
};
export const mod = (actor: unknown, ability: string): number =>
  Math.floor((num(at(actor, `system.abilities.${ability}.value`)) - 10) / 2);
export const proficiency = (actor: unknown): number =>
  Math.max(2, Math.floor((num(at(actor, "system.details.cr")) - 1) / 4) + 2);

/**
 * Which class lists each spell is on, from the spell-list pages (`type: spells`,
 * one per class) of the rules journal. Only the membership is read — which
 * spell is on which class's list, a fact the SRD states — never the journal's
 * text, which mixes SRD and non-SRD material without licence markers.
 */
export const readSpellLists = (
  dir: string,
  classNames: readonly string[],
): Map<string, string[]> => {
  const lists = new Map<string, string[]>();
  const file = join(dir, "packs", "_source", "content24", "chapter-7", "spells.yml");
  if (!existsSync(file)) return lists;
  const journal = object(yaml.parse(readFileSync(file, "utf8")));
  for (const page of array(journal.pages).map(object)) {
    if (page.type !== "spells" || at(page.system, "type") !== "class") continue;
    const identifier = text(at(page.system, "identifier"));
    const name = classNames.find((candidate) => candidate.toLowerCase() === identifier);
    if (!name) continue;
    for (const uuid of array(at(page.system, "spells")).map(text))
      lists.set(uuid, [...(lists.get(uuid) ?? []), name]);
  }
  return lists;
};
