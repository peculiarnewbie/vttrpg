import type { EntryType } from "./compendium";
import type { IndexRow } from "./compendium-index";
import type { Facets } from "./entry-facets";

export type RangeSelection = { readonly min?: number; readonly max?: number };
export type SetSelection = { readonly any: readonly string[] };
export type FlagSelection = { readonly value: boolean };
type Selection = RangeSelection | SetSelection | FlagSelection;
export type FacetSelection = Readonly<Record<string, Selection | undefined>>;

type SummaryLabel = { readonly key: string; readonly label: string };
export type FacetSummary = SummaryLabel &
  (
    | {
        readonly kind: "range";
        readonly min: number | undefined;
        readonly max: number | undefined;
        readonly count: number;
      }
    | {
        readonly kind: "set";
        readonly options: readonly { readonly value: string; readonly count: number }[];
      }
    | { readonly kind: "flag"; readonly true: number; readonly false: number }
  );

export type RowSort = {
  readonly by: "name" | "type" | "updated" | { readonly facet: string };
  readonly direction: "asc" | "desc";
};

const compareText = new Intl.Collator(undefined, { sensitivity: "base" }).compare;
const compareIds = (a: IndexRow, b: IndexRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const isActive = (selection: Selection): boolean =>
  "any" in selection
    ? selection.any.length > 0
    : "value" in selection || selection.min !== undefined || selection.max !== undefined;

const matchesValue = (value: Facets[string] | undefined, selection: Selection): boolean => {
  if ("any" in selection) {
    if (typeof value === "string") return selection.any.includes(value);
    return Array.isArray(value) && value.some((item) => selection.any.includes(item));
  }
  if ("value" in selection) return value === selection.value;
  return (
    typeof value === "number" &&
    (selection.min === undefined || value >= selection.min) &&
    (selection.max === undefined || value <= selection.max)
  );
};

/** Empty ranges/sets are inactive. Pass the type to ignore undeclared keys. */
export const matchesFacets = (
  row: IndexRow,
  selection: FacetSelection,
  type?: EntryType,
): boolean => {
  if (type) {
    for (const filter of type.filters ?? []) {
      const selected = selection[filter.key];
      if (selected && isActive(selected) && !matchesValue(row.facets?.[filter.key], selected))
        return false;
    }
  } else {
    for (const key in selection) {
      if (!Object.hasOwn(selection, key)) continue;
      const selected = selection[key];
      if (selected && isActive(selected) && !matchesValue(row.facets?.[key], selected))
        return false;
    }
  }
  return true;
};

/** Rows are already scoped to the chosen type and search. Each facet excludes its own selection. */
export const facetSummaries = (
  type: EntryType,
  rows: readonly IndexRow[],
  selection: FacetSelection,
): FacetSummary[] => {
  const filters = type.filters ?? [];
  const active = filters.flatMap(({ key }) => {
    const selected = selection[key];
    return selected && isActive(selected) ? [{ key, selected }] : [];
  });
  const labels = new Map(type.fields.map((field) => [field.key, field.label]));
  return filters.map(({ key, kind }): FacetSummary => {
    const others = active.filter((filter) => filter.key !== key);
    let min: number | undefined;
    let max: number | undefined;
    let count = 0;
    let trueCount = 0;
    let falseCount = 0;
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (others.some((filter) => !matchesValue(row.facets?.[filter.key], filter.selected)))
        continue;
      const value = row.facets?.[key];
      switch (kind) {
        case "range":
          if (typeof value === "number") {
            min = min === undefined ? value : Math.min(min, value);
            max = max === undefined ? value : Math.max(max, value);
            count++;
          }
          break;
        case "set":
          if (typeof value === "string") counts.set(value, (counts.get(value) ?? 0) + 1);
          else if (Array.isArray(value)) {
            // A repeated option still represents one matching row.
            for (const item of new Set(value)) counts.set(item, (counts.get(item) ?? 0) + 1);
          }
          break;
        case "flag":
          if (value === true) trueCount++;
          else if (value === false) falseCount++;
          break;
      }
    }
    const label = labels.get(key) ?? key;
    switch (kind) {
      case "range":
        return { key, label, kind, min, max, count };
      case "set":
        return {
          key,
          label,
          kind,
          options: Array.from(counts, ([value, count]) => ({ value, count })).sort(
            (a, b) => b.count - a.count || compareText(a.value, b.value),
          ),
        };
      case "flag":
        return { key, label, kind, true: trueCount, false: falseCount };
    }
  });
};

type SortValue = Exclude<Facets[string], readonly string[]>;
const compareValues = (a: SortValue, b: SortValue): number => {
  // Different entry types may use the same facet key for different field kinds.
  if (typeof a !== typeof b) return typeof a < typeof b ? -1 : 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return compareText(String(a), String(b));
};

/** Missing facets sort last; ties use ascending ids. Type groups sort by name, then id. */
export const sortRows = <Row extends IndexRow>(
  rows: readonly Row[],
  sort: RowSort,
  types: readonly EntryType[],
): Row[] => {
  const direction = sort.direction === "asc" ? 1 : -1;
  const by = sort.by;
  let compare: (a: Row, b: Row) => number;
  if (typeof by === "object") {
    const valueOf = (row: Row): SortValue | undefined => {
      const value = row.facets?.[by.facet];
      return typeof value === "object" ? value[0] : value;
    };
    compare = (a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av === undefined) return bv === undefined ? compareIds(a, b) : 1;
      if (bv === undefined) return -1;
      return direction * compareValues(av, bv) || compareIds(a, b);
    };
  } else if (by === "type") {
    const names = new Map(types.map((type) => [type.id, type.name]));
    compare = (a, b) =>
      direction * compareText(names.get(a.typeId) ?? a.typeId, names.get(b.typeId) ?? b.typeId) ||
      compareText(a.name, b.name) ||
      compareIds(a, b);
  } else if (by === "updated") {
    compare = (a, b) =>
      direction * (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0) ||
      compareIds(a, b);
  } else {
    compare = (a, b) => direction * compareText(a.name, b.name) || compareIds(a, b);
  }
  return [...rows].sort(compare);
};
