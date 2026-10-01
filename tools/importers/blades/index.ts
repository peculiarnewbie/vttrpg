import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compendiumLimits } from "../../../src/domain/compendium";
import { parseNotation } from "../../../src/domain/dice-notation";
import { slugify, SLUG_MAX } from "../../../src/domain/entry-id";
import type { BundleEntry, SourceBundle } from "../../../src/domain/source-bundle";
import { firstPartySystems } from "../../../src/domain/systems";
import { upstream } from "../sources";

const definition = firstPartySystems.find((item) => item.system.id === "blades")!;
const upstreamUrl = "https://github.com/amazingrando/blades-in-the-dark-srd-content";

type Section = { name: string; text: string };
type Chapter = { name: string; intro: string; sections: Section[] };
type Draft = {
  typeId: "rule" | "ability" | "crew-ability" | "upgrade";
  name: string;
  key: string;
  chapter: string;
  body: string;
  cost?: number;
};

const entities: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (original, entity: string) => {
    if (entity.startsWith("#"))
      return String.fromCodePoint(
        entity.toLowerCase().startsWith("#x")
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10),
      );
    return entities[entity] ?? original;
  });

function chapters(text: string): Chapter[] {
  const result: Chapter[] = [];
  let chapter: Chapter | undefined;
  let section: Section | undefined;
  for (const line of decodeEntities(text).replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^(#{1,2}) (.+)$/.exec(line);
    // Upstream accidentally gives this ability a section heading.
    if (heading && !(chapter?.name === "Character playbook" && heading[2] === "Fortitude")) {
      if (heading[1] === "#") {
        chapter = { name: heading[2], intro: "", sections: [] };
        result.push(chapter);
        section = undefined;
      } else if (chapter) {
        section = { name: heading[2], text: "" };
        chapter.sections.push(section);
      }
    } else if (section) {
      section.text += `${heading ? "### Fortitude" : line}\n`;
    } else if (chapter) {
      chapter.intro += `${line}\n`;
    }
  }
  return result;
}

function abilities(section: Section, chapter: string, typeId: "ability" | "crew-ability"): Draft[] {
  return section.text
    .split(/^### /m)
    .slice(1)
    .map((part) => {
      const newline = part.indexOf("\n");
      const name = part.slice(0, newline).trim();
      return { typeId, name, key: name, chapter, body: part.slice(newline + 1).trim() };
    });
}

function upgrades(text: string, chapter: string): Draft[] {
  const costs: Record<string, number> = { two: 2, three: 3, four: 4 };
  return [
    ...text.matchAll(
      /^\* \*\*(.+?)(?:\*\*\*\*:|\*\*:|:\*\*)\s*([\s\S]*?)(?=^\* \*\*|$(?![\s\S]))/gm,
    ),
  ].map((match) => {
    const body = match[2].trim();
    const cost = /This costs (\w+|\d+) (?:upgrade boxes|upgrades) to unlock/i.exec(body);
    return {
      typeId: "upgrade" as const,
      name: match[1].replace(" (specify type)", ""),
      key: match[1],
      chapter,
      body,
      ...(cost ? { cost: costs[cost[1]] ?? Number(cost[1]) } : {}),
    };
  });
}

function draftsFrom(document: string): Draft[] {
  const drafts: Draft[] = [];
  const rule = (chapter: string, name: string, body: string, key = `${chapter}/${name}`) => {
    if (body.trim()) drafts.push({ typeId: "rule", chapter, name, key, body: body.trim() });
  };
  for (const chapter of chapters(document)) {
    if (chapter.name === "Character playbook") {
      const pool = chapter.sections.find((section) => section.name === "Special abilities");
      if (pool) drafts.push(...abilities(pool, chapter.name, "ability"));
      continue;
    }
    if (chapter.name !== "Crew playbook")
      rule(chapter.name, chapter.name, chapter.intro, chapter.name);
    for (const section of chapter.sections) {
      if (section.name === "Crew special abilities") {
        drafts.push(...abilities(section, chapter.name, "crew-ability"));
      } else if (
        (chapter.name === "Crew creation" && section.name === "Crew upgrade Examples") ||
        (chapter.name === "Crew playbook" && section.name === "Crew upgrades")
      ) {
        const [list, claims] = section.text.split(/^### Make a Claim Map for the Crew\s*$/m);
        const items = upgrades(list, chapter.name);
        drafts.push(...items);
        rule(chapter.name, section.name, items.map((item) => `- **${item.name}**`).join("\n"));
        if (claims) rule(chapter.name, "Make a Claim Map for the Crew", claims);
      } else if (chapter.name !== "Crew playbook") {
        rule(chapter.name, section.name, section.text);
      }
    }
  }
  return drafts;
}

const tableCells = (line: string) =>
  line
    .trim()
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\[\]\(\)/g, "").trim());

function markdown(text: string): string {
  const lines = text
    .replace(/!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/gi, "")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (original, label: string, url: string) =>
      /\.(?:webp|png|jpe?g|gif|svg)(?:[?#]|$)/i.test(url) || !/^https?:\/\//i.test(url)
        ? label
        : original,
    )
    .split("\n")
    .filter((line) => !/^@TODO\b/.test(line));
  const output: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim().startsWith("|")) {
      const table: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|"))
        table.push(tableCells(lines[index++]));
      index--;
      // Empty character action templates carry no rules or example ratings.
      if (table.slice(2).every((row) => row.every((cell) => !cell || /^[○●□]+$/.test(cell))))
        continue;
      output.push(
        ...table.map(
          (row, rowIndex) =>
            `| ${row.map((cell) => (rowIndex === 1 ? "---" : cell.replace(/ {2,}/g, " "))).join(" | ")} |`,
        ),
      );
    } else {
      output.push(line.replace(/^(\s*)\* /, "$1- ").replace(/^>\s*/, "> "));
    }
  }
  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(
      /(?<![+\-\w])(\d+)d\b(?!\d)/g,
      (label, count: string, offset: number, body: string) => {
        if (/^\*{0,3}\s+for each\b/i.test(body.slice(offset + label.length))) return label;
        const notation = `${count}d6kh${count === "0" ? "z" : "1"}`;
        return parseNotation(notation).ok ? `[[r:${notation}|${label}]]` : label;
      },
    );
}

