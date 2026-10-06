import { notationRefs, parseNotation, type Ref, type RefLookup } from "./dice-notation";
import {
  computeDerivedWith,
  evaluate,
  evaluateNumber,
  exprLists,
  exprRefs,
  parseExpr,
  toNumber,
  withRow,
  type DerivedResult,
  type Expr,
  type RowScope,
  type Scalar,
  type Scope,
} from "./derived";
import { builderProblems } from "./builder-parts";
import { allBlocks, derivedKeys, layoutKeys } from "./layout-edit";
import {
  layoutTrackers,
  type ListRow,
  type SheetLayout,
  type SheetValues,
  type TrackerItem,
} from "./sheet-layout";

/*
 * How `@refs` in formulas and roll notation read a character's values.
 * Used by the sheet (display) and by the server (rolls), so both agree.
 *
 * - `@key` — a derived value if the layout defines one with that key;
 *   otherwise the character value: a number; numeric text ("3") as a number;
 *   other text as text; true = 1, false = 0; a string array (checks) = how
 *   many are checked; a list = its row count. Empty is `undefined`, i.e. 0.
 * - `@list.column` — the sum of that column over the list's rows (a computed
 *   column sums its computed values).
 * - `@entry.field` — a field of the compendium entry chosen in entry block
 *   `entry` (`@class.hit_die`), read like a character value; empty while the
 *   entry isn't loaded. Its list fields are lists to aggregates:
 *   `scale(@class.levels, @level, @row.proficiency)`.
 * - `@row.column` — the column in the current row (a list row's roll or a
 *   computed list column); `undefined` without a current row.
 * - `sum(@list, …)`, `count(@checks)` and the other aggregates read the
 *   list's rows and the checks' ticked options through the same scope.
 */

const scalar = (value: SheetValues[string] | ListRow[string] | undefined): Scalar | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "string") {
    if (!value.trim()) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (Array.isArray(value)) return value.length;
  return undefined;
};

