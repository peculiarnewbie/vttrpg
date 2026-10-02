import type { EntryType } from "../compendium";
import { bastionProperty } from "./bastionland-sheet";

/*
 * Mythic Bastionland (Chris McDowall, Bastionland Press) is not under an open
 * licence, so the app ships its shapes only — sheets and entry types, no rules
 * text, tables or lists of Knights and Myths. A DM fills entries from their
 * own book.
 */

export const BASTIONLAND_SYSTEM_ID = "mythic-bastionland";

export const bastionlandEntryTypes: EntryType[] = [
  {
    id: "knight",
    name: "Knight",
    plural: "Knights",
    fields: [
      { key: "ability", label: "Ability", kind: "longtext" },
      // Same columns as the sheet's Property, so a linked Knight's kit copies straight in.
      { key: "property", label: "Property", kind: "list", columns: bastionProperty.columns },
    ],
  },
  {
    id: "myth",
    name: "Myth",
    plural: "Myths",
    fields: [
      // Omens come in order; the DM ticks each one as it's revealed.
      {
        key: "omens",
        label: "Omens",
        kind: "list",
        columns: [
          { key: "seen", label: "Seen", kind: "check" },
          { key: "omen", label: "Omen", kind: "text" },
        ],
      },
    ],
  },
  {
    id: "spark",
    name: "Spark table",
    plural: "Spark tables",
    fields: [
      // Two columns rolled separately and read together.
      { key: "first", label: "First", kind: "oracle", dice: "1d12" },
      { key: "second", label: "Second", kind: "oracle", dice: "1d12" },
    ],
  },
  {
    id: "person",
    name: "Person or creature",
    plural: "People and creatures",
    fields: [
      { key: "vig", label: "VIG", kind: "number" },
      { key: "cla", label: "CLA", kind: "number" },
      { key: "spi", label: "SPI", kind: "number" },
      { key: "gd", label: "GD", kind: "number" },
      { key: "armour", label: "Armour", kind: "number" },
      { key: "attacks", label: "Attacks", kind: "actions" },
    ],
  },
];
