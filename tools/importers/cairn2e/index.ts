import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, posix } from "node:path";
import { compendiumLimits } from "../../../src/domain/compendium";
import { parseNotation } from "../../../src/domain/dice-notation";
import { formatRefLink, formatRollLink } from "../../../src/domain/entry-links";
import { SLUG_MAX, slugify } from "../../../src/domain/entry-id";
import type { BundleEntry, SourceBundle } from "../../../src/domain/source-bundle";
import { firstPartySystem } from "../../../src/domain/systems";
import { upstream } from "../sources";
import { anchor, normalizeTables, pageFrom, plain, rollText, sections, tables } from "./markdown";
import type { MarkdownTable, Page } from "./markdown";

type Draft = {
  entry: BundleEntry;
  identity: string;
  path: string;
  anchor: string;
  priority: number;
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 10);
const idFor = (type: string, identity: string) => {
  const suffix = `-${digest(identity)}`;
  const slug = slugify(identity);
  return `cairn2e/${type}/${identity.length > SLUG_MAX ? slug.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "") + suffix : slug}`;
};
const range = (cell: string) => {
  const match = plain(cell).match(/^(\d+)(?:[-–](\d+))?$/);
  return match ? { min: Number(match[1]), max: Number(match[2] ?? match[1]) } : undefined;
};
const cleanHeading = (name: string) =>
  plain(name)
    .replace(/\s*Roll 1d6:\s*$/i, "")
    .trim();

function readPages(dir: string): Page[] {
  const root = existsSync(join(dir, "second-edition")) ? join(dir, "second-edition") : dir;
  return ["backgrounds", "players-guide", "wardens-guide"].flatMap((folder) => {
    const path = join(root, folder);
    if (!existsSync(path)) return [];
    return readdirSync(path)
      .filter((file) => file.endsWith(".md"))
      .sort()
      .map((file) =>
        pageFrom(`${folder}/${file.replace(/\.md$/, "")}`, readFileSync(join(path, file), "utf8")),
      );
  });
}

