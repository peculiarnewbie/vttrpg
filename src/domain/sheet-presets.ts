import type { SheetLayout } from "./sheet-layout";

/*
 * Premade layouts, built only from generic blocks. A system can ship several
 * arrangements of the same values (Classic, Compact…); they double as the proof
 * that the block set is expressive enough (see /lab/systems).
 */

const bastionProperty = {
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

export const bastionlandClassic: SheetLayout = {
  system: "Mythic Bastionland",
  name: "Classic",
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
            { key: "vig", label: "Vigour", short: "VIG", min: 0, max: 18, display: "number" },
            { key: "cla", label: "Clarity", short: "CLA", min: 0, max: 18, display: "number" },
            { key: "spi", label: "Spirit", short: "SPI", min: 0, max: 18, display: "number" },
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
            { id: "ability", type: "text", key: "ability", label: "Ability" },
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
            { key: "vig", label: "Vigour", short: "VIG", min: 0, max: 18, display: "bar" },
            { key: "cla", label: "Clarity", short: "CLA", min: 0, max: 18, display: "bar" },
            { key: "spi", label: "Spirit", short: "SPI", min: 0, max: 18, display: "bar" },
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

export const mothership: SheetLayout = {
  system: "Mothership",
  name: "Classic",
  pages: [
    {
      id: "sheet",
      title: "Character",
      blocks: [
        {
          id: "stats",
          type: "stats",
          variant: "bars",
          span: 3,
          items: [
            { key: "str", label: "Strength", max: 100 },
            { key: "spd", label: "Speed", max: 100 },
            { key: "int", label: "Intellect", max: 100 },
            { key: "com", label: "Combat", max: 100 },
          ],
        },
        {
          id: "saves",
          type: "stats",
          variant: "bars",
          span: 3,
          items: [
            { key: "san", label: "Sanity", max: 100 },
            { key: "fear", label: "Fear", max: 100 },
            { key: "body", label: "Body", max: 100 },
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
          ],
        },
        {
          id: "skills",
          type: "list",
          key: "skills",
          title: "Skills",
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

const action = (key: string, label: string) => ({ key, label, min: 0, max: 4, start: 0 });

export const bladesInTheDark: SheetLayout = {
  system: "Blades in the Dark",
  name: "Classic",
  pages: [
    {
      id: "scoundrel",
      title: "Scoundrel",
      blocks: [
        {
          id: "who",
          type: "fields",
          variant: "inline",
          columns: 2,
          items: [
            { key: "playbook", label: "Playbook" },
            { key: "heritage", label: "Heritage" },
            { key: "vice", label: "Vice" },
            { key: "look", label: "Look" },
          ],
        },
        {
          id: "condition",
          type: "group",
          wide: 3,
          blocks: [
            {
              id: "stress",
              type: "trackers",
              items: [{ key: "stress", label: "Stress", min: 0, max: 9, start: 0 }],
            },
            {
              id: "trauma",
              type: "checks",
              key: "trauma",
              label: "Trauma",
              variant: "tags",
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
          ],
        },
        {
          id: "clocks",
          type: "trackers",
          variant: "boxes",
          wide: 3,
          items: [
            { key: "healing", label: "Healing", min: 0, max: 4, start: 0, display: "clock" },
            { key: "vendetta", label: "Vendetta", min: 0, max: 8, start: 0, display: "clock" },
          ],
        },
        {
          id: "insight",
          type: "group",
          title: "Insight",
          variant: "framed",
          span: 3,
          wide: 2,
          blocks: [
            {
              id: "insight-actions",
              type: "trackers",
              items: [
                action("hunt", "Hunt"),
                action("study", "Study"),
                action("survey", "Survey"),
                action("tinker", "Tinker"),
              ],
            },
          ],
        },
        {
          id: "prowess",
          type: "group",
          title: "Prowess",
          variant: "framed",
          span: 3,
          wide: 2,
          blocks: [
            {
              id: "prowess-actions",
              type: "trackers",
              items: [
                action("finesse", "Finesse"),
                action("prowl", "Prowl"),
                action("skirmish", "Skirmish"),
                action("wreck", "Wreck"),
              ],
            },
          ],
        },
        {
          id: "resolve",
          type: "group",
          title: "Resolve",
          variant: "framed",
          span: 6,
          wide: 2,
          blocks: [
            {
              id: "resolve-actions",
              type: "trackers",
              items: [
                action("attune", "Attune"),
                action("command", "Command"),
                action("consort", "Consort"),
                action("sway", "Sway"),
              ],
            },
          ],
        },
        {
          id: "load",
          type: "list",
          key: "items",
          title: "Load",
          wide: 4,
          columns: [
            { key: "carried", label: "", kind: "check" },
            { key: "item", label: "Item", kind: "text" },
            { key: "load", label: "Load", kind: "number" },
          ],
        },
        {
          id: "roll",
          type: "rolls",
          wide: 2,
          items: [
            { label: "Action", dice: "2d6" },
            { label: "Resist", dice: "1d6" },
          ],
        },
      ],
    },
  ],
};

export const presets: SheetLayout[] = [
  bastionlandClassic,
  bastionlandCompact,
  mothership,
  bladesInTheDark,
];
