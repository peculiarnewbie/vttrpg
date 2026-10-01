import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { compendiumLimits } from "../../../src/domain/compendium";
import { parseNotation } from "../../../src/domain/dice-notation";
import { SLUG_MAX, slugify } from "../../../src/domain/entry-id";
import type { BundleEntry, SourceBundle } from "../../../src/domain/source-bundle";
import { firstPartySystem } from "../../../src/domain/systems";
import { upstream } from "../sources";
import {
  Datasworn,
  type Asset,
  type Collection,
  type Move,
  type Oracle,
  type Truth,
} from "./source";

const definition = firstPartySystem("starforged")!;
const UPSTREAM_URL = "https://github.com/rsek/datasworn";
const hash = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 12);
const suffixedSlug = (slug: string, suffix: string) =>
  `${slug.slice(0, SLUG_MAX - suffix.length - 1).replace(/-+$/, "")}-${suffix}`;
// The identity suffix keeps existing ids stable if a later revision adds a slug collision.
const stableSlug = (id: string) => suffixedSlug(slugify(id), hash(id));

type Sourced = { readonly _source?: { readonly license: string } };
type Named = Sourced & { readonly _id: string; readonly name: string };
type Candidate<T extends Named> = {
  readonly item: T;
  readonly path: readonly Collection<T>[];
  readonly license: string;
};
type Text = (text: string | undefined) => string;

const rollDescription = (move: Move): string => {
  if (move.roll_type === "no_roll") return "No roll";
  if (move.roll_type === "progress_roll") return "Progress roll";
  if (move.roll_type === "special_track") {
    const tracks = (move.trigger.conditions ?? []).flatMap((condition) =>
      (condition.roll_options ?? []).map((option) => option.using.replace(/_/g, " ")),
    );
    return `Progress roll (${tracks.join(", ")}${tracks.length > 1 ? "; one roll per track" : ""})`;
  }
  const conditions = move.trigger.conditions ?? [];
  const alternatives = conditions.map((condition) => {
    const values = (condition.roll_options ?? []).map((option) => {
      switch (option.using) {
        case "stat":
          return `+${option.stat}`;
        case "condition_meter":
          return `+${option.condition_meter}`;
        case "asset_control":
          return `+${option.control}`;
        case "custom":
          return `+${option.value} (${option.label})`;
        case "progress_track":
          return "progress";
        case "bonds_legacy":
        case "quests_legacy":
        case "discoveries_legacy":
          return option.using.replace(/_/g, " ");
      }
    });
    return `${joinChoices(values)}${condition.method === "highest" ? " (whichever is higher)" : condition.method === "lowest" ? " (whichever is lower)" : ""}`;
  });
  const choices = [...new Set(alternatives)];
  const choose =
    choices.length > 1 ||
    conditions.some(
      (condition) =>
        condition.method === "player_choice" && (condition.roll_options?.length ?? 0) > 1,
    );
  return `Action roll ${joinChoices(choices)}${choose ? " (choose)" : ""}`.trim();
};
const joinChoices = (choices: readonly string[]): string =>
  choices.length < 2 ? choices.join("") : `${choices.slice(0, -1).join(", ")} or ${choices.at(-1)}`;
const heading = (title: string, text: string) => (text ? `## ${title}\n\n${text}` : "");
const paragraphs = (...text: string[]) => text.filter(Boolean).join("\n\n");
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const splitEntry = (entry: BundleEntry): BundleEntry[] => {
  // Reserve space for publishing metadata and links between parts.
  const fieldsBytes = Buffer.byteLength(JSON.stringify({ ...entry, body: "" }), "utf8");
  const budget = Math.min(
    compendiumLimits.body - 2048,
    compendiumLimits.entryBytes - fieldsBytes - 2048,
  );
  if (Buffer.byteLength(entry.body, "utf8") <= budget) return [entry];
  const chunks: string[] = [];
  let chunk = "";
  // Entry links remain atomic when a long paragraph needs splitting.
  for (const token of entry.body.match(/\[\[(?:ref|r):[^\]]*\]\]|\s+|[^\s]+/g) ?? []) {
    if (chunk && Buffer.byteLength(chunk + token, "utf8") > budget) {
      chunks.push(chunk.trim());
      chunk = "";
    }
    chunk += token;
  }
  if (chunk.trim()) chunks.push(chunk.trim());
  const parts = chunks.map((body, index) => ({
    ...entry,
    id:
      index === 0
        ? entry.id
        : `${entry.id.slice(0, entry.id.lastIndexOf("/") + 1)}${suffixedSlug(entry.id.slice(entry.id.lastIndexOf("/") + 1), `part-${index + 1}`)}`,
    name: `${entry.name} (${index + 1}/${chunks.length})`,
    body,
  }));
  const links = parts.map((part) => `[[ref:${part.id}|${part.name}]]`).join(" · ");
  return parts.map((part) => ({ ...part, body: `${part.body}\n\n${links}` }));
};

