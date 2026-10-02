import type { CompendiumEntry } from "./compendium";
import type { EntryBlock, ListBlock } from "./entry-fill";
import { allBlocks } from "./layout-edit";
import type { SheetLayout, SheetValues } from "./sheet-layout";

/*
 * Reading a character builder's parts against the layout and the character
 * (see `SheetBuilder` in sheet-layout.ts). The builder only shows and offers;
 * these never write anything.
 */

/** The block a `choose` part fills: an entry block (one pick) or a list from the compendium. */
export const chooseTarget = (
  layout: SheetLayout,
  key: string,
): EntryBlock | (ListBlock & { source: { entryType: string } }) | undefined => {
  for (const block of allBlocks(layout)) {
    if (block.type === "entry" && block.key === key) return block;
    if (block.type === "list" && block.key === key && block.source)
      return block as ListBlock & { source: { entryType: string } };
  }
  return undefined;
};

export const chooseEntryType = (target: NonNullable<ReturnType<typeof chooseTarget>>) =>
  target.type === "entry" ? target.entryType : target.source.entryType;

/** The list block with this key, anywhere in the layout (where entry copies go). */
export const listBlockOf = (layout: SheetLayout, key: string): ListBlock | undefined =>
  allBlocks(layout).find((block): block is ListBlock => block.type === "list" && block.key === key);

/**
 * Entry ids listed by a reference field of the entry chosen at `from.entry`
 * (a playbook's moves, a background's tables). `undefined` until that entry is
 * chosen and loaded, so the builder can say "choose one first".
 */
export const referencedIds = (
  from: { entry: string; field: string },
  values: SheetValues,
  entryOf: (id: string) => CompendiumEntry | undefined,
): string[] | undefined => {
  const id = values[from.entry];
  if (typeof id !== "string" || !id) return undefined;
  const entry = entryOf(id);
  if (!entry) return undefined;
  const value = entry.fields[from.field];
  if (typeof value === "string") return value ? [value] : [];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};
