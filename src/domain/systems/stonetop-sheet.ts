import type { SheetBuilder, SheetLayout } from "../sheet-layout";

/*
 * Stonetop on generic blocks — structure only, no rules text. Each stat rolls
 * 2d6 plus itself; advantage and disadvantage roll 3d6 and keep two. A linked
 * playbook shows its damage die as a roll. The steading is a shared sheet the
 * whole table keeps. What a 10+ or a 6- means is the table's call.
 */

const stat = (key: string, label: string) => ({ key, label, roll: `2d6 + @${key}` });

/*
 * The character builder walks the same character step by step: pick the
 * playbook, describe who you are, write in stats, add its moves, then gear
 * and people. Rolls go to chat only; hints defer to the book, never restate it.
 */
export const stonetopBuilder: SheetBuilder = {
  steps: [
    {
      id: "playbook",
      title: "Playbook",
      hint: "Pick the playbook you chose from your book.",
      parts: [{ type: "choose", key: "playbook" }],
    },
    {
      id: "who",
      title: "Who you are",
      hint: "Write in your origin, background and the rest from your playbook.",
      parts: [{ type: "blocks", blocks: ["about"] }],
    },
    {
      id: "stats",
      title: "Stats",
      hint: "Set your stats as your book says. The dice here only post to chat.",
      parts: [{ type: "blocks", blocks: ["stats", "rolls"] }],
    },
    {
      id: "moves",
      title: "Moves",
      hint: "Add the moves you chose from your book.",
      parts: [{ type: "choose", key: "moves", from: { entry: "playbook", field: "moves" } }],
    },
    {
      id: "gear",
      title: "Gear",
      hint: "Write in your outfit and small items from your playbook.",
      parts: [{ type: "blocks", blocks: ["load", "inventory", "small"] }],
    },
    {
      id: "people",
      title: "People",
      hint: "Write in your connections and any followers.",
      parts: [{ type: "blocks", blocks: ["connections", "followers", "notes"] }],
    },
  ],
};

export const stonetopCharacter: SheetLayout = {
  system: "Stonetop",
  name: "Character",
  builder: stonetopBuilder,
  pages: [
    {
      id: "character",
      title: "Character",
      blocks: [
        {
          id: "playbook",
          type: "entry",
          key: "playbook",
          entryType: "playbook",
          label: "Playbook",
          show: ["damage"],
        },
        {
          id: "about",
          type: "fields",
          variant: "inline",
          columns: 2,
          items: [
            { key: "origin", label: "Origin" },
            { key: "background", label: "Background" },
            { key: "instinct", label: "Instinct" },
            { key: "appearance", label: "Appearance" },
          ],
        },
        {
          id: "stats",
          type: "stats",
          variant: "boxes",
          items: [
            stat("str", "STR"),
            stat("dex", "DEX"),
            stat("int", "INT"),
            stat("wis", "WIS"),
            stat("con", "CON"),
            stat("cha", "CHA"),
          ],
        },
        {
          id: "debilities",
          type: "checks",
          key: "debilities",
          label: "Debilities",
          variant: "tags",
          options: ["Weakened", "Dazed", "Miserable"],
        },
        {
          id: "condition",
          type: "trackers",
          span: 3,
          items: [
            { key: "hp", label: "HP", min: 0, max: 30, display: "number" },
            { key: "xp", label: "XP", min: 0, max: 20, start: 0, display: "number" },
          ],
        },
        {
          id: "numbers",
          type: "stats",
          span: 3,
          items: [
            { key: "armor", label: "Armor" },
            { key: "level", label: "Level" },
          ],
        },
        {
          id: "rolls",
          type: "rolls",
          items: [
            { label: "Roll", dice: "2d6" },
            { label: "Advantage", dice: "3d6kh2" },
            { label: "Disadvantage", dice: "3d6kl2" },
          ],
        },
      ],
    },
    {
      id: "moves",
      title: "Moves & arcana",
      blocks: [
        {
          id: "move-list",
          type: "list",
          key: "moves",
          title: "Moves",
          source: { entryType: "move" },
          columns: [
            { key: "name", label: "Move", kind: "text" },
            { key: "stat", label: "Rolls", kind: "text" },
            { key: "hold", label: "Hold", kind: "number" },
          ],
        },
        {
          id: "arcana",
          type: "list",
          key: "arcana",
          title: "Arcana",
          source: { entryType: "arcanum" },
          columns: [
            { key: "name", label: "Arcanum", kind: "text" },
            { key: "uses", label: "Uses", kind: "text" },
          ],
        },
      ],
    },
    {
      id: "gear",
      title: "Gear",
      blocks: [
        {
          id: "load",
          type: "checks",
          key: "load",
          label: "Load",
          variant: "tags",
          options: ["Light", "Normal", "Heavy"],
        },
        {
          id: "inventory",
          type: "list",
          key: "inventory",
          title: "Outfit",
          columns: [
            { key: "name", label: "Item", kind: "text" },
            { key: "weight", label: "◇", kind: "number" },
            { key: "uses", label: "Uses", kind: "text" },
          ],
        },
        {
          id: "small",
          type: "list",
          key: "small_items",
          title: "Small items",
          columns: [
            { key: "name", label: "Item", kind: "text" },
            { key: "uses", label: "Uses", kind: "text" },
          ],
        },
      ],
    },
    {
      id: "people",
      title: "People",
      blocks: [
        {
          id: "connections",
          type: "list",
          key: "connections",
          title: "Connections",
          columns: [
            { key: "name", label: "Who", kind: "text" },
            { key: "bond", label: "Bond", kind: "text" },
          ],
        },
        {
          id: "followers",
          type: "list",
          key: "followers",
          title: "Followers",
          variant: "cards",
          columns: [
            { key: "name", label: "Follower", kind: "text" },
            { key: "hp", label: "HP", kind: "number" },
            { key: "armor", label: "Armor", kind: "number" },
            { key: "damage", label: "Damage", kind: "dice" },
            { key: "loyalty", label: "Loyalty", kind: "number" },
            { key: "tags", label: "Tags", kind: "tags" },
          ],
        },
        { id: "notes", type: "text", key: "notes", label: "Notes" },
      ],
    },
  ],
};

