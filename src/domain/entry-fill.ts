import type { CompendiumEntry } from "./compendium";
import { rowsFromEntryList } from "./compendium-rows";
import { rowsUpToLevel } from "./progression";
import type { LeafBlock, ListRow, SheetValues } from "./sheet-layout";

/*
 * Picking an entry for an entry block (a Knight, a class) can offer to copy the
 * entry's lists onto the sheet — a Knight's starting Property, a class's
 * features up to the character's level. Offered, never applied on its own: the
 * sheet and the character builder both show the offer and append on "Add".
 */

export type EntryBlock = Extract<LeafBlock, { type: "entry" }>;
export type ListBlock = Extract<LeafBlock, { type: "list" }>;
export type FillOffer = { to: string; title: string; rows: ListRow[] };

const level = (value: SheetValues[string]) =>
  typeof value === "number" ? value : Number(value ?? 0) || 0;

/** An entry with one list field replaced, so the row copier sees only those rows. */
export const withRows = (
  source: CompendiumEntry,
  key: string,
  rows: readonly ListRow[],
): CompendiumEntry => ({
  ...source,
  fields: { ...source.fields, [key]: rows as CompendiumEntry["fields"][string] },
});

/** What picking `entry` for `block` offers to copy, per target list; empty offers are left out. */
export const fillOffers = (
  entry: CompendiumEntry,
  block: EntryBlock,
  listBlock: (key: string) => ListBlock | undefined,
  values: SheetValues,
): FillOffer[] =>
  (block.fill ?? []).flatMap((fill) => {
    const list = listBlock(fill.to);
    // A progression only offers what the character's level reaches.
    const spec = block.progression;
    const all = entry.fields[fill.from];
    const source =
      spec?.field === fill.from && Array.isArray(all)
        ? withRows(
            entry,
            fill.from,
            rowsUpToLevel(all as readonly ListRow[], level(values[spec.level])),
          )
        : entry;
    const rows = list ? rowsFromEntryList(source, fill.from, list.columns) : [];
    return rows.length ? [{ to: fill.to, title: list?.title ?? fill.to, rows }] : [];
  });

/** The list values after accepting offers: each offer's rows appended to its list. */
export const acceptedFills = (
  offers: readonly FillOffer[],
  values: SheetValues,
): [key: string, rows: ListRow[]][] =>
  offers.map((offer) => [
    offer.to,
    [...((values[offer.to] as readonly ListRow[] | undefined) ?? []), ...offer.rows],
  ]);
