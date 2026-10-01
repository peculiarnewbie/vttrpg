import * as Schema from "effect/Schema";
import { compendiumLimits } from "../../src/domain/compendium";
import type { CharacterValue } from "../../src/domain/schemas";
import { entryError } from "../../src/domain/compendium-rules";
import { parseEntryId } from "../../src/domain/entry-id";
import { splitEntryLinks } from "../../src/domain/entry-links";
import { SourceBundle } from "../../src/domain/source-bundle";

/*
 * One check for every importer's output, run by each importer's tests and by
 * the publish tool before anything is uploaded. It answers "would this publish
 * cleanly and read well?": the bundle decodes, ids are stable and belong to the
 * source, every entry passes the compendium's own rules within the published
 * size budget, links resolve, and no upstream markup survived.
 */

/** Markup that must not reach readers: Foundry enrichers, HTML, Datasworn links, images. */
const LEFTOVERS: [RegExp, string][] = [
  [/@UUID\[|@Compendium\[|@Embed\[|&Reference\[|@scale\.|@item\.|@details\./, "Foundry enricher"],
  [/\[\[(?:\/|lookup|\/r|\/damage|\/check|\/save)/, "Foundry inline roll or lookup"],
  [/<\/?(?:p|div|span|strong|em|section|table|tr|td|th|ul|ol|li|h\d|br|a)\b/i, "HTML tag"],
  [/\]\(id:|\{\{table[^}]*\}\}|\{\{text[^}]*\}\}/, "Datasworn link or embed"],
  [/\.(?:webp|png|jpe?g|svg)\b|!\[[^\]]*\]\(/i, "image"],
];

/** Room for what publishing adds to each entry (licence, revision, version). */
const publishedBytes = (entry: object, licence: object) =>
  new TextEncoder().encode(
    JSON.stringify({
      ...entry,
      rev: Number.MAX_SAFE_INTEGER,
      licence,
      sourceVersion: 2147483647,
      sourceRev: Number.MAX_SAFE_INTEGER,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
  ).byteLength;

const texts = (value: CharacterValue | undefined): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.flatMap((item) =>
      typeof item === "string"
        ? [item]
        : typeof item === "object" && item !== null
          ? Object.values(item).flatMap((cell) => (typeof cell === "string" ? [cell] : []))
          : [],
    );
  return [];
};

export type BundleReport = {
  problems: string[];
  /** Entries per type id. */
  counts: Record<string, number>;
  /** Largest published entry in bytes, for the size report. */
  largest: { id: string; bytes: number } | undefined;
};

export const validateBundle = (value: unknown): BundleReport => {
  const problems: string[] = [];
  const decoded = Schema.decodeUnknownResult(SourceBundle)(value);
  if (decoded._tag === "Failure")
    return {
      problems: [`Bundle does not decode: ${decoded.failure.message}`],
      counts: {},
      largest: undefined,
    };
  const bundle = decoded.success;
  const { source, system } = bundle;
  if (source.systemId !== system.id) problems.push("Source and system ids differ");
  if (bundle.entries.length > compendiumLimits.entries)
    problems.push(
      `${bundle.entries.length} entries; a library holds at most ${compendiumLimits.entries}`,
    );
  const types = new Map(system.entryTypes.map((type) => [type.id, type]));
  const ids = new Set<string>();
  const counts: Record<string, number> = {};
  let largest: BundleReport["largest"];
  for (const entry of bundle.entries) {
    const where = `${entry.id}`;
    const parts = parseEntryId(entry.id);
    if (!parts || parts.source !== source.id || parts.typeId !== entry.typeId)
      problems.push(`${where}: id must be ${source.id}/${entry.typeId}/<slug>`);
    if (ids.has(entry.id)) problems.push(`${where}: duplicate id`);
    ids.add(entry.id);
    const type = types.get(entry.typeId);
    if (!type) {
      problems.push(`${where}: unknown type ${entry.typeId}`);
      continue;
    }
    counts[type.id] = (counts[type.id] ?? 0) + 1;
    const { id: _id, ...input } = entry;
    const error = entryError(input, type);
    if (error) problems.push(`${where}: ${error}`);
    const bytes = publishedBytes(entry, source.licence);
    if (bytes > compendiumLimits.entryBytes)
      problems.push(
        `${where}: ${bytes} bytes published; the limit is ${compendiumLimits.entryBytes}`,
      );
    if (!largest || bytes > largest.bytes) largest = { id: entry.id, bytes };
  }
  for (const entry of bundle.entries) {
    const type = types.get(entry.typeId);
    const strings = [
      entry.name,
      entry.body,
      ...Object.values(entry.fields).flatMap((value) => texts(value)),
    ];
    for (const text of strings) {
      for (const [pattern, label] of LEFTOVERS)
        if (pattern.test(text)) {
          problems.push(`${entry.id}: ${label} left in "${text.slice(0, 80)}"`);
          break;
        }
      for (const part of splitEntryLinks(text))
        if (part.kind === "ref" && !ids.has(part.id))
          problems.push(`${entry.id}: link to missing ${part.id}`);
    }
    for (const field of type?.fields ?? []) {
      if (field.kind !== "reference") continue;
      const value = entry.fields[field.key];
      const targets = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
      for (const target of targets) {
        if (typeof target !== "string") continue;
        const targetType = parseEntryId(target)?.typeId;
        if (!ids.has(target))
          problems.push(`${entry.id}: ${field.key} refers to missing ${target}`);
        else if (targetType && !field.ref?.typeIds.includes(targetType))
          problems.push(`${entry.id}: ${field.key} refers to a ${targetType}`);
      }
    }
  }
  return { problems, counts, largest };
};
