import { allBlocks } from "./layout-edit";
import type { SheetLayout } from "./sheet-layout";

/*
 * What the formula editor offers while an author types: the refs a formula
 * can read on this layout (with their labels), the functions with a short
 * example each, and where a parse error points.
 */

export type RefSuggestion = {
  /** What gets inserted, e.g. "@str", "@gear.weight", "@row.qty". */
  readonly text: string;
  readonly label: string;
  /** What kind of value it is, shown beside the label. */
  readonly detail: string;
};

const refText = (key: string, column?: string) => {
  const parts = column === undefined ? [key] : [key, column];
  return parts.every((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part))
    ? `@${parts.join(".")}`
    : `@{${parts.join(".")}}`;
};

/**
 * Every ref a formula on this layout can read. In a list's computed column
 * (`list`), that list's `@row.column` refs come first.
 */
export const formulaRefs = (layout: SheetLayout, list?: string): RefSuggestion[] => {
  const suggestions: RefSuggestion[] = [];
  const blocks = allBlocks(layout);
  const own = blocks.find((block) => block.type === "list" && block.key === list);
  if (own?.type === "list")
    for (const column of own.columns)
      suggestions.push({
        text: refText("row", column.key),
        label: column.label,
        detail: "this row",
      });
  for (const item of layout.derived ?? [])
    suggestions.push({ text: refText(item.key), label: item.label, detail: "formula" });
  for (const block of blocks)
    switch (block.type) {
      case "stats":
      case "fields":
      case "trackers":
        for (const item of block.items)
          suggestions.push({
            text: refText(item.key),
            label: item.label,
            detail:
              block.type === "trackers" ? "tracker" : block.type === "stats" ? "stat" : "field",
          });
        break;
      case "checks":
        suggestions.push({
          text: refText(block.key),
          label: block.label ?? block.key,
          detail: "checks (count)",
        });
        break;
      case "text":
        suggestions.push({
          text: refText(block.key),
          label: block.label ?? block.key,
          detail: "text",
        });
        break;
      case "entry":
        suggestions.push({
          text: refText(block.key),
          label: block.label ?? block.key,
          detail: "entry (.field reads it)",
        });
        break;
      case "list":
        suggestions.push({
          text: refText(block.key),
          label: block.title ?? block.key,
          detail: "list (rows)",
        });
        for (const column of block.columns)
          suggestions.push({
            text: refText(block.key, column.key),
            label: `${block.title ?? block.key} ${column.label}`,
            detail: "column total",
          });
        break;
    }
  const seen = new Set<string>();
  return suggestions.filter((item) => !seen.has(item.text) && (seen.add(item.text), true));
};

/** Refs matching what's typed after "@" (prefix of the ref or a word of its label). */
export const matchRefs = (
  suggestions: readonly RefSuggestion[],
  typed: string,
): RefSuggestion[] => {
  const query = typed.toLowerCase();
  const starts = suggestions.filter((item) => item.text.slice(1).toLowerCase().startsWith(query));
  const words = suggestions.filter(
    (item) =>
      !starts.includes(item) &&
      (item.text.toLowerCase().includes(query) ||
        item.label
          .toLowerCase()
          .split(/\s+/)
          .some((word) => word.startsWith(query))),
  );
  return [...starts, ...words];
};

/** The "@…" being typed just before the cursor, if any: its start and text after "@". */
export const refAtCursor = (
  text: string,
  cursor: number,
): { start: number; typed: string } | undefined => {
  const match = /@\{?([A-Za-z0-9_.]*)$/.exec(text.slice(0, cursor));
  return match ? { start: match.index, typed: match[1] } : undefined;
};

/** A parse error split into its message and the position it points at. */
export const errorAt = (error: string): { message: string; position?: number } => {
  const match = / at (\d+)$/.exec(error);
  return match
    ? { message: error.slice(0, match.index), position: Number(match[1]) }
    : { message: error };
};

export type FunctionHelp = {
  readonly name: string;
  readonly example: string;
  readonly does: string;
};

export const FUNCTION_HELP: readonly FunctionHelp[] = [
  {
    name: "floor / ceil / round",
    example: "floor((@str - 10) / 2)",
    does: "round down / up / to nearest",
  },
  { name: "min / max", example: "min(@dex_mod, 2)", does: "smallest / largest of the values" },
  { name: "clamp", example: "clamp(@hp, 0, @hp_max)", does: "keep a value between two others" },
  { name: "if", example: 'if(@level >= 5, "Veteran", "Novice")', does: "one of two values" },
  {
    name: "step",
    example: "step(@level, 1: 2, 5: 3, 9: 4)",
    does: "a table: the value at the highest threshold reached",
  },
  { name: "pick", example: "pick(@size, 6, 8, 10)", does: "the first, second, … value" },
  {
    name: "sum",
    example: "sum(@gear, @row.weight * @row.qty)",
    does: "add up a value over a list's rows",
  },
  {
    name: "count",
    example: "count(@spells, @row.prepared)",
    does: "rows (that match), or ticked checks",
  },
  {
    name: "highest / lowest",
    example: "highest(@weapons, @row.damage)",
    does: "the largest / smallest over a list's rows",
  },
  {
    name: "has",
    example: 'has(@skills, "Stealth")',
    does: "whether an option is ticked, or a row has that name",
  },
  {
    name: "scale",
    example: "scale(@class.levels, @level, @row.proficiency)",
    does: "a level table: a value from the row for this level",
  },
  {
    name: "@entry.field",
    example: "@class.hit_die",
    does: "a field of the entry chosen in an entry block",
  },
  { name: "text", example: 'text("Level ", @level)', does: "join values into text" },
  {
    name: "and / or / not",
    example: "@level > 4 and not @tired",
    does: "combine conditions (1 or 0)",
  },
];
