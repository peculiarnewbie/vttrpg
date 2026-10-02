import type { SourceInput, SystemInput } from "../corpus-rpc";
import { BLADES_SOURCE_ID, BLADES_SYSTEM_ID, bladesEntryTypes, bladesLicence } from "./blades";
import { CAIRN_SOURCE_ID, CAIRN_SYSTEM_ID, cairnEntryTypes, cairnLicence } from "./cairn2e";
import { DND5E_SYSTEM_ID, SRD52_SOURCE_ID, dnd5eEntryTypes, srd52Licence } from "./dnd5e-2024";
import { BASTIONLAND_SYSTEM_ID, bastionlandEntryTypes } from "./bastionland";
import { bastionlandClassic, bastionlandCompact } from "./bastionland-sheet";
import { bladesCrew, bladesScoundrel } from "./blades-sheet";
import { cairnCharacter } from "./cairn-sheet";
import { dnd5eCharacter } from "./dnd5e-sheet";
import { MOTHERSHIP_SYSTEM_ID, mothershipEntryTypes } from "./mothership";
import { mothership } from "./mothership-sheet";
import { starforgedCharacter, starforgedStarship } from "./starforged-sheet";
import {
  STARFORGED_SOURCE_ID,
  STARFORGED_SYSTEM_ID,
  starforgedEntryTypes,
  starforgedLicence,
} from "./starforged";
import { STONETOP_SYSTEM_ID, stonetopEntryTypes } from "./stonetop";
import { stonetopCharacter, stonetopSteading } from "./stonetop-sheet";

/*
 * The systems the app ships first-party: each a system definition (entry
 * types and sheet layouts — shapes, no rules text) and the open library its
 * text is published as. Importers target these ids and field keys.
 */

export type FirstPartySystem = { system: SystemInput; source: SourceInput };

export const firstPartySystems: readonly FirstPartySystem[] = [
  {
    system: {
      id: DND5E_SYSTEM_ID,
      name: "Fifth Edition (SRD 5.2)",
      description: "The 2024 fifth-edition rules, from the System Reference Document 5.2.",
      entryTypes: dnd5eEntryTypes,
      layouts: [dnd5eCharacter],
    },
    source: {
      id: SRD52_SOURCE_ID,
      name: "System Reference Document 5.2",
      systemId: DND5E_SYSTEM_ID,
      licence: srd52Licence,
      visibility: "public",
    },
  },
  {
    system: {
      id: STARFORGED_SYSTEM_ID,
      name: "Ironsworn: Starforged",
      description: "Solo, co-op and guided science-fiction adventure.",
      entryTypes: starforgedEntryTypes,
      layouts: [starforgedCharacter, starforgedStarship],
    },
    source: {
      id: STARFORGED_SOURCE_ID,
      name: "Ironsworn: Starforged",
      systemId: STARFORGED_SYSTEM_ID,
      licence: starforgedLicence,
      visibility: "public",
    },
  },
  {
    system: {
      id: CAIRN_SYSTEM_ID,
      name: "Cairn (2nd edition)",
      description: "Adventure game about exploring a dark and mysterious Wood.",
      entryTypes: cairnEntryTypes,
      layouts: [cairnCharacter],
    },
    source: {
      id: CAIRN_SOURCE_ID,
      name: "Cairn Second Edition",
      systemId: CAIRN_SYSTEM_ID,
      licence: cairnLicence,
      visibility: "public",
    },
  },
  {
    system: {
      id: BLADES_SYSTEM_ID,
      name: "Blades in the Dark",
      description: "Daring scoundrels building a criminal enterprise.",
      entryTypes: bladesEntryTypes,
      layouts: [bladesScoundrel, bladesCrew],
    },
    source: {
      id: BLADES_SOURCE_ID,
      name: "Blades in the Dark SRD",
      systemId: BLADES_SYSTEM_ID,
      licence: bladesLicence,
      visibility: "public",
    },
  },
];

export const firstPartySystem = (systemId: string) =>
  firstPartySystems.find((item) => item.system.id === systemId);

/*
 * Systems whose text isn't under an open licence: the app ships their shapes
 * only (sheets and entry types, no rules text, tables or content lists), named
 * to say which game they're for and marked unofficial. A DM writes the entries
 * from their own book.
 */
export const presetSystems: readonly SystemInput[] = [
  {
    id: BASTIONLAND_SYSTEM_ID,
    name: "Mythic Bastionland",
    description:
      "Unofficial sheets and entry types for Mythic Bastionland by Chris McDowall (Bastionland Press).",
    entryTypes: bastionlandEntryTypes,
    layouts: [bastionlandClassic, bastionlandCompact],
  },
  {
    id: STONETOP_SYSTEM_ID,
    name: "Stonetop",
    description:
      "Unofficial sheets and entry types for Stonetop by Jeremy Strandberg (Lampblack & Brimstone).",
    entryTypes: stonetopEntryTypes,
    layouts: [stonetopCharacter, stonetopSteading],
  },
  {
    id: MOTHERSHIP_SYSTEM_ID,
    name: "Mothership",
    description: "Unofficial sheet and entry types for Mothership (Tuesday Knight Games).",
    entryTypes: mothershipEntryTypes,
    layouts: [mothership],
  },
];

/** Every system a world can start from; `source` is its library, when it has one. */
export type GameSystem = { system: SystemInput; source?: SourceInput };

export const gameSystems: readonly GameSystem[] = [
  ...firstPartySystems,
  ...presetSystems.map((system) => ({ system })),
];

/** By name, as layouts name their system (`layout.system`). */
export const gameSystemNamed = (name: string) =>
  gameSystems.find((item) => item.system.name === name);
