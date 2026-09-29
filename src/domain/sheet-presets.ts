import type { SheetLayout } from "./sheet-layout";

/*
 * Starting layouts for a few systems, built only from generic blocks. They double
 * as the proof that the block set is expressive enough (see /lab/systems).
 */

export const mythicBastionland: SheetLayout = {
  system: "Mythic Bastionland",
  pages: [
    {
      id: "knight",
      title: "Knight",
      blocks: [
        {
          id: "virtues",
          type: "trackers",
          arrange: "row",
          items: [
            { key: "vig", label: "Vigour", short: "VIG", min: 0, max: 18, display: "number" },
            { key: "cla", label: "Clarity", short: "CLA", min: 0, max: 18, display: "number" },
            { key: "spi", label: "Spirit", short: "SPI", min: 0, max: 18, display: "number" },
          ],
        },
        {
          id: "guard",
          type: "trackers",
          arrange: "column",
          items: [
            { key: "gd", label: "Guard", short: "GD", min: 0, max: 6 },
            { key: "glory", label: "Glory", min: 0, max: 12 },
          ],
        },
        {
          id: "defence",
          type: "stats",
          items: [
            { key: "armour", label: "Armour" },
            { key: "rank", label: "Rank" },
            { key: "age", label: "Age" },
          ],
        },
        { id: "h-property", type: "heading", text: "Property" },
        {
          id: "property",
          type: "list",
          key: "property",
          columns: [
            { key: "item", label: "Item", kind: "text" },
            { key: "dmg", label: "Dmg", kind: "dice" },
            { key: "tags", label: "Tags", kind: "tags" },
          ],
          slots: 6,
        },
        { id: "h-knight", type: "heading", text: "The Knight" },
        {
          id: "bonds",
          type: "fields",
          columns: 2,
          items: [
            { key: "seer", label: "Seer" },
            { key: "passion", label: "Passion" },
            { key: "ambition", label: "Ambition" },
            { key: "oath", label: "Oath" },
          ],
        },
        { id: "ability", type: "text", key: "ability", label: "Ability" },
        {
          id: "scars",
          type: "list",
          key: "scars",
          title: "Scars",
          width: "half",
          columns: [{ key: "scar", label: "Scar", kind: "text" }],
        },
        {
          id: "fatigue",
          type: "checks",
          key: "fatigue",
          label: "Fatigue",
          width: "half",
          options: ["Hungry", "Exhausted", "Wounded", "Mortal"],
        },
        { id: "saves", type: "rolls", items: [{ label: "Save", dice: "d20" }] },
      ],
    },
  ],
};

export const mothership: SheetLayout = {
  system: "Mothership",
  pages: [
    {
      id: "sheet",
      title: "Character",
      blocks: [
        {
          id: "stats",
          type: "stats",
          items: [
            { key: "str", label: "Strength" },
            { key: "spd", label: "Speed" },
            { key: "int", label: "Intellect" },
            { key: "com", label: "Combat" },
          ],
        },
        {
          id: "saves",
          type: "stats",
          items: [
            { key: "san", label: "Sanity" },
            { key: "fear", label: "Fear" },
            { key: "body", label: "Body" },
          ],
        },
        {
          id: "vitals",
          type: "trackers",
          arrange: "column",
          items: [
            { key: "hp", label: "Health", min: 0, max: 10 },
            { key: "wounds", label: "Wounds", min: 0, max: 3 },
            { key: "stress", label: "Stress", min: 2, max: 20, display: "number" },
          ],
        },
        {
          id: "rolls",
          type: "rolls",
          items: [
            { label: "Stat check", dice: "d100" },
            { label: "Panic", dice: "d20" },
          ],
        },
        {
          id: "conditions",
          type: "checks",
          key: "conditions",
          label: "Conditions",
          options: ["Bleeding", "Frightened", "Irradiated", "Stunned"],
        },
        { id: "h-skills", type: "heading", text: "Skills" },
        {
          id: "skills",
          type: "list",
          key: "skills",
          columns: [
            { key: "skill", label: "Skill", kind: "text" },
            { key: "tier", label: "Tier", kind: "tags" },
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
          title: "Weapons",
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
          title: "Gear",
          columns: [
            { key: "item", label: "Item", kind: "text" },
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
          ],
        },
      ],
    },
  ],
};

export const bladesInTheDark: SheetLayout = {
  system: "Blades in the Dark",
  pages: [
    {
      id: "scoundrel",
      title: "Scoundrel",
      blocks: [
        {
          id: "who",
          type: "fields",
          columns: 2,
          items: [
            { key: "playbook", label: "Playbook" },
            { key: "heritage", label: "Heritage" },
            { key: "vice", label: "Vice" },
            { key: "look", label: "Look" },
          ],
        },
        {
          id: "stress",
          type: "trackers",
          arrange: "column",
          items: [{ key: "stress", label: "Stress", min: 0, max: 9 }],
        },
        {
          id: "trauma",
          type: "checks",
          key: "trauma",
          label: "Trauma",
          options: [
            "Cold",
            "Haunted",
            "Obsessed",
            "Paranoid",
            "Reckless",
            "Soft",
            "Unstable",
            "Vicious",
          ],
        },
        {
          id: "harm",
          type: "list",
          key: "harm",
          title: "Harm",
          columns: [
            { key: "level", label: "Lvl", kind: "number" },
            { key: "harm", label: "Harm", kind: "text" },
          ],
          slots: 3,
        },
        {
          id: "clocks",
          type: "trackers",
          arrange: "row",
          items: [
            { key: "healing", label: "Healing", min: 0, max: 4, display: "clock" },
            { key: "vendetta", label: "Vendetta", min: 0, max: 8, display: "clock" },
          ],
        },
        { id: "h-insight", type: "heading", text: "Insight" },
        {
          id: "insight",
          type: "trackers",
          arrange: "column",
          width: "half",
          items: [
            { key: "hunt", label: "Hunt", min: 0, max: 4 },
            { key: "study", label: "Study", min: 0, max: 4 },
            { key: "survey", label: "Survey", min: 0, max: 4 },
            { key: "tinker", label: "Tinker", min: 0, max: 4 },
          ],
        },
        {
          id: "prowess",
          type: "trackers",
          arrange: "column",
          width: "half",
          items: [
            { key: "finesse", label: "Finesse", min: 0, max: 4 },
            { key: "prowl", label: "Prowl", min: 0, max: 4 },
            { key: "skirmish", label: "Skirmish", min: 0, max: 4 },
            { key: "wreck", label: "Wreck", min: 0, max: 4 },
          ],
        },
        {
          id: "load",
          type: "list",
          key: "items",
          title: "Load",
          columns: [
            { key: "carried", label: "", kind: "check" },
            { key: "item", label: "Item", kind: "text" },
            { key: "load", label: "Load", kind: "number" },
          ],
        },
        {
          id: "roll",
          type: "rolls",
          items: [
            { label: "Action (2d6)", dice: "2d6" },
            { label: "Resist (1d6)", dice: "1d6" },
          ],
        },
      ],
    },
  ],
};

export const presets = [mythicBastionland, mothership, bladesInTheDark];