/** Read only the licensed second-edition text; dir may be the repository or second-edition. */
export function importCairn2eFrom(dir: string, revision: string): SourceBundle {
  const contract = firstPartySystem("cairn2e")!;
  const drafts: Draft[] = [];
  const diceUsed = new Set<string>();
  const multipleGroups: string[] = [];
  const uncategorized: string[] = [];
  const add = (
    page: Page,
    typeId: string,
    name: string,
    identity: string,
    body: string,
    fields: BundleEntry["fields"] = {},
    sectionAnchor = "",
    priority = 0,
  ) => {
    const entry: BundleEntry = {
      id: idFor(typeId, identity),
      typeId,
      name,
      body: normalizeTables(body.trim()),
      fields,
      tags: [],
      visibility: "public",
    };
    drafts.push({ entry, identity, path: page.path, anchor: sectionAnchor, priority });
    return entry;
  };

  const addTable = (page: Page, table: MarkdownTable, group: string, background = false) => {
    if (!table.rows.length || !range(table.rows[0][0])) return undefined;
    if (plain(table.headers[0]) && !/^\d*d\d+$/.test(plain(table.headers[0]))) return undefined;
    // The example forest says d20 but only supplies results 1–6; keep it as rule text.
    if (page.path === "wardens-guide/forest-seeds" && table.heading === "Encounters")
      return undefined;
    const horizontal =
      table.rows[0].every((cell) => range(cell)) && table.rows[1]?.every((cell) => !range(cell));
    if (horizontal)
      table = {
        ...table,
        rows: table.rows[0].map((cell, index) => [cell, table.rows[1][index]]),
        headers: ["", ""],
      };
    const writtenDice =
      plain(table.headers[0]).match(/\b\d*d\d+\b/)?.[0] ??
      table.heading.match(/\b\d*d\d+\b/)?.[0] ??
      plain(table.context).match(/roll\s+(\d*d\d+)/i)?.[1];
    const dice = writtenDice
      ? writtenDice.startsWith("d")
        ? `1${writtenDice}`
        : writtenDice
      : `1d${Math.max(...table.rows.flatMap((row) => row.map((cell) => range(cell)?.max ?? 0)))}`;
    diceUsed.add(dice);
    const title = cleanHeading(table.heading || page.title);
    const indexColumns = table.rows[0].flatMap((cell, index) => (range(cell) ? [index] : []));
    // Packed pairs (1–50 and 51–100) form one oracle; other columns roll independently.
    const packed = indexColumns.length > 1 && indexColumns.every((index) => index % 2 === 0);
    const independent =
      /each column|separate(?:ly)?|independent/i.test(table.context) ||
      table.heading === "Forest Names" ||
      table.heading === "Seasonal Weather";
    const textColumns =
      background || packed || !independent
        ? [-1]
        : table.headers.slice(1).map((_, index) => index + 1);
    const entries = textColumns.map((column) => {
      const label = plain(table.headers[column] ?? "");
      const name = column > 0 && textColumns.length > 1 ? `${title}: ${label}` : title;
      const rows = table.rows
        .flatMap((row) => {
          if (packed)
            return indexColumns.map((index) => ({ ...range(row[index])!, text: row[index + 1] }));
          const interval = range(row[0]);
          return interval
            ? [
                {
                  ...interval,
                  text: column === -1 ? row.slice(1).filter(Boolean).join(" — ") : row[column],
                },
              ]
            : [];
        })
        .sort((a, b) => a.min - b.min);
      const anonymous = table.heading === page.title;
      const repeatedLabel =
        column > 0 && table.headers.filter((header) => plain(header) === label).length > 1;
      const distinguishingText =
        column > 0 ? table.rows[0][column] : table.rows[0].slice(1).join("-");
      const base = `${page.path.split("/").at(-1)}-${name}`;
      // Anonymous tables and duplicate column labels have no distinct heading upstream.
      const tableKey = `${table.anchor}#${column > 0 ? label : table.headers.map(plain).join("#")}#${anonymous || repeatedLabel ? distinguishingText : ""}`;
      const identity = `${base}-${digest(tableKey)}`;
      const entry = add(
        page,
        "table",
        name,
        identity,
        `Roll ${formatRollLink(dice, dice)}.\n\n${table.markdown}`,
        { group, table: rows },
        table.anchor,
        3,
      );

      return entry;
    });
    return entries;
  };

  for (const page of readPages(dir)) {
    const parts = sections(page.body);
    // Sections imported as a monster or relic aren't repeated as rules.
    const typed = new Set<(typeof parts)[number]>();
    if (page.path.startsWith("backgrounds/")) {
      for (const table of tables(page.body).filter((table) => /Roll 1d6/i.test(table.heading)))
        addTable(page, table, page.title, true);
      const names = parts.find((part) => part.name === "Names")?.body ?? "";
      const gear = parts.find((part) => part.name === "Starting Gear")?.body ?? "";
      const body = parts
        .filter((part) => part.name !== "Names" && part.name !== "Starting Gear")
        .map((part) =>
          part.anchor
            ? `## ${part.name}\n\n${part.body.replace(/(^\|[^\n]*\n\|\s*-{3,}[^\n]*\n(?:\|[^\n]*\n?)+)/gm, "")}`
            : part.body,
        )
        .filter((part) => part.trim() && !/^## [^\n]+\n\n$/.test(part))
        .join("\n\n");
      add(
        page,
        "background",
        page.title,
        page.path.split("/").at(-1)!,
        body,
        { names, gear },
        "",
        5,
      );
    } else {
      if (page.path === "wardens-guide/bestiary") {
        const groups = new Map<string, string>();
        for (const row of tables(page.body)[0]?.rows ?? []) {
          for (const monster of row[2].split(",").map((name) => name.trim())) {
            const previous = groups.get(monster);
            if (previous) multipleGroups.push(`${monster}: ${previous} before ${row[1]}`);
            else groups.set(monster, row[1]);
          }
        }
        for (const section of parts.filter(
          (part) => part.name !== "Monster Categories" && part.anchor,
        )) {
          typed.add(section);
          const [stats, ...notes] = section.body.split("\n");
          const fields: { -readonly [K in keyof BundleEntry["fields"]]: BundleEntry["fields"][K] } =
            { armor: 0, attacks: [] };
          for (const stat of stats.matchAll(/(\d+) (HP|Armor|STR|DEX|WIL)/g))
            fields[stat[2].toLowerCase()] = Number(stat[1]);
          if (groups.has(section.name)) fields.group = groups.get(section.name)!;
          else uncategorized.push(section.name);
          fields.attacks = [...stats.matchAll(/([^,]+?)\s*\(([^)]+)\)/g)].map((attack) => {
            const [dice, ...details] = attack[2].split(",");
            const notation = dice.trim().replace(/\+/g, " | ");
            return {
              name: plain(attack[1].replace(/^\s*or\s+/, "")),
              ...(parseNotation(notation).ok ? { roll: notation } : {}),
              ...(details.length ? { text: details.join(",").trim() } : {}),
            };
          });
          const traits = stats.match(/\),\s*(_[^_]+_)\s*$/)?.[1];
          add(
            page,
            "monster",
            section.name,
            section.name,
            [...notes, ...(traits ? [`\n${traits}`] : [])].join("\n"),
            fields,
            section.anchor,
            5,
          );
        }
      }
      if (page.path === "wardens-guide/spellbooks") {
        for (const row of tables(page.body)[0]?.rows ?? []) {
          add(
            page,
            "spellbook",
            plain(row[1]),
            plain(row[1]),
            row[2],
            {},
            anchor(plain(row[1])),
            5,
          );
        }
      }
      if (page.path === "wardens-guide/reliquary") {
        for (const section of parts.filter((part) => part.anchor)) {
          typed.add(section);
          const heading = section.name.split(/,|\s+\(/)[0];
          const name = plain(heading);
          const charges = section.name.match(/\b\d+ (?:charges?|uses?)\b/)?.[0];
          // The heading's tail ("(d8), 2 charges", "_petty_") opens the text; the name is the title.
          const tail = section.name.slice(heading.length).replace(/^[\s,]+/, "");
          add(
            page,
            "relic",
            name,
            name,
            tail ? `${tail}\n\n${section.body}` : section.body,
            charges ? { charges } : {},
            section.anchor,
            5,
          );
        }
      }
      if (page.path === "players-guide/marketplace") {
        for (const table of tables(page.body)) {
          for (const row of table.rows) {
            const text = row[0];
            const name = plain(text)
              .replace(/\s*\([^)]*\)/g, "")
              .trim();
            const properties = ["bulky", "petty", "blast"].filter((tag) =>
              new RegExp(`\\b${tag}\\b`, "i").test(plain(text)),
            );
            const uses = text.match(/\b\d+ uses?\b/)?.[0];
            if (uses) properties.push("uses");
            const damage = text.match(/\b\d*d\d+\b/)?.[0];
            const armor = text.match(/(\d+) Armor/)?.[1];
            add(
              page,
              "item",
              name,
              `${table.heading}-${name}`,
              text,
              {
                category: table.heading,
                cost: `${row[1]} gp`,
                slots: properties.includes("bulky") ? 2 : 1,
                properties,
                ...(uses ? { uses } : {}),
                ...(damage ? { damage } : {}),
                ...(armor ? { armor: Number(armor) } : {}),
              },
              anchor(name),
              5,
            );
          }
        }
      }
      // All guide tables remain useful as text too, including non-random reference tables.
      if (page.path !== "players-guide/marketplace" && page.path !== "wardens-guide/spellbooks") {
        for (const table of tables(page.body)) addTable(page, table, page.title);
      }
      for (const section of parts.filter((part) => !typed.has(part))) {
        add(
          page,
          "rule",
          section.name === "Introduction" ? `${page.title}: Introduction` : plain(section.name),
          `${page.path.replace(/\//g, "-")}-${section.name}${parts.filter((part) => part.name === section.name).length > 1 ? `-${section.body.match(/^#{3,6} (.+)$/m)?.[1] ?? digest(section.body.split("\n")[0])}` : ""}`,
          section.body,
          { chapter: page.title },
          section.anchor,
          1,
        );
      }
    }
  }

  const collisions = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const group = collisions.get(draft.entry.id) ?? [];
    group.push(draft);
    collisions.set(draft.entry.id, group);
  }
  for (const group of collisions.values()) {
    if (group.length < 2) continue;
    for (const draft of group) {
      const suffix = digest(draft.identity);
      draft.entry = {
        ...draft.entry,
        id: `${draft.entry.id.slice(0, draft.entry.id.lastIndexOf("/") + 1)}${slugify(
          draft.identity.split("#")[0],
        )
          .slice(0, SLUG_MAX - 11)
          .replace(/-+$/, "")}-${suffix}`,
      };
    }
  }

  const links = new Map<string, { id: string; priority: number }>();
  for (const draft of [...drafts].sort((a, b) => a.entry.id.localeCompare(b.entry.id))) {
    for (const key of [`${draft.path}#${draft.anchor}`, `${draft.path}#${slugify(draft.anchor)}`]) {
      if ((links.get(key)?.priority ?? -1) < draft.priority)
        links.set(key, { id: draft.entry.id, priority: draft.priority });
    }
  }
  for (const draft of drafts.filter((draft) => draft.entry.typeId === "rule")) {
    if (!links.has(`${draft.path}#`))
      links.set(`${draft.path}#`, { id: draft.entry.id, priority: 0 });
    for (const heading of draft.entry.body.matchAll(/^#{3,6} (.+)$/gm)) {
      const key = `${draft.path}#${anchor(heading[1])}`;
      if (!links.has(key)) links.set(key, { id: draft.entry.id, priority: 1 });
    }
  }
  const spells = new Map(
    drafts
      .filter((draft) => draft.entry.typeId === "spellbook")
      .map((draft) => [draft.entry.name, draft.entry.id]),
  );
  const convert = (text: string, pagePath: string) =>
    rollText(
      text
        .replace(/_([^_\n]+)_/g, (match, label: string) => {
          const names = label.split(/,\s*/);
          return names.every((name) => spells.has(name))
            ? names.map((name) => formatRefLink(spells.get(name)!, name)).join(", ")
            : match;
        })
        .replace(/\[([^\]\n]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
          const url = href.split(/\s+"/)[0];
          if (/^https?:\/\//.test(url) && !url.startsWith("https://cairnrpg.com/second-edition/"))
            return `[${label}](${url})`;
          const local = url.replace(/^https:\/\/cairnrpg.com/, "");
          const [path, hash = ""] = local.split("#");
          const resolvedPath = path
            ? path.startsWith("/second-edition/")
              ? path.slice(16)
              : posix.normalize(posix.join(posix.dirname(pagePath), path))
            : pagePath;
          const key = `${resolvedPath.replace(/\/$/, "").replace(/\.md$/, "")}#${hash}`;
          const target = links.get(key);
          return target ? formatRefLink(target.id, plain(label)) : label;
        }),
    );
  for (const draft of drafts) {
    draft.entry = { ...draft.entry, body: convert(draft.entry.body, draft.path) };
    draft.entry = {
      ...draft.entry,
      fields: Object.fromEntries(
        Object.entries(draft.entry.fields).map(([key, value]) => [
          key,
          typeof value === "string"
            ? convert(value, draft.path)
            : Array.isArray(value)
              ? value.map((row) =>
                  typeof row === "object" && row !== null
                    ? Object.fromEntries(
                        Object.entries(row).map(([column, cell]) => [
                          column,
                          typeof cell === "string" && column === "text"
                            ? convert(cell, draft.path)
                            : cell,
                        ]),
                      )
                    : row,
                )
              : value,
        ]),
      ),
    };
  }
  // Resolve background references after deterministic collision disambiguation.
  for (const draft of drafts.filter((draft) => draft.entry.typeId === "background")) {
    draft.entry = {
      ...draft.entry,
      fields: {
        ...draft.entry.fields,
        tables: drafts
          .filter((table) => table.path === draft.path && table.entry.typeId === "table")
          .map((table) => table.entry.id),
      },
    };
  }

  const entries = drafts.flatMap(({ entry }) => splitEntry(entry));
  return {
    format: "ttrpg-source-bundle",
    formatVersion: 1,
    system: contract.system,
    source: contract.source,
    provenance: {
      upstream: "https://github.com/yochaigal/cairn",
      revision,
      importer: "tools/importers/cairn2e",
      notes: `Based on Cairn Second Edition by Yochai Gal; CC BY-SA 4.0 text only. Includes backgrounds, bestiary, spellbooks, relics, priced marketplace rows, guide sections and numeric roll tables. Excludes art, image paths, front matter, downloads, tools and first-edition content. Independent table columns are separate oracles; packed columns are merged. Dice in tables: ${[...diceUsed].sort().join(", ")}. The shared oracle field is fixed to 1d6; other tables retain their actual die in the body and all original ranges pending a contract change. Multiple monster groups (first retained): ${multipleGroups.join("; ") || "none"}. Uncategorized stat blocks (group omitted): ${uncategorized.join(", ") || "none"}. Multi-attack dice use independent | groups. Growth and Warden's Bonds and Omens have prose, not roll tables; Player's Bonds and Omens are included. The example forest Encounters table says d20 but has only six results; it remains rule text and is excluded from oracles. Non-random reference tables (including Scars, keyed by HP lost) stay as rule text. Unresolved internal links retain their label as text.`,
    },
    entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function splitEntry(entry: BundleEntry): BundleEntry[] {
  // Leave room for part links and the publication envelope, including UTF-8 text.
  const budget = Math.min(compendiumLimits.body - 1200, compendiumLimits.entryBytes - 6000);
  if (Buffer.byteLength(entry.body) <= budget) return [entry];
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of entry.body.split("\n\n")) {
    if (Buffer.byteLength(`${current}\n\n${paragraph}`) <= budget)
      current += `${current ? "\n\n" : ""}${paragraph}`;
    else {
      if (current) chunks.push(current);
      current = paragraph;
      // A single long table/prose block splits on lines or sentence boundaries.
      if (Buffer.byteLength(current) > budget) {
        current = "";
        const tableHeader = /^\|[^\n]*\n\| ---[^\n]*\n/.exec(paragraph)?.[0] ?? "";
        const fragments = tableHeader
          ? paragraph.slice(tableHeader.length).split(/(?<=\n)/)
          : paragraph.split(/(?<=\n|\. )/);
        current = tableHeader;
        for (const fragment of fragments) {
          if (Buffer.byteLength(current + fragment) > budget && current) {
            chunks.push(current.trim());
            current = tableHeader;
          }
          current += fragment;
        }
      }
    }
  }
  if (current) chunks.push(current.trim());
  const ids = chunks.map((_, index) =>
    index === 0
      ? entry.id
      : `${entry.id.slice(0, entry.id.lastIndexOf("/") + 1)}${entry.id
          .split("/")
          .at(-1)!
          .slice(0, SLUG_MAX - 20)
          .replace(/-+$/, "")}-${digest(entry.id)}-part-${index + 1}`,
  );
  const links = ids.map((id, index) => `[[ref:${id}|Part ${index + 1}]]`).join(" · ");
  return chunks.map((body, index) => ({
    ...entry,
    id: ids[index],
    name: `${entry.name} (${index + 1}/${chunks.length})`,
    body: `${body}\n\n${links}`,
  }));
}

export async function importCairn2e(): Promise<SourceBundle> {
  const source = upstream("cairn");
  return importCairn2eFrom(source.dir, source.revision());
}
