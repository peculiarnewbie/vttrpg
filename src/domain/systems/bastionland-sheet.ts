import type { SheetBuilder, SheetLayout } from "../sheet-layout";

/*
 * Mythic Bastionland on generic blocks — structure only, no rules text. A
 * Knight's Virtues are trackers that roll the d20 save; Property holds weapon
 * dice; a linked Knight shows its Ability and offers its starting Property.
 * Whether a save passes is the table's call.
 */

export const bastionProperty = {
  id: "property",
  type: "list",
  key: "property",
  title: "Property",
  columns: [
    { key: "item", label: "Item", kind: "text" },
    { key: "dmg", label: "Dmg", kind: "dice" },
    { key: "tags", label: "Tags", kind: "tags" },
  ],
  slots: 6,
} as const;

const bastionBonds = {
  id: "bonds",
  type: "fields",
  columns: 2,
  items: [
    { key: "seer", label: "Seer" },
    { key: "passion", label: "Passion" },
    { key: "ambition", label: "Ambition" },
    { key: "oath", label: "Oath" },
  ],
} as const;

const bastionKnight = {
  id: "knight-entry",
  type: "entry",
  key: "knight",
  entryType: "knight",
  label: "Knight",
  show: ["ability"],
  fill: [{ from: "property", to: "property" }],
} as const;

/*
 * One builder for both layouts, using only blocks they share (virtues, guard,
 * standing, property, knight-entry, bonds, fatigue). Steps defer to the book —
 * the builder only picks the Knight, offers its Property, rolls dice to chat,
 * and shows the same blocks the sheet edits.
 */
export const bastionlandBuilder: SheetBuilder = {
  steps: [
    {
      id: "knight",
      title: "Knight",
      hint: "Choose your Knight from the list. Accept the offer to copy its Property onto the sheet.",
      parts: [{ type: "choose", key: "knight" }],
    },
    {
      id: "virtues",
      title: "Virtues & Guard",
      hint: "Follow your book's steps for each value, then write it in.",
      parts: [
        {
          type: "rolls",
          items: [
            { label: "d6", dice: "1d6" },
            { label: "d20", dice: "1d20" },
          ],
        },
        { type: "blocks", blocks: ["virtues", "guard"] },
      ],
    },
    {
      id: "bonds",
      title: "Bonds & Standing",
      hint: "Follow your book for the rest, then write each in.",
      parts: [{ type: "blocks", blocks: ["bonds", "standing"] }],
    },
    {
      id: "review",
      title: "Review",
      hint: "Look over the sheet and fill in anything left.",
      parts: [{ type: "blocks", blocks: ["property", "fatigue"] }],
    },
  ],
};

export const bastionlandClassic: SheetLayout = {
  system: "Mythic Bastionland",
  name: "Classic",
  builder: bastionlandBuilder,
  pages: [
    {
      id: "knight",
      title: "Knight",
      blocks: [
        {
          id: "virtues",
          type: "trackers",
          variant: "boxes",
          wide: 4,
          items: [
            {
              key: "vig",
              label: "Vigour",
              short: "VIG",
              min: 0,
              max: 18,
              display: "number",
              roll: "1d20",
            },
            {
              key: "cla",
              label: "Clarity",
              short: "CLA",
              min: 0,
              max: 18,
              display: "number",
              roll: "1d20",
            },
            {
              key: "spi",
              label: "Spirit",
              short: "SPI",
              min: 0,
              max: 18,
              display: "number",
              roll: "1d20",
            },
          ],
        },
        {
          id: "defence",
          type: "group",
          wide: 2,
          blocks: [
            {
              id: "guard",
              type: "trackers",
              items: [
                { key: "gd", label: "Guard", short: "GD", min: 0, max: 6 },
                { key: "glory", label: "Glory", min: 0, max: 12, start: 0 },
              ],
            },
            {
              id: "standing",
              type: "stats",
              items: [
                { key: "armour", label: "Armour", max: 3 },
                { key: "rank", label: "Rank" },
                { key: "age", label: "Age" },
              ],
            },
          ],
        },
        { ...bastionProperty, wide: 3 },
        {
          id: "knight",
          type: "group",
          title: "The Knight",
          wide: 3,
          blocks: [
            bastionKnight,
            bastionBonds,
            // Typed by hand until a Knight is linked, which then shows its own Ability.
            {
              id: "ability",
              type: "text",
              key: "ability",
              label: "Ability",
              when: { key: "knight", is: "empty" },
            },
          ],
        },
        {
          id: "scars",
          type: "list",
          key: "scars",
          title: "Scars",
          span: 3,
          columns: [{ key: "scar", label: "Scar", kind: "text" }],
        },
        {
          id: "fatigue",
          type: "checks",
          key: "fatigue",
          label: "Fatigue",
          span: 3,
          options: ["Hungry", "Exhausted", "Wounded", "Mortal"],
        },
        { id: "saves", type: "rolls", items: [{ label: "Save", dice: "d20" }] },
      ],
    },
  ],
};

/** Same knight, tighter: Virtues as bars, Property as numbered slots, everything half-width. */
export const bastionlandCompact: SheetLayout = {
  system: "Mythic Bastionland",
  name: "Compact",
  builder: bastionlandBuilder,
  pages: [
    {
      id: "knight",
      title: "Knight",
      blocks: [
        {
          id: "virtues",
          type: "trackers",
          span: 4,
          wide: 2,
          items: [
            {
              key: "vig",
              label: "Vigour",
              short: "VIG",
              min: 0,
              max: 18,
              display: "bar",
              roll: "1d20",
            },
            {
              key: "cla",
              label: "Clarity",
              short: "CLA",
              min: 0,
              max: 18,
              display: "bar",
              roll: "1d20",
            },
            {
              key: "spi",
              label: "Spirit",
              short: "SPI",
              min: 0,
              max: 18,
              display: "bar",
              roll: "1d20",
            },
          ],
        },
        {
          id: "standing",
          type: "stats",
          variant: "list",
          span: 2,
          wide: 1,
          items: [
            { key: "armour", label: "Armour", max: 3 },
            { key: "rank", label: "Rank" },
            { key: "age", label: "Age" },
          ],
        },
        {
          id: "guard",
          type: "trackers",
          wide: 3,
          items: [
            { key: "gd", label: "Guard", short: "GD", min: 0, max: 6 },
            { key: "glory", label: "Glory", min: 0, max: 12, start: 0 },
          ],
        },
        { ...bastionProperty, variant: "slots", span: 6, wide: 3 },
        { ...bastionBonds, variant: "inline", span: 6, wide: 3 },
        { ...bastionKnight, span: 6, wide: 3 },
        {
          id: "fatigue",
          type: "checks",
          key: "fatigue",
          variant: "tags",
          label: "Fatigue",
          span: 3,
          options: ["Hungry", "Exhausted", "Wounded", "Mortal"],
        },
        { id: "saves", type: "rolls", span: 3, items: [{ label: "Save", dice: "d20" }] },
      ],
    },
  ],
};
