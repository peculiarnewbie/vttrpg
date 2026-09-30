import type { EntryType } from "./compendium";
import type { SheetLayout } from "./sheet-layout";
import { bastionlandClassic, mothership } from "./sheet-presets";

const listColumns = (layout: SheetLayout, key: string) =>
  layout.pages
    .flatMap((page) => page.blocks)
    .find((block) => block.type === "list" && block.key === key);

const loadoutFields = (key: string) => {
  const list = listColumns(mothership, key);
  return list?.type === "list"
    ? list.columns
        .filter((column) => column.key !== "name")
        .flatMap(({ key, label, kind }) =>
          kind === "check" || kind === "derived" || kind === "progress"
            ? []
            : [{ key, label, kind }],
        )
    : [];
};

const property = listColumns(bastionlandClassic, "property");
const systems: Record<string, readonly EntryType[]> = {
  "Mythic Bastionland": [
    {
      id: "knight",
      name: "Knight",
      plural: "Knights",
      fields: [
        { key: "ability", label: "Ability", kind: "longtext" },
        {
          key: "property",
          label: "Property",
          kind: "list",
          columns: property?.type === "list" ? property.columns : [],
        },
      ],
    },
  ],
  Mothership: [
    { id: "weapon", name: "Weapon", plural: "Weapons", fields: loadoutFields("weapons") },
    { id: "item", name: "Item", plural: "Items", fields: loadoutFields("gear") },
  ],
  "Blades in the Dark": [
    {
      id: "playbook",
      name: "Playbook",
      plural: "Playbooks",
      fields: [{ key: "ability", label: "Special ability", kind: "longtext" }],
    },
  ],
};

export const presetEntryTypes = (system: string): EntryType[] => {
  const types = Object.hasOwn(systems, system) ? systems[system] : [];
  return structuredClone([...types]);
};

export const entryTypesForLayout = (layout: SheetLayout): EntryType[] => {
  const referenced = new Set(
    layout.pages
      .flatMap((page) =>
        page.blocks.flatMap((block) => (block.type === "group" ? block.blocks : [block])),
      )
      .flatMap((block) =>
        block.type === "entry"
          ? [block.entryType]
          : block.type === "list" && block.source
            ? [block.source.entryType]
            : [],
      ),
  );
  return presetEntryTypes(layout.system).filter((type) => referenced.has(type.id));
};
