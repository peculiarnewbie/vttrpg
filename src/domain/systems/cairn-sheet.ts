import type { SheetBuilder, SheetLayout } from "../sheet-layout";

/*
 * A Cairn 2e character on generic blocks: attributes as current/maximum
 * trackers that roll the d20 save, ten inventory slots where bulky items take
 * two, and the background linked from the library. Whether a save succeeds is
 * the table's call.
 */

/*
 * The builder over the same values: pick a background, roll its tables into
 * chat and write down what to keep, roll attributes and HP into chat and
 * write them in, then take gear from the compendium. Rolls never write to
 * the character; only picks and typed values do.
 */
export const cairnBuilder: SheetBuilder = {
  steps: [
    {
      id: "background",
      title: "Background",
      hint: "Pick the background you want; it stays linked on your sheet.",
      parts: [{ type: "choose", key: "background" }],
    },
    {
      id: "name",
      title: "Name & tables",
      hint: "Roll on your background's tables, then write what you keep below.",
      parts: [
        { type: "tables", from: { entry: "background", field: "tables" } },
        { type: "blocks", blocks: ["bonds", "notes"] },
      ],
    },
    {
      id: "attributes",
      title: "Attributes",
      hint: "Roll 3d6 for each attribute and 1d6 for HP. Set each result as both its current value and its maximum, then add age and gold.",
      parts: [
        {
          type: "rolls",
          items: [
            { label: "STR", dice: "3d6" },
            { label: "DEX", dice: "3d6" },
            { label: "WIL", dice: "3d6" },
            { label: "HP", dice: "1d6" },
          ],
        },
        { type: "blocks", blocks: ["attributes", "condition", "numbers"] },
      ],
    },
    {
      id: "gear",
      title: "Gear",
      hint: "Add what you carry from the compendium, then adjust the list.",
      parts: [
        { type: "choose", key: "inventory" },
        { type: "blocks", blocks: ["inventory"] },
      ],
    },
  ],
};

export const cairnCharacter: SheetLayout = {
  system: "Cairn (2nd edition)",
  name: "Character",
  builder: cairnBuilder,
  pages: [
    {
      id: "character",
      title: "Character",
      blocks: [
        {
          id: "background",
          type: "entry",
          key: "background",
          entryType: "background",
          label: "Background",
          variant: "line",
        },
        {
          id: "attributes",
          type: "trackers",
          span: 3,
          items: [
            { key: "str", label: "STR", min: 0, max: 18, roll: "1d20" },
            { key: "dex", label: "DEX", min: 0, max: 18, roll: "1d20" },
            { key: "wil", label: "WIL", min: 0, max: 18, roll: "1d20" },
          ],
        },
        {
          id: "condition",
          type: "trackers",
          span: 3,
          items: [{ key: "hp", label: "HP", min: 0, max: 6 }],
        },
        {
          id: "numbers",
          type: "stats",
          span: 3,
          items: [
            { key: "armor", label: "Armor" },
            { key: "gold", label: "Gold" },
            { key: "age", label: "Age" },
          ],
        },
        {
          id: "deprived",
          type: "checks",
          key: "deprived",
          label: "Status",
          variant: "tags",
          options: ["Deprived"],
          span: 3,
        },
        {
          id: "inventory",
          type: "list",
          key: "inventory",
          title: "Inventory",
          variant: "slots",
          slots: 10,
          slotSize: "slots",
          source: { entryType: "item" },
          columns: [
            { key: "name", label: "Item", kind: "text" },
            { key: "damage", label: "Damage", kind: "dice" },
            { key: "uses", label: "Uses", kind: "text" },
            { key: "slots", label: "Slots", kind: "number" },
          ],
        },
        {
          id: "rolls",
          type: "rolls",
          items: [
            { label: "d20", dice: "1d20" },
            { label: "d6", dice: "1d6" },
            { label: "Impaired", dice: "1d4" },
          ],
        },
        { id: "bonds", type: "text", key: "bonds", label: "Bonds & omens" },
        { id: "notes", type: "text", key: "notes", label: "Notes" },
      ],
    },
  ],
};
