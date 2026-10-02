import type { EntryType } from "../compendium";

/*
 * Mothership (Tuesday Knight Games) is not under an open licence, so the app
 * ships its shapes only — sheet and entry types, no rules text or tables. A
 * DM fills entries from their own book.
 */

export const MOTHERSHIP_SYSTEM_ID = "mothership";

export const mothershipEntryTypes: EntryType[] = [
  { id: "class", name: "Class", plural: "Classes", fields: [] },
  {
    id: "skill",
    name: "Skill",
    plural: "Skills",
    fields: [
      { key: "tier", label: "Tier", kind: "select", options: ["Trained", "Expert", "Master"] },
      { key: "bonus", label: "Bonus", kind: "number" },
    ],
    filters: [{ key: "tier", kind: "set" }],
  },
  {
    id: "weapon",
    name: "Weapon",
    plural: "Weapons",
    fields: [
      { key: "dmg", label: "Dmg", kind: "dice" },
      { key: "shots", label: "Shots", kind: "number" },
    ],
  },
  {
    id: "item",
    name: "Item",
    plural: "Items",
    fields: [{ key: "notes", label: "Notes", kind: "text" }],
  },
  {
    id: "creature",
    name: "Creature",
    plural: "Creatures",
    fields: [
      { key: "combat", label: "Combat", kind: "number" },
      { key: "instinct", label: "Instinct", kind: "number" },
      { key: "armor", label: "Armor", kind: "number" },
      { key: "health", label: "Health", kind: "number" },
      { key: "wounds", label: "Wounds", kind: "number" },
      { key: "attacks", label: "Attacks", kind: "actions" },
    ],
  },
];
