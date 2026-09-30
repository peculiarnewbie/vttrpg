import type {
  BlockType,
  GroupBlock,
  LayoutBlock,
  LeafBlock,
  SheetLayout,
  SheetPage,
} from "./sheet-layout";

/*
 * Pure edits over a SheetLayout for the template editor. Blocks are addressed by
 * id alone: ids are unique across the whole layout (pages and groups included).
 */

export const slugKey = (label: string) =>
  label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "item";

export const allBlocks = (layout: SheetLayout): LayoutBlock[] =>
  layout.pages.flatMap((page) =>
    page.blocks.flatMap((block) => (block.type === "group" ? [block, ...block.blocks] : [block])),
  );

/** An id not used anywhere in the layout, e.g. `stats-2`. */
export const freshId = (layout: SheetLayout, base: string) => {
  const used = new Set([
    ...allBlocks(layout).map((block) => block.id),
    ...layout.pages.map((p) => p.id),
  ]);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
};

export const findBlock = (layout: SheetLayout, id: string) =>
  allBlocks(layout).find((block) => block.id === id);

/** The group containing a block, if it is nested. */
export const parentGroup = (layout: SheetLayout, id: string): GroupBlock | undefined =>
  allBlocks(layout).find(
    (block): block is GroupBlock =>
      block.type === "group" && block.blocks.some((child) => child.id === id),
  );

const mapPages = (layout: SheetLayout, fn: (page: SheetPage) => SheetPage): SheetLayout => ({
  ...layout,
  pages: layout.pages.map(fn),
});

/** Apply `fn` to the block with `id`, wherever it lives. */
export const updateBlock = (
  layout: SheetLayout,
  id: string,
  fn: (block: LayoutBlock) => LayoutBlock,
): SheetLayout =>
  mapPages(layout, (page) => ({
    ...page,
    blocks: page.blocks.map((block) => {
      if (block.id === id) return fn(block);
      if (block.type !== "group") return block;
      return {
        ...block,
        blocks: block.blocks.map((child) => (child.id === id ? (fn(child) as LeafBlock) : child)),
      };
    }),
  }));

export const removeBlock = (layout: SheetLayout, id: string): SheetLayout =>
  mapPages(layout, (page) => ({
    ...page,
    blocks: page.blocks
      .filter((block) => block.id !== id)
      .map((block) =>
        block.type === "group"
          ? { ...block, blocks: block.blocks.filter((child) => child.id !== id) }
          : block,
      ),
  }));