const ownValue = <T>(values: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(values, key) ? values[key] : undefined;

const isList = (value: SheetValues[string] | undefined): value is readonly ListRow[] =>
  Array.isArray(value) &&
  value.every((row) => typeof row === "object" && row !== null && !Array.isArray(row));

const isChecks = (value: SheetValues[string] | undefined): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * A chosen compendium entry's fields, by entry id: what `@entry.field` reads.
 * `undefined` while the entry isn't loaded, or isn't visible to the reader.
 */
export type EntryFields = (id: string) => Readonly<Record<string, SheetValues[string]>> | undefined;

/** Keys of the layout's entry blocks: the keys `@key.field` reads an entry's field through. */
const entryBlockKeys = (layout: SheetLayout | undefined): ReadonlySet<string> =>
  new Set(
    (layout ? allBlocks(layout) : []).flatMap((block) =>
      block.type === "entry" ? [block.key] : [],
    ),
  );

/**
 * A tracker's maximum: the character's own if set, else its `maxFrom`
 * formula (floored, kept within the item's min and max), else the item's.
 */
export const trackerMaxOf = (item: TrackerItem, own: number | undefined, scope: Scope): number => {
  if (own !== undefined) return own;
  if (!item.maxFrom?.trim()) return item.max;
  const parsed = parseExpr(item.maxFrom);
  if (!parsed.ok) return item.max;
  return Math.max(item.min, Math.min(item.max, Math.floor(evaluateNumber(parsed.value, scope))));
};

/**
 * The values refs read. Trackers keep their values apart from the others
 * (`Character.tickers`), so they're merged in the way the sheet shows them:
 * the character's value, else the item's start, else its maximum — never
 * above the maximum a `maxFrom` formula gives (a new character's tracker
 * starts at the item's ceiling and reads as full).
 */
export const refValues = (
  layout: SheetLayout | undefined,
  values: SheetValues,
  tickers: Readonly<Record<string, number>> = {},
  options: {
    /** The character's own maxima (`Character.tickerMax`). */
    readonly tickerMax?: Readonly<Record<string, number>>;
    readonly entries?: EntryFields;
  } = {},
): SheetValues => {
  const merged: SheetValues = { ...values, ...tickers };
  const items = layout ? layoutTrackers(layout) : [];
  for (const item of items) merged[item.key] = tickers[item.key] ?? item.start ?? item.max;
  const formulas = items.filter((item) => item.maxFrom?.trim());
  if (!formulas.length) return merged;
  // Maxima read the unclamped values (a maximum reading its own tracker is a loop, read as is).
  const scope = sheetScope(layout, merged, undefined, options.entries);
  const maxima = formulas.map(
    (item) => [item, trackerMaxOf(item, options.tickerMax?.[item.key], scope)] as const,
  );
  for (const [item, max] of maxima) merged[item.key] = Math.min(max, merged[item.key] as number);
  return merged;
};

/** The current list row, and which list it's in (so its computed columns compute). */
export type CurrentRow = { readonly row: ListRow; readonly list?: string };

/**
 * Resolve refs to non-derived values. With a layout, computed list columns
 * compute, reading other refs through `self` (the finished scope, derived
 * values included).
 */
export const valueScope = (
  values: SheetValues,
  at?: CurrentRow,
  layout?: SheetLayout,
  self?: () => Scope,
  entries?: EntryFields,
): Scope => {
  const entryKeys = entryBlockKeys(layout);
  // The fields of the entry chosen at `key`, when `key` is an entry block with a loaded pick.
  const entryOf = (key: string) => {
    const id = entryKeys.has(key) ? ownValue(values, key) : undefined;
    return typeof id === "string" && id ? entries?.(id) : undefined;
  };
  const computed = new Map<string, Map<string, Expr | undefined>>();
  for (const block of layout ? allBlocks(layout) : [])
    if (block.type === "list")
      for (const column of block.columns)
        if (column.kind === "derived") {
          const columns = computed.get(block.key) ?? new Map<string, Expr | undefined>();
          const parsed = parseExpr(column.expr ?? "");
          columns.set(column.key, parsed.ok ? parsed.value : undefined);
          computed.set(block.key, columns);
        }
  // A computed column that reads itself (through other columns) reads as empty.
  const pending = new WeakMap<ListRow, Set<string>>();
  const rowScope =
    (list: string | undefined, row: ListRow): RowScope =>
    (column) => {
      const columns = list === undefined ? undefined : computed.get(list);
      if (!columns?.has(column)) return scalar(ownValue(row, column));
      const expr = columns.get(column);
      const busy = pending.get(row) ?? new Set<string>();
      if (!expr || busy.has(column)) return undefined;
      busy.add(column);
      pending.set(row, busy);
      try {
        return evaluate(expr, withRow(self?.() ?? scope, rowScope(list, row)));
      } finally {
        busy.delete(column);
      }
    };
  const scope: Scope = {
    value: (ref) => {
      const column = ref.column;
      if (column === undefined) return scalar(ownValue(values, ref.key));
      if (ref.key === "row") return at ? rowScope(at.list, at.row)(column) : undefined;
      if (entryKeys.has(ref.key)) {
        const fields = entryOf(ref.key);
        return fields ? scalar(ownValue(fields, column)) : undefined;
      }
      const list = ownValue(values, ref.key);
      if (!isList(list)) return undefined;
      // Sums numbers and numeric text; ticks and tags in the column don't add (count() counts them).
      const isComputed = computed.get(ref.key)?.has(column) ?? false;
      const sum = list.reduce((total, row) => {
        const cell = ownValue(row, column);
        return (
          total +
          (isComputed || typeof cell === "number" || typeof cell === "string"
            ? toNumber(rowScope(ref.key, row)(column))
            : 0)
        );
      }, 0);
      return Number.isFinite(sum) ? sum : 0;
    },
    rows: (key, field) => {
      if (field !== undefined) {
        const fields = entryOf(key);
        const list = fields && ownValue(fields, field);
        return isList(list) ? list.map((row) => rowScope(undefined, row)) : undefined;
      }
      const list = ownValue(values, key);
      return isList(list) ? list.map((row) => rowScope(key, row)) : undefined;
    },
    checked: (key) => {
      const checks = ownValue(values, key);
      return isChecks(checks) && !isList(checks) ? checks : undefined;
    },
  };
  return scope;
};

/** {@link computeDerived} for a layout's `derived` list against these values. */
export const sheetDerived = (
  layout: SheetLayout | undefined,
  values: SheetValues,
  entries?: EntryFields,
): DerivedResult =>
  computeDerivedWith(layout?.derived ?? [], (self) =>
    valueScope(values, undefined, layout, () => self, entries),
  );

/** Derived values first, then {@link valueScope}. */
export const sheetScope = (
  layout: SheetLayout | undefined,
  values: SheetValues,
  at?: CurrentRow,
  entries?: EntryFields,
  /** {@link sheetDerived} for these values, when the caller already has it. */
  result: DerivedResult = sheetDerived(layout, values, entries),
): Scope => {
  const derived = result.values;
  const base = valueScope(values, at, layout, () => scope, entries);
  const scope: Scope = {
    ...base,
    value: (ref) =>
      ref.column === undefined && Object.hasOwn(derived, ref.key)
        ? derived[ref.key]
        : base.value(ref),
  };
  return scope;
};

/**
 * Whether a condition formula holds on this scope: a non-zero number or
 * non-blank text. A blank one, or one that doesn't parse, gives `otherwise`
 * — true for "applies when", so a typo never hides something (the layout
 * editor names the problem), false for "done when".
 */
export const formulaHolds = (
  formula: string | undefined,
  scope: Scope,
  otherwise = true,
): boolean => {
  if (!formula?.trim()) return otherwise;
  const parsed = parseExpr(formula);
  if (!parsed.ok) return otherwise;
  const value = evaluate(parsed.value, scope);
  return typeof value === "string" ? value.trim() !== "" : value !== 0;
};

/**
 * What a ref is called on the sheet: a derived value's label, an item's
 * label (stats, fields, trackers), a block's label or a list's title for its
 * key, a list column's label (`@row.column`, or "List Column"), else the key.
 */
export const refLabel = (layout: SheetLayout, ref: Ref): string => {
  const blocks = allBlocks(layout);
  if (ref.column === undefined) {
    const derived = layout.derived?.find((item) => item.key === ref.key);
    if (derived) return derived.label;
    for (const block of blocks) {
      if (block.type === "stats" || block.type === "fields" || block.type === "trackers") {
        const item = block.items.find((item) => item.key === ref.key);
        if (item) return item.label;
      } else if (block.type === "list" && block.key === ref.key) return block.title || block.key;
      else if (
        (block.type === "checks" || block.type === "text" || block.type === "entry") &&
        block.key === ref.key
      )
        return block.label || block.key;
    }
  } else if (entryBlockKeys(layout).has(ref.key)) {
    // The entry type's field labels aren't in the layout: "Class hit die".
    const block = blocks.find((block) => block.type === "entry" && block.key === ref.key);
    const label = (block?.type === "entry" && block.label) || ref.key;
    return `${label} ${ref.column.replace(/_/g, " ")}`;
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

/**
 * Lookup for {@link rollNotation}, labelled by {@link refLabel}. Refs that
 * resolve to `undefined` still resolve (to 0) when the key is known to the
 * layout or present in `values`; otherwise the lookup returns `undefined` so
 * a typo fails the roll instead of silently adding 0. Text values come along
 * as `text`, so dice text (a hit die, "1d10") rolls as dice.
 */
export const sheetRefLookup = (
  layout: SheetLayout | undefined,
  values: SheetValues,
  at?: CurrentRow,
  entries?: EntryFields,
): RefLookup => {
  const scope = sheetScope(layout, values, at, entries);
  const known = new Set(layout ? [...layoutKeys(layout), ...derivedKeys(layout)] : []);
  return (ref) => {
    if (!known.has(ref.key) && !Object.hasOwn(values, ref.key) && !(ref.key === "row" && at))
      return undefined;
    const value = scope.value(ref);
    return {
      value: toNumber(value),
      label: layout ? refLabel(layout, ref) : ref.key,
      ...(typeof value === "string" ? { text: value } : {}),
    };
  };
};

/**
 * Entry blocks whose chosen entry's fields these refs read (`@class.hit_die`,
 * `sum(@class.levels, …)`), directly or through the layout's formulas — the
 * entries a roll must load first. Every formula in the layout counts, since a
 * derived value can read another.
 */
export const entriesRead = (layout: SheetLayout | undefined, refs: readonly Ref[]): string[] => {
  const keys = entryBlockKeys(layout);
  if (!keys.size || !layout) return [];
  const formulas = [
    ...(layout.derived ?? []).map((item) => item.expr),
    ...allBlocks(layout).flatMap((block) =>
      block.type === "list"
        ? block.columns.flatMap((column) => (column.kind === "derived" ? [column.expr ?? ""] : []))
        : block.type === "trackers"
          ? block.items.flatMap((item) => (item.maxFrom ? [item.maxFrom] : []))
          : [],
    ),
  ];
  const all = [
    ...refs,
    ...formulas.flatMap((formula) => {
      const parsed = parseExpr(formula);
      return parsed.ok ? exprRefs(parsed.value) : [];
    }),
  ];
  return [...keys].filter((key) => all.some((ref) => ref.key === key && ref.column !== undefined));
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
  const blocksOf = allBlocks(layout);
  const listColumns = new Map(
    blocksOf.flatMap((block) =>
      block.type === "list"
        ? [[block.key, block.columns.map((column) => column.key)] as const]
        : [],
    ),
  );
  const checksKeys = new Set(
    blocksOf.flatMap((block) => (block.type === "checks" ? [block.key] : [])),
  );
  const expression = (
    label: string,
    expr: string,
    inList = false,
    name = `Derived "${label}"`,
    others: ReadonlySet<string> | "any" = new Set(),
  ) => {
    const parsed = parseExpr(expr);
    if (!parsed.ok) {
      problems.push(`${name}: ${parsed.error}`);
      return;
    }
    if (others !== "any")
      checkRefs(
        name,
        exprRefs(parsed.value).filter((ref) => !others.has(ref.key)),
        inList,
      );
    // sum(@list, …), count(@checks) and the like read a list's rows or a checks block's ticks.
    for (const { list, field, columns } of parsed.value ? exprLists(parsed.value) : []) {
      if (field !== undefined) {
        // An entry's list field: its columns belong to the entry type, which the layout doesn't know.
        if (!blocksOf.some((block) => block.type === "entry" && block.key === list))
          problems.push(`${name} reads @${list}.${field} as a list, but @${list} isn't an entry`);
        continue;
      }
      const known = listColumns.get(list);
      if (!known && !checksKeys.has(list)) {
        if (layoutKeys(layout).includes(list))
          problems.push(`${name} reads @${list} as a list, but it isn't a list or checks`);
        continue;
      }
      for (const column of new Set(columns))
        if (!known?.includes(column))
          problems.push(`${name} reads @row.${column}, which isn't a column of @${list}`);
    }
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
    if (block.when && "expr" in block.when)
      expression(block.id, block.when.expr, false, `Block "${block.id}" shows when`);
    switch (block.type) {
      case "rolls":
        for (const item of block.items) roll(item.label, item.dice);
        break;
      case "stats":
        for (const item of block.items) if (item.roll !== undefined) roll(item.label, item.roll);
        break;
      case "trackers":
        for (const item of block.items) {
          if (item.roll !== undefined) roll(item.label, item.roll);
          if (item.maxFrom?.trim())
            expression(item.label, item.maxFrom, false, `Tracker "${item.label}" maximum`);
        }
        break;
      case "list":
        if (block.roll !== undefined) roll(block.title || block.key, block.roll, true);
        for (const column of block.columns)
          if (column.kind === "derived") expression(column.label, column.expr ?? "", true);
        break;
    }
  }
  // Builder steps refer to blocks by id and key; a dangling one is skipped when shown.
  builderProblems(layout, {
    problem: (message) => problems.push(message),
    roll: (label, dice) => roll(label, dice),
    formula: (label, expr, others) => expression(label, expr, false, `Builder "${label}"`, others),
  });
  return problems;
};