const hash = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 10);
const suffixed = (base: string, suffix: string) =>
  `${base.slice(0, SLUG_MAX - suffix.length - 1).replace(/-+$/, "")}-${suffix}`;

function entriesFrom(drafts: Draft[]): BundleEntry[] {
  const slugs = drafts.map((draft) => slugify(draft.key));
  const ids = drafts.map((draft, index) => {
    const collision = drafts.some(
      (other, otherIndex) =>
        otherIndex !== index && other.typeId === draft.typeId && slugs[otherIndex] === slugs[index],
    );
    const slug = collision ? suffixed(slugs[index], hash(draft.key)) : slugs[index];
    return `${definition.source.id}/${draft.typeId}/${slug}`;
  });
  const targets = new Map<string, number[]>();
  drafts.forEach((draft, index) => {
    const names = [
      draft.name,
      ...[...draft.body.matchAll(/^#{3,6} (.+)$/gm)].map((match) => match[1]),
    ];
    for (const name of names) {
      const key = name.replace(/\*/g, "").toLowerCase();
      targets.set(key, [...(targets.get(key) ?? []), index]);
    }
  });
  return drafts.flatMap((draft, index) => {
    const body = markdown(draft.body).replace(
      /\*\*([^*\n]+)\*\*/g,
      (original, label: string, offset: number, text: string) => {
        const lineStart = text.lastIndexOf("\n", offset) + 1;
        if (/^[|#]/.test(text.slice(lineStart))) return original;
        const candidates = targets.get(label.toLowerCase()) ?? [];
        const primary = candidates.filter(
          (candidate) => drafts[candidate].chapter.toLowerCase() === label.toLowerCase(),
        );
        const target = primary.at(-1) ?? (candidates.length === 1 ? candidates[0] : undefined);
        return target !== undefined && target !== index
          ? `[[ref:${ids[target]}|${label}]]`
          : original;
      },
    );
    const entry: BundleEntry = {
      id: ids[index],
      typeId: draft.typeId,
      name: draft.name,
      body,
      fields:
        draft.typeId === "rule"
          ? { chapter: draft.chapter }
          : draft.cost === undefined
            ? {}
            : { cost: draft.cost },
      tags: [],
      visibility: "public",
    };
    return splitEntry(entry);
  });
}

const bytes = (entry: BundleEntry) =>
  new TextEncoder().encode(JSON.stringify({ ...entry, licence: definition.source.licence }))
    .byteLength;
const fits = (entry: BundleEntry) =>
  entry.body.length <= compendiumLimits.body && bytes(entry) <= compendiumLimits.entryBytes - 512;

function splitEntry(entry: BundleEntry): BundleEntry[] {
  if (fits(entry)) return [entry];
  // Reserve space for part names, ids, links and publishing metadata.
  const fitsPart = (body: string) => fits({ ...entry, body: `${body}\n\n${" ".repeat(512)}` });
  const parts: string[] = [];
  let current = "";
  for (const block of entry.body.split(/\n\n/)) {
    const joined = current ? `${current}\n\n${block}` : block;
    if (fitsPart(joined)) {
      current = joined;
      continue;
    }
    if (current) parts.push(current);
    current = "";
    if (fitsPart(block)) {
      current = block;
      continue;
    }
    // Long prose paragraphs split at words, keeping inline links together.
    for (const word of block.match(/\[\[[^\]]+\]\]\s*|\S+\s*/g) ?? []) {
      if (!fitsPart(current + word) && current) {
        parts.push(current.trimEnd());
        current = "";
      }
      if (fitsPart(word)) {
        current += word;
        continue;
      }
      const characters = Array.from(word);
      let start = 0;
      while (start < characters.length) {
        let low = start + 1;
        let high = characters.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (fitsPart(characters.slice(start, middle).join(""))) low = middle;
          else high = middle - 1;
        }
        const chunk = characters.slice(start, low).join("");
        if (low < characters.length) parts.push(chunk);
        else current = chunk;
        start = low;
      }
    }
  }
  if (current) parts.push(current.trimEnd());
  return parts.map((body, index) => {
    const id =
      index === 0
        ? entry.id
        : `${definition.source.id}/${entry.typeId}/${suffixed(entry.id.split("/")[2], `part-${index + 1}`)}`;
    const link = (part: number, label: string) => {
      const target =
        part === 0
          ? entry.id
          : `${definition.source.id}/${entry.typeId}/${suffixed(entry.id.split("/")[2], `part-${part + 1}`)}`;
      return `[[ref:${target}|${label}]]`;
    };
    const navigation = [
      index > 0 ? link(index - 1, "Previous part") : "",
      index < parts.length - 1 ? link(index + 1, "Next part") : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      ...entry,
      id,
      name: `${entry.name} (${index + 1}/${parts.length})`,
      body: `${body}\n\n${navigation}`,
    };
  });
}

export function importBladesFrom(dir: string, revision: string): SourceBundle {
  const notice = readFileSync(join(dir, "README.md"), "utf8");
  // The README licenses this SRD as a whole; no per-section markers exist.
  if (!/https?:\/\/creativecommons\.org\/licenses\/by\/3\.0\//.test(notice))
    throw new Error("Blades SRD README must identify the CC BY 3.0 licence");
  const document = readFileSync(join(dir, "Blades-in-the-Dark-SRD.md"), "utf8");
  return {
    format: "ttrpg-source-bundle",
    formatVersion: 1,
    ...definition,
    provenance: {
      upstream: upstreamUrl,
      revision,
      importer: "tools/importers/blades",
      notes:
        "SRD text only, licensed as a whole by its README under CC BY 3.0. Includes rules, character and crew ability pools, named upgrade examples and sample claim rules. Excludes placeholder playbooks, crews, starting builds/actions, contacts, item lists and editorial TODOs; no images, image paths or logos. Fortitude's stray level-two heading is treated as an ability. Chapter introductions and worked example grids are retained. Fixed Blades pools use d6 keep-highest notation with the zero-dice fallback; bonuses and per-dot instructions remain prose. Original spelling and imperfect emphasis are retained. Based on Blades in the Dark; no endorsement implied.",
    },
    entries: entriesFrom(draftsFrom(document)),
  };
}

export function importBlades(): Promise<SourceBundle> {
  const source = upstream("blades");
  return Promise.resolve(importBladesFrom(source.dir, source.revision()));
}