const move = <T>(items: readonly T[], index: number, delta: number): T[] => {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

/** Move a block up (-1) or down (+1) among its siblings. */
export const moveBlock = (layout: SheetLayout, id: string, delta: -1 | 1): SheetLayout =>
  mapPages(layout, (page) => {
    const index = page.blocks.findIndex((block) => block.id === id);
    if (index >= 0) return { ...page, blocks: move(page.blocks, index, delta) };
    return {
      ...page,
      blocks: page.blocks.map((block) => {
        if (block.type !== "group") return block;
        const child = block.blocks.findIndex((item) => item.id === id);
        return child >= 0 ? { ...block, blocks: move(block.blocks, child, delta) } : block;
      }),
    };
  });

/** Dissolve a group, leaving its blocks where the group was. */
export const ungroupBlock = (layout: SheetLayout, id: string): SheetLayout =>
  mapPages(layout, (page) => ({
    ...page,
    blocks: page.blocks.flatMap((block): LayoutBlock[] =>
      block.id === id && block.type === "group" ? [...block.blocks] : [block],
    ),
  }));

/** Where a dragged block lands: a page, optionally a group on it, before a sibling or at the end. */
export type BlockDestination = { pageId: string; groupId?: string; beforeId?: string };

/**
 * Move a block anywhere: across pages, into or out of groups. Groups never nest,
 * so a group always lands at the top level. Unknown targets fall back to the end
 * of the page rather than dropping the block.
 */
export const moveBlockTo = (
  layout: SheetLayout,
  id: string,
  dest: BlockDestination,
): SheetLayout => {
  const block = findBlock(layout, id);
  const page = layout.pages.find((item) => item.id === dest.pageId);
  if (!block || !page || dest.beforeId === id || dest.groupId === id) return layout;
  const group =
    block.type === "group"
      ? undefined
      : page.blocks.find(
          (item): item is GroupBlock => item.id === dest.groupId && item.type === "group",
        );
  const place = <B extends LayoutBlock>(blocks: readonly B[], item: B): B[] => {
    const index = dest.beforeId ? blocks.findIndex((b) => b.id === dest.beforeId) : -1;
    return index < 0
      ? [...blocks, item]
      : [...blocks.slice(0, index), item, ...blocks.slice(index)];
  };
  return mapPages(removeBlock(layout, id), (item) => {
    if (item.id !== dest.pageId) return item;
    if (!group) return { ...item, blocks: place(item.blocks, block) };
    return {
      ...item,
      blocks: item.blocks.map((b) =>
        b.id === group.id && b.type === "group"
          ? { ...b, blocks: place(b.blocks, block as LeafBlock) }
          : b,
      ),
    };
  });
};

/** Append a block to a page, or into a group when `groupId` is given (groups hold leaves only). */
export const insertBlock = (
  layout: SheetLayout,
  pageId: string,
  block: LayoutBlock,
  groupId?: string,
): SheetLayout =>
  mapPages(layout, (page) => {
    if (page.id !== pageId) return page;
    if (groupId && block.type !== "group")
      return {
        ...page,
        blocks: page.blocks.map((item) =>
          item.id === groupId && item.type === "group"
            ? { ...item, blocks: [...item.blocks, block] }
            : item,
        ),
      };
    return { ...page, blocks: [...page.blocks, block] };
  });

/** Copy a block (and a group's children) with fresh ids, placed right after the original. */
export const duplicateBlock = (layout: SheetLayout, id: string): SheetLayout => {
  const original = findBlock(layout, id);
  if (!original) return layout;
  let working = layout;
  const reid = <B extends LayoutBlock>(block: B): B => {
    const copy = { ...block, id: freshId(working, block.id) };
    working = { ...working, pages: [...working.pages, { id: copy.id, title: "", blocks: [] }] };
    return copy.type === "group" ? ({ ...copy, blocks: copy.blocks.map(reid) } as B) : copy;
  };
  const copy = reid(original);
  const place = <B extends LayoutBlock>(blocks: readonly B[]): B[] =>
    blocks.flatMap((block) => (block.id === id ? [block, copy as B] : [block]));
  return mapPages(layout, (page) => ({
    ...page,
    blocks: place(page.blocks).map((block) =>
      block.type === "group" ? { ...block, blocks: place(block.blocks) } : block,
    ),
  }));
};

export const addPage = (layout: SheetLayout, title: string): SheetLayout => ({
  ...layout,
  pages: [...layout.pages, { id: freshId(layout, slugKey(title) || "page"), title, blocks: [] }],
});

export const renamePage = (layout: SheetLayout, pageId: string, title: string): SheetLayout =>
  mapPages(layout, (page) => (page.id === pageId ? { ...page, title } : page));

/** Remove a page; the last page stays so a layout is never empty. */
export const removePage = (layout: SheetLayout, pageId: string): SheetLayout =>
  layout.pages.length <= 1
    ? layout
    : { ...layout, pages: layout.pages.filter((page) => page.id !== pageId) };

export const blockTypes: { type: BlockType; label: string }[] = [
  { type: "heading", label: "Heading" },
  { type: "trackers", label: "Trackers" },
  { type: "stats", label: "Stats" },
  { type: "fields", label: "Fields" },
  { type: "list", label: "List" },
  { type: "checks", label: "Checkboxes" },
  { type: "text", label: "Text" },
  { type: "rolls", label: "Rolls" },
  { type: "entry", label: "Compendium entry" },
  { type: "group", label: "Group" },
];

/** A ready-to-edit block of each type, with an id and keys that don't clash. */
export const newBlock = (layout: SheetLayout, type: BlockType): LayoutBlock => {
  const id = freshId(layout, type);
  const key = freshId(layout, slugKey(`${type}_value`));
  switch (type) {
    case "heading":
      return { id, type, text: "Section" };
    case "trackers":
      return {
        id,
        type,
        items: [{ key: freshId(layout, "tracker"), label: "Tracker", min: 0, max: 6 }],
      };
    case "stats":
      return { id, type, items: [{ key: freshId(layout, "stat"), label: "Stat" }] };
    case "fields":
      return { id, type, columns: 2, items: [{ key: freshId(layout, "field"), label: "Field" }] };
    case "list":
      return {
        id,
        type,
        key,
        title: "List",
        columns: [
          { key: "name", label: "Name", kind: "text" },
          { key: "dice", label: "Dice", kind: "dice" },
        ],
      };
    case "checks":
      return { id, type, key, label: "Conditions", options: ["One", "Two"] };
    case "text":
      return { id, type, key, label: "Notes" };
    case "rolls":
      return { id, type, items: [{ label: "Roll", dice: "d20" }] };
    case "entry":
      return { id, type, key, entryType: "", label: "Entry" };
    case "group":
      return { id, type, title: "Group", blocks: [] };
  }
};

/** Every value key a layout reads (fields, stats, lists, checks, text, trackers). */
export const layoutKeys = (layout: SheetLayout): string[] =>
  allBlocks(layout).flatMap((block) => {
    switch (block.type) {
      case "trackers":
      case "stats":
      case "fields":
        return block.items.map((item) => item.key);
      case "list":
      case "checks":
      case "text":
      case "entry":
        return [block.key];
      default:
        return [];
    }
  });