export const stonetopSteading: SheetLayout = {
  subject: "shared",
  system: "Stonetop",
  name: "Steading",
  pages: [
    {
      id: "steading",
      title: "Steading",
      blocks: [
        {
          id: "size",
          type: "checks",
          key: "size",
          label: "Size",
          variant: "tags",
          options: ["Hamlet", "Village", "Town", "City"],
        },
        {
          id: "stats",
          type: "stats",
          items: [
            { key: "fortunes", label: "Fortunes", roll: "2d6 + @fortunes" },
            { key: "surplus", label: "Surplus" },
            { key: "prosperity", label: "Prosperity" },
            { key: "population", label: "Population" },
            { key: "defenses", label: "Defenses" },
          ],
        },
        {
          id: "debilities",
          type: "checks",
          key: "debilities",
          label: "Debilities",
          variant: "tags",
          options: ["Diminished", "Lacking", "Malcontent"],
        },
        {
          id: "improvements",
          type: "list",
          key: "improvements",
          title: "Improvements",
          source: { entryType: "improvement" },
          columns: [
            { key: "name", label: "Improvement", kind: "text" },
            { key: "done", label: "Done", kind: "check" },
          ],
        },
        {
          id: "resources",
          type: "list",
          key: "resources",
          title: "Resources",
          span: 3,
          columns: [{ key: "name", label: "Resource", kind: "text" }],
        },
        {
          id: "fortifications",
          type: "list",
          key: "fortifications",
          title: "Fortifications",
          span: 3,
          columns: [{ key: "name", label: "Fortification", kind: "text" }],
        },
        {
          id: "assets",
          type: "list",
          key: "assets",
          title: "Assets",
          columns: [
            { key: "name", label: "Asset", kind: "text" },
            { key: "notes", label: "Notes", kind: "text" },
          ],
        },
        {
          id: "residents",
          type: "list",
          key: "residents",
          title: "Residents",
          columns: [
            { key: "name", label: "Name", kind: "text" },
            { key: "occupation", label: "Occupation", kind: "text" },
            { key: "traits", label: "Traits & relations", kind: "text" },
          ],
        },
        {
          id: "neighbors",
          type: "list",
          key: "neighbors",
          title: "Neighbors",
          columns: [
            { key: "name", label: "Name", kind: "text" },
            { key: "home", label: "Home", kind: "text" },
            { key: "occupation", label: "Occupation", kind: "text" },
            { key: "traits", label: "Traits & relations", kind: "text" },
          ],
        },
        { id: "notes", type: "text", key: "notes", label: "Notes" },
      ],
    },
  ],
};
