import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  addPage,
  allBlocks,
  blockTypes,
  duplicateBlock,
  derivedKeys,
  findBlock,
  insertBlock,
  layoutKeys,
  moveBlock,
  moveBlockTo,
  newBlock,
  parentGroup,
  removeBlock,
  removePage,
  ungroupBlock,
  updateBlock,
} from "./layout-edit";
import { SheetLayout } from "./sheet-layout";
import { bastionlandClassic, bladesInTheDark } from "./sheet-presets";
import { layoutLimitsError } from "./template-io";

const ids = (layout: SheetLayout) => layout.pages[0].blocks.map((block) => block.id);

describe("layout edits", () => {
  it("moves top-level blocks and group children among their siblings", () => {
    const moved = moveBlock(bastionlandClassic, "defence", -1);
    expect(ids(moved).slice(0, 2)).toEqual(["defence", "virtues"]);
    expect(moveBlock(bastionlandClassic, "virtues", -1)).toEqual(bastionlandClassic);
    const inGroup = moveBlock(bastionlandClassic, "standing", -1);
    expect(parentGroup(inGroup, "standing")?.blocks.map((b) => b.id)).toEqual([
      "standing",
      "guard",
    ]);
  });

  it("drops blocks before siblings, into and out of groups, and onto other pages", () => {
    const page = "knight";
    const before = moveBlockTo(bastionlandClassic, "property", {
      pageId: page,
      beforeId: "virtues",
    });
    expect(ids(before)[0]).toBe("property");
    const into = moveBlockTo(bastionlandClassic, "property", {
      pageId: page,
      groupId: "defence",
      beforeId: "guard",
    });
    expect(parentGroup(into, "property")?.blocks.map((b) => b.id)).toEqual([
      "property",
      "guard",
      "standing",
    ]);
    const out = moveBlockTo(into, "guard", { pageId: page });
    expect(ids(out).at(-1)).toBe("guard");
    expect(parentGroup(out, "guard")).toBeUndefined();
    const paged = addPage(bastionlandClassic, "Gear");
    const moved = moveBlockTo(paged, "property", { pageId: paged.pages[1].id });
    expect(moved.pages[1].blocks.map((b) => b.id)).toEqual(["property"]);
    expect(findBlock(moved, "property")).toBeDefined();
    expect(allBlocks(moved)).toHaveLength(allBlocks(paged).length);
  });

  it("keeps groups top-level and ignores drops onto the block itself", () => {
    const layout = moveBlockTo(bladesInTheDark, "insight", {
      pageId: bladesInTheDark.pages[0].id,
      groupId: "prowess",
    });
    expect(parentGroup(layout, "insight")).toBeUndefined();
    expect(ids(layout).at(-1)).toBe("insight");
    expect(
      moveBlockTo(bastionlandClassic, "virtues", { pageId: "knight", beforeId: "virtues" }),
    ).toBe(bastionlandClassic);
    expect(moveBlockTo(bastionlandClassic, "virtues", { pageId: "nope" })).toBe(bastionlandClassic);
  });

  it("updates and removes blocks wherever they live", () => {
    const renamed = updateBlock(bastionlandClassic, "guard", (block) =>
      block.type === "trackers" ? { ...block, variant: "boxes" } : block,
    );
    expect(findBlock(renamed, "guard")).toMatchObject({ variant: "boxes" });
    const removed = removeBlock(bastionlandClassic, "guard");
    expect(findBlock(removed, "guard")).toBeUndefined();
    expect(findBlock(removed, "standing")).toBeDefined();
  });

  it("inserts new blocks with unique ids, into pages or groups", () => {
    let layout = bastionlandClassic;
    for (const { type } of blockTypes) {
      layout = insertBlock(layout, "knight", newBlock(layout, type));
    }
    const heading = newBlock(layout, "heading");
    layout = insertBlock(layout, "knight", heading, "defence");
    expect(parentGroup(layout, heading.id)?.id).toBe("defence");
    const all = allBlocks(layout).map((block) => block.id);
    expect(new Set(all).size).toBe(all.length);
    expect(Schema.decodeUnknownResult(SheetLayout)(layout)._tag).toBe("Success");
    expect(layoutLimitsError(layout)).toBeUndefined();
  });

  it("ungroups in place, keeping the group's blocks in order", () => {
    const layout = ungroupBlock(bastionlandClassic, "defence");
    expect(ids(layout).slice(0, 4)).toEqual(["virtues", "guard", "standing", "property"]);
    expect(findBlock(layout, "defence")).toBeUndefined();
    expect(allBlocks(layout)).toHaveLength(allBlocks(bastionlandClassic).length - 1);
    expect(ungroupBlock(bastionlandClassic, "guard")).toEqual(bastionlandClassic);
  });

  it("never nests groups", () => {
    const group = newBlock(bastionlandClassic, "group");
    const layout = insertBlock(bastionlandClassic, "knight", group, "defence");
    expect(parentGroup(layout, group.id)).toBeUndefined();
    expect(ids(layout)).toContain(group.id);
  });

  it("duplicates a group with fresh ids for it and its children", () => {
    const layout = duplicateBlock(bladesInTheDark, "insight");
    const index = ids(layout).indexOf("insight");
    const copy = layout.pages[0].blocks[index + 1];
    expect(copy.type).toBe("group");
    expect(copy.id).not.toBe("insight");
    const all = allBlocks(layout).map((block) => block.id);
    expect(new Set(all).size).toBe(all.length);
    expect(layout.pages).toHaveLength(1);
  });

  it("adds and removes pages but keeps at least one", () => {
    const two = addPage(bastionlandClassic, "Gear");
    expect(two.pages.map((page) => page.title)).toEqual(["Knight", "Gear"]);
    const one = removePage(two, two.pages[1].id);
    expect(removePage(one, one.pages[0].id).pages).toHaveLength(1);
  });

  it("lists the value keys a layout reads", () => {
    expect(layoutKeys(bastionlandClassic)).toEqual(
      expect.arrayContaining(["vig", "gd", "armour", "property", "seer", "ability", "fatigue"]),
    );
  });

  it("lists derived keys separately from stored visibility-condition keys", () => {
    const layout = {
      ...bastionlandClassic,
      derived: [{ key: "vig_mod", label: "Vigour mod", expr: "@vig - 10" }],
    };
    expect(derivedKeys(layout)).toEqual(["vig_mod"]);
    expect(layoutKeys(layout)).not.toContain("vig_mod");
    expect(derivedKeys(bastionlandClassic)).toEqual([]);
  });
});
