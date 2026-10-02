import { notationRefs, parseNotation, type Ref, type RefLookup } from "./dice-notation";
import { computeDerived, exprRefs, parseExpr, type DerivedResult, type ExprScope } from "./derived";
import { allBlocks, derivedKeys, layoutKeys } from "./layout-edit";
import { layoutTrackers, type ListRow, type SheetLayout, type SheetValues } from "./sheet-layout";

/*
 * How `@refs` in derived values and roll notation read a character's values.
 * Used by the sheet (display) and by the server (rolls), so both agree.
 *
 * - `@key` — a derived value if the layout defines one with that key;
 *   otherwise the character value: a number; a numeric string ("3"); true = 1,
 *   false = 0; a string array (checks) = how many are checked; a list = its
 *   row count. Anything else (empty, text) is `undefined`, i.e. 0.
 * - `@list.column` — the sum of that numeric column over the list's rows.
 * - `@row.column` — the column in the current row (a list row's roll or a
 *   derived list column); `undefined` without a current row.
 */

const numeric = (value: SheetValues[string]): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "string") {
    if (!value.trim()) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (Array.isArray(value)) return value.length;
  return undefined;
};

const ownValue = <T>(values: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(values, key) ? values[key] : undefined;

const isList = (value: SheetValues[string]): value is readonly ListRow[] =>
  Array.isArray(value) &&
  value.every((row) => typeof row === "object" && row !== null && !Array.isArray(row));

/**
 * The values refs read. Trackers keep their values apart from the others
 * (`Character.tickers`), so they're merged in the way the sheet shows them:
 * the character's value, else the item's start, else its maximum.
 */
export const refValues = (
  layout: SheetLayout | undefined,
  values: SheetValues,
  tickers: Readonly<Record<string, number>> = {},
): SheetValues => {
  const merged: SheetValues = { ...values, ...tickers };
  for (const item of layout ? layoutTrackers(layout) : [])
    merged[item.key] = tickers[item.key] ?? item.start ?? item.max;
  return merged;
};

/** Resolve refs to non-derived values. */
export const valueScope =
  (values: SheetValues, row?: ListRow): ExprScope =>
  (ref) => {
    const column = ref.column;
    if (column === undefined) return numeric(ownValue(values, ref.key));
    if (ref.key === "row") return row ? numeric(ownValue(row, column)) : undefined;
    const list = ownValue(values, ref.key);
    if (!isList(list)) return undefined;
    const sum = list.reduce((total, item) => {
      const cell = ownValue(item, column);
      return (
        total + (typeof cell === "number" || typeof cell === "string" ? (numeric(cell) ?? 0) : 0)
      );
    }, 0);
    return Number.isFinite(sum) ? sum : 0;
  };

/** {@link computeDerived} for a layout's `derived` list against these values. */
export const sheetDerived = (layout: SheetLayout | undefined, values: SheetValues): DerivedResult =>
  computeDerived(layout?.derived ?? [], valueScope(values));

/** Derived values first, then {@link valueScope}. */
export const sheetScope = (
  layout: SheetLayout | undefined,
  values: SheetValues,
  row?: ListRow,
): ExprScope => {
  const derived = sheetDerived(layout, values).values;
  const base = valueScope(values, row);
  return (ref) =>
    ref.column === undefined && Object.hasOwn(derived, ref.key) ? derived[ref.key] : base(ref);
};

/**
 * Lookup for {@link rollNotation}. Labels come from the layout: a derived
 * value's label, else the label of a stat/field/tracker item with that key,
 * else a list column's label for `@row.column`, else the key itself. Refs that
 * resolve to `undefined` still resolve (to 0) when the key is known to the
 * layout or present in `values`; otherwise the lookup returns `undefined` so
 * a typo fails the roll instead of silently adding 0.
 */
export const sheetRefLookup = (
  layout: SheetLayout | undefined,
  values: SheetValues,
  row?: ListRow,
): RefLookup => {
  const scope = sheetScope(layout, values, row);
  const known = new Set(layout ? [...layoutKeys(layout), ...derivedKeys(layout)] : []);
  const blocks = layout ? allBlocks(layout) : [];
  const label = (ref: Ref): string => {
    if (ref.column === undefined) {
      const derived = layout?.derived?.find((item) => item.key === ref.key);
      if (derived) return derived.label;
      for (const block of blocks) {
        if (block.type === "stats" || block.type === "fields" || block.type === "trackers") {
          const item = block.items.find((item) => item.key === ref.key);
          if (item) return item.label;
        }
      }
    } else {
      for (const block of blocks) {
        if (block.type !== "list" || (ref.key !== "row" && block.key !== ref.key)) continue;
        const column = block.columns.find((column) => column.key === ref.column);
        if (column)
          return ref.key === "row" ? column.label : `${block.title || block.key} ${column.label}`;
      }
    }
    return ref.key;
  };
  return (ref) => {
    if (!known.has(ref.key) && !Object.hasOwn(values, ref.key) && !(ref.key === "row" && row))
      return undefined;
    return { value: scope(ref) ?? 0, label: label(ref) };
  };
};

const refText = (ref: Ref): string => {
  const parts = ref.column === undefined ? [ref.key] : [ref.key, ref.column];
  const key = parts.join(".");
  return parts.every((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) ? `@${key}` : `@{${key}}`;
};

/**
 * Problems an author should see while editing, which don't block saving
 * (so older layouts stay saveable): derived cycles, roll notations that
 * don't parse, refs to keys the layout doesn't know. One sentence each,
 * naming the block or derived value.
 */
export const layoutProblems = (layout: SheetLayout): string[] => {
  const problems: string[] = [];
  const known = new Set([...layoutKeys(layout), ...derivedKeys(layout)]);
  const checkRefs = (name: string, refs: readonly Ref[], inList: boolean) => {
    for (const ref of new Map(refs.map((ref) => [refText(ref), ref])).values())
      if (!known.has(ref.key) && !(inList && ref.key === "row"))
        problems.push(`${name} uses ${refText(ref)}, which isn't on the sheet`);
  };
  const expression = (label: string, expr: string, inList = false) => {
    const name = `Derived "${label}"`;
    const parsed = parseExpr(expr);
    if (!parsed.ok) problems.push(`${name}: ${parsed.error}`);
    else checkRefs(name, exprRefs(parsed.value), inList);
  };
  const roll = (label: string, dice: string, inList = false) => {
    const name = `Roll "${label}"`;
    const parsed = parseNotation(dice);
    if (!parsed.ok) problems.push(`${name}: ${parsed.error}`);
    else checkRefs(name, notationRefs(parsed.value), inList);
  };
  const { errors } = sheetDerived(layout, {});
  const seen = new Set<string>();
  for (const item of layout.derived ?? []) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    expression(item.label, item.expr);
    if (errors[item.key] === "Refers to itself")
      problems.push(`Derived "${item.label}" refers to itself`);
  }
  for (const block of allBlocks(layout)) {
    switch (block.type) {
      case "rolls":
        for (const item of block.items) roll(item.label, item.dice);
        break;
      case "stats":
      case "trackers":
        for (const item of block.items) if (item.roll !== undefined) roll(item.label, item.roll);
        break;
      case "list":
        if (block.roll !== undefined) roll(block.title || block.key, block.roll, true);
        for (const column of block.columns)
          if (column.kind === "derived") expression(column.label, column.expr ?? "", true);
        break;
    }
  }
  // Builder steps refer to blocks by id and key; a dangling one is skipped when shown.
  const blocks = allBlocks(layout);
  const entryKeys = new Set(blocks.flatMap((block) => (block.type === "entry" ? [block.key] : [])));
  const choosable = new Set(
    blocks.flatMap((block) =>
      block.type === "entry" || (block.type === "list" && block.source) ? [block.key] : [],
    ),
  );
  const blockIds = new Set(blocks.map((block) => block.id));
  for (const step of layout.builder?.steps ?? []) {
    const name = `Builder step "${step.title}"`;
    for (const part of step.parts) {
      switch (part.type) {
        case "blocks":
          for (const id of part.blocks)
            if (!blockIds.has(id))
              problems.push(`${name} shows block "${id}", which isn't on the sheet`);
          break;
        case "choose":
          if (!choosable.has(part.key))
            problems.push(
              `${name} chooses into "${part.key}", which isn't an entry block or a list from the compendium`,
            );
          if (part.from && !entryKeys.has(part.from.entry))
            problems.push(
              `${name} takes options from "${part.from.entry}", which isn't an entry block`,
            );
          break;
        case "rolls":
          for (const item of part.items) roll(item.label, item.dice);
          break;
        case "tables":
          if (part.from && !entryKeys.has(part.from.entry))
            problems.push(
              `${name} takes tables from "${part.from.entry}", which isn't an entry block`,
            );
          if (!part.from && !part.entries?.length)
            problems.push(`${name} has a tables part with no tables`);
          break;
      }
    }
  }
  return problems;
};