export const importStarforgedFrom = (dir: string, revision: string): SourceBundle => {
  // Cached upstream bytes are the trust boundary; art and automation keys are not decoded.
  const data = Schema.decodeUnknownSync(Datasworn)(
    JSON.parse(readFileSync(join(dir, "datasworn/starforged/starforged.json"), "utf8")),
  );
  const excluded = new Set<string>();
  const accepted = (item: Sourced, inherited: string, identity: string): boolean => {
    const license = item._source?.license ?? inherited;
    const ok = license.replace(/\/$/, "") === definition.source.licence.url!.replace(/\/$/, "");
    if (!ok) excluded.add(`${identity} (${license})`);
    return ok;
  };
  const names = new Map<string, string>();
  const collect = <T extends Named>(
    collections: Readonly<Record<string, Collection<T>>>,
  ): Candidate<T>[] => {
    const result: Candidate<T>[] = [];
    const visit = (
      collection: Collection<T>,
      path: readonly Collection<T>[],
      inherited: string,
    ) => {
      if (!accepted(collection, inherited, collection._id)) return;
      names.set(collection._id, collection.name);
      const license = collection._source?.license ?? inherited;
      const nextPath = [...path, collection];
      for (const item of Object.values(collection.contents ?? {})) {
        if (!accepted(item, license, item._id)) continue;
        names.set(item._id, item.name);
        result.push({ item, path: nextPath, license: item._source?.license ?? license });
      }
      for (const child of Object.values(collection.collections ?? {}))
        visit(child, nextPath, license);
    };
    for (const collection of Object.values(collections)) visit(collection, [], data.license);
    return result;
  };
  const moves = collect(data.moves);
  const assets = collect(data.assets);
  const oracles = collect(data.oracles);
  const npcs = collect(data.npcs);
  const truths: Candidate<Truth>[] = Object.values(data.truths)
    .filter((truth) => accepted(truth, data.license, truth._id))
    .map((item) => ({ item, path: [], license: item._source?.license ?? data.license }));
  const candidates = [
    ...moves.map(({ item }) => ({ item, typeId: "move" })),
    ...assets.map(({ item }) => ({ item, typeId: "asset" })),
    ...oracles.map(({ item }) => ({ item, typeId: "oracle" })),
    ...npcs.map(({ item }) => ({ item, typeId: "npc" })),
    ...truths.map(({ item }) => ({ item, typeId: "truth" })),
  ];
  const ids = new Map<string, string>();
  for (const { item, typeId } of candidates) {
    ids.set(item._id, `${definition.source.id}/${typeId}/${stableSlug(item._id)}`);
    names.set(item._id, item.name);
  }
  // Asset-specific move descriptors repeat ability text and have no move-category option.
  for (const { item, license } of assets) {
    for (const [index, ability] of item.abilities.entries()) {
      if (!accepted(ability, license, `${item._id}/abilities/${index}`)) continue;
      for (const move of Object.values(ability.moves ?? {})) {
        if (!accepted(move, ability._source?.license ?? license, move._id)) continue;
        ids.set(move._id, ids.get(item._id)!);
        names.set(move._id, move.name);
      }
    }
  }
  for (const { item, license } of npcs) {
    for (const variant of Object.values(item.variants ?? {})) {
      if (!accepted(variant, license, variant._id)) continue;
      ids.set(variant._id, ids.get(item._id)!);
      names.set(variant._id, variant.name);
    }
  }
  const unresolved = new Set<string>();
  const reference = (id: string, label?: string): string => {
    const name = label ?? names.get(id) ?? capitalize(id.split("/").at(-1)!.replace(/_/g, " "));
    const target = ids.get(id);
    if (target) return `[[ref:${target}|${name}]]`;
    unresolved.add(id);
    return name;
  };
  const text: Text = (input) =>
    (input ?? "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\(([^)]*\.(?:webp|png|jpe?g|svg)(?:[?#][^)]*)?)\)/gi, "")
      .replace(/\[([^\]]+)\]\(id:([^)]*)\)/g, (_all, label: string, id: string) =>
        reference(id, label),
      )
      .replace(/\{\{(?:table|text)(?::|>)([^}]+)\}\}/g, (_all, id: string) => reference(id))
      .replace(/__(.*?)__/g, "**$1**")
      .replace(/^ *[-*] /gm, "- ")
      .replace(
        /\b(roll(?:ing)?\s+)(\d+d\d+(?:[+-]\d+)?)/gi,
        (_all, prefix: string, dice: string) =>
          parseNotation(dice).ok ? `${prefix}[[r:${dice}|${dice}]]` : `${prefix}${dice}`,
      )
      .trim();
  const rowText = (row: Oracle["rows"][number]) =>
    [row.text, row.text2, row.text3]
      .filter((cell): cell is string => typeof cell === "string")
      .map(text)
      .join(" — ");
  const rows = (table: Pick<Oracle, "rows">, license: string, id: string) =>
    table.rows
      .filter((row, index) => accepted(row, license, `${id}/row-${index}`))
      .flatMap((row) =>
        row.min === null || row.max === null
          ? []
          : [{ min: row.min, max: row.max, text: rowText(row) }],
      );
  const markdownTable = (table: Pick<Oracle, "rows" | "dice">, license: string, id: string) =>
    `Roll [[r:${table.dice}|${table.dice}]].\n\n| Roll | Result |\n|---|---|\n${rows(
      table,
      license,
      id,
    )
      .map(
        (row) =>
          `| ${row.min === row.max ? row.min : `${row.min}–${row.max}`} | ${row.text.replace(/\|/g, "\\|").replace(/\n/g, " / ")} |`,
      )
      .join("\n")}`;
  const entry = (
    item: Named,
    typeId: string,
    body: string,
    fields: BundleEntry["fields"],
  ): BundleEntry => ({
    id: ids.get(item._id)!,
    typeId,
    name: item.name,
    tags: [],
    body,
    fields,
    visibility: "public",
  });
  const oracleById = new Map(oracles.map((candidate) => [candidate.item._id, candidate]));
  const entries: BundleEntry[] = [];
  for (const { item, path } of moves) {
    const fields: BundleEntry["fields"] = {
      category: path.at(-1)!.name.replace(/ Moves$/, ""),
      trigger: text(item.trigger.text),
      roll: rollDescription(item),
    };
    const embedded = (item.oracles ?? []).flatMap((id) => {
      const oracle = oracleById.get(id);
      return oracle ? [oracle] : [];
    });
    // A move with several tables keeps individual links instead of merging their ranges.
    const body =
      embedded.length > 1
        ? paragraphs(
            text(item.text),
            heading(
              "Tables",
              embedded.map(({ item: oracle }) => reference(oracle._id)).join("\n\n"),
            ),
          )
        : text(item.text);
    entries.push(
      entry(item, "move", body, {
        ...fields,
        ...(embedded.length === 1
          ? { table: rows(embedded[0].item, embedded[0].license, embedded[0].item._id) }
          : {}),
      }),
    );
  }
  for (const { item, path, license } of assets) {
    const controlLines = (controls: Asset["controls"], inherited: string): string[] =>
      Object.entries(controls ?? {}).flatMap(([key, control]) => {
        if (!accepted(control, inherited, `${item._id}/controls/${key}`)) return [];
        const value = typeof control.value === "number" ? ` (starts at ${control.value})` : "";
        const range =
          control.max == null
            ? ""
            : ` ${control.max}${control.min === undefined ? "" : ` (${control.min}–${control.max})`}${value}`;
        const choices = control.choices
          ? `: ${Object.values(control.choices)
              .map(
                (choice) =>
                  `${choice.label}${choice.value === undefined ? "" : ` ${choice.value}`}`,
              )
              .join(", ")}`
          : "";
        return [
          `${capitalize(control.label)}${range}${choices}`,
          ...controlLines(control.controls, control._source?.license ?? inherited),
        ];
      });
    const track = [text(item.requirement), ...controlLines(item.controls, license).map(text)]
      .filter(Boolean)
      .join("; ");
    const options = Object.entries(item.options ?? {})
      .filter(([key, option]) => accepted(option, license, `${item._id}/options/${key}`))
      .map(
        ([, option]) =>
          `- ${text(capitalize(option.label))}${
            option.choices
              ? `: ${Object.values(option.choices)
                  .map((choice) => text(choice.label))
                  .join(", ")}`
              : ""
          }`,
      );
    entries.push(
      entry(
        item,
        "asset",
        paragraphs(
          ...path.map((collection) => text(collection.description ?? collection.summary)),
          heading("Options", options.join("\n")),
        ),
        {
          category: item.category,
          track,
          abilities: item.abilities
            .filter((ability, index) =>
              accepted(ability, license, `${item._id}/abilities/${index}`),
            )
            .map((ability) => ({ enabled: ability.enabled, text: text(ability.text) })),
        },
      ),
    );
  }
  const otherDice: string[] = [];
  const unrollable: string[] = [];
  for (const { item, path, license } of oracles) {
    if (item.dice !== "1d100") otherDice.push(`${item._id}: ${item.dice}`);
    const notes = item.rows
      .filter(
        (row, index) =>
          accepted(row, license, `${item._id}/row-${index}`) &&
          (row.min === null || row.max === null),
      )
      .map(rowText);
    if (notes.length) unrollable.push(item._id);
    entries.push(
      entry(
        item,
        "oracle",
        paragraphs(
          ...path.map((collection) => text(collection.description ?? collection.summary)),
          text(item.summary),
          text(item.description),
          item.dice === "1d100" ? "" : `Roll [[r:${item.dice}|${item.dice}]] on this table.`,
          item.recommended_rolls
            ? `Suggested rolls: ${item.recommended_rolls.min}–${item.recommended_rolls.max}.`
            : "",
          heading("On a match", text(item.match?.text)),
          heading("Unrollable results", notes.map((note) => `- ${note}`).join("\n")),
        ),
        {
          group: [...path.map((collection) => collection.name), item.name].join(" › "),
          table: rows(item, license, item._id),
        },
      ),
    );
  }
  for (const { item, license } of npcs) {
    entries.push(
      entry(
        item,
        "npc",
        paragraphs(
          text(item.summary),
          text(item.description),
          heading("Quest starter", text(item.quest_starter)),
          ...Object.values(item.variants ?? {})
            .filter((variant) => accepted(variant, license, variant._id))
            .map((variant) =>
              heading(
                variant.name,
                paragraphs(
                  `Rank ${variant.rank} · ${text(variant.nature)}`,
                  text(variant.description),
                ),
              ),
            ),
        ),
        {
          rank: item.rank,
          nature: text(item.nature),
          features: item.features.map(text).join("\n"),
          drives: item.drives.map(text).join("\n"),
          tactics: item.tactics.map(text).join("\n"),
        },
      ),
    );
  }
  for (const { item, license } of truths) {
    const options = item.options.filter((option, index) =>
      accepted(option, license, `${item._id}/option-${index}`),
    );
    entries.push(
      entry(
        item,
        "truth",
        paragraphs(
          ...options.map((option) => {
            const detail = option.description.replace(/\{\{table(?::|>)[^}]+\}\}/g, "");
            return heading(
              `${option.min}–${option.max}: ${text(option.summary)}`,
              paragraphs(
                text(detail),
                option.table &&
                  accepted(
                    option.table,
                    option._source?.license ?? license,
                    `${item._id}/table-${option.min}`,
                  )
                  ? markdownTable(
                      option.table,
                      option.table._source?.license ?? option._source?.license ?? license,
                      item._id,
                    )
                  : "",
                heading("Quest starter", text(option.quest_starter)),
              ),
            );
          }),
          heading("Your character", text(item.your_character)),
        ),
        {
          options: options.map((option) => ({
            min: option.min,
            max: option.max,
            text: text(option.summary),
          })),
        },
      ),
    );
  }
  return {
    format: "ttrpg-source-bundle",
    formatVersion: 1,
    ...definition,
    provenance: {
      upstream: UPSTREAM_URL,
      revision,
      importer: "tools/importers/starforged",
      notes: paragraphs(
        "Text from Ironsworn: Starforged by Shawn Tomkin, converted from Datasworn under CC BY 4.0. Based on Starforged; no official endorsement is implied. Moves, assets, rollable oracles, sample NPCs (including variant text), and truths are included. Art, icons, image paths, machine-readable automation, rules configuration, and other entry families are excluded. Asset-specific move descriptors remain in their ability text (the move type has no asset category); links to those descriptors resolve to the asset. NPC variant links resolve to the parent NPC. Roll-twice instructions remain text; no outcomes or side effects are automated.",
        excluded.size
          ? `Excluded incompatible or missing licence markers: ${[...excluded].sort().join("; ")}.`
          : "All imported content has CC BY 4.0 source markers, inherited where upstream omits a child marker; no incompatible licences found.",
        otherDice.length
          ? `Non-percentile tables (${otherDice.length}); ranges preserved and dice noted in bodies: ${otherDice.sort().join("; ")}.`
          : "",
        unrollable.length
          ? `Null-range rows preserved as unrollable body notes: ${unrollable.sort().join("; ")}.`
          : "",
        unresolved.size
          ? `Unresolved references rendered as plain text: ${[...unresolved].sort().join("; ")}.`
          : "",
      ),
    },
    entries: entries.flatMap(splitEntry).sort((a, b) => a.id.localeCompare(b.id)),
  };
};

export const importStarforged = async (): Promise<SourceBundle> => {
  const source = upstream("datasworn");
  return importStarforgedFrom(source.dir, source.revision());
};
