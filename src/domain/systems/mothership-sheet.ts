import type { SheetLayout } from "../sheet-layout";

/*
 * Mothership on generic blocks — structure only, no rules text. Stats and
 * saves roll the d100 the player reads against them (with a skill's bonus);
 * [+] and [-] roll two and keep one. Whether a roll passes, and what a panic
 * does, is the table's call.
 */

export const mothership: SheetLayout = {
  system: "Mothership",
  name: "Classic",
  pages: [
    {
      id: "sheet",
      title: "Character",
      blocks: [
        {
          id: "class",
          type: "entry",
          key: "class",
          entryType: "class",
          label: "Class",
          variant: "line",
        },
        {
          id: "stats",
          type: "stats",
          variant: "bars",
          span: 3,
          items: [
            { key: "str", label: "Strength", max: 100, roll: "1d100" },
            { key: "spd", label: "Speed", max: 100, roll: "1d100" },
            { key: "int", label: "Intellect", max: 100, roll: "1d100" },
            { key: "com", label: "Combat", max: 100, roll: "1d100" },
          ],
        },
        {
          id: "saves",
          type: "stats",
          variant: "bars",
          span: 3,
          items: [
            { key: "san", label: "Sanity", max: 100, roll: "1d100" },
            { key: "fear", label: "Fear", max: 100, roll: "1d100" },
            { key: "body", label: "Body", max: 100, roll: "1d100" },
          ],
        },
        {
          id: "vitals",
          type: "trackers",
          wide: 3,
          items: [
            { key: "hp", label: "Health", min: 0, max: 10 },
            { key: "wounds", label: "Wounds", min: 0, max: 3, start: 0 },
            { key: "stress", label: "Stress", min: 2, max: 20, start: 2, display: "number" },
          ],
        },
        {
          id: "checks",
          type: "group",
          wide: 3,
          blocks: [
            {
              id: "armor",
              type: "stats",
              items: [{ key: "ap", label: "Armor" }],
            },
            {
              id: "rolls",
              type: "rolls",
              items: [
                { label: "Advantage [+]", dice: "2d100kl1" },
                { label: "Disadvantage [-]", dice: "2d100kh1" },
                { label: "Panic", dice: "1d20" },
              ],
            },
            {
              id: "conditions",
              type: "checks",
              key: "conditions",
              label: "Conditions",
              options: ["Bleeding", "Frightened", "Irradiated", "Stunned"],
            },
          ],
        },
        {
          id: "skills",
          type: "list",
          key: "skills",
          title: "Skills",
          source: { entryType: "skill" },
          columns: [
            { key: "name", label: "Skill", kind: "text" },
            {
              key: "tier",
              label: "Tier",
              kind: "select",
              options: ["Trained", "Expert", "Master"],
            },
            { key: "bonus", label: "Bonus", kind: "number" },
          ],
        },
      ],
    },
    {
      id: "loadout",
      title: "Loadout",
      blocks: [
        {
          id: "weapons",
          type: "list",
          key: "weapons",
          source: { entryType: "weapon" },
          title: "Weapons",
          variant: "cards",
          wide: 3,
          columns: [
            { key: "name", label: "Weapon", kind: "text" },
            { key: "dmg", label: "Dmg", kind: "dice" },
            { key: "shots", label: "Shots", kind: "number" },
          ],
        },
        {
          id: "gear",
          type: "list",
          key: "gear",
          source: { entryType: "item" },
          title: "Gear",
          wide: 3,
          columns: [
            { key: "name", label: "Item", kind: "text" },
            { key: "notes", label: "Notes", kind: "text" },
          ],
          slots: 6,
        },
        {
          id: "credits",
          type: "fields",
          columns: 2,
          items: [
            { key: "credits", label: "Credits" },
            { key: "trinket", label: "Trinket" },
            { key: "patch", label: "Patch" },
          ],
        },
        { id: "notes", type: "text", key: "notes", label: "Notes" },
      ],
    },
  ],
};
