import type { EntryType } from "./compendium";
import type { SheetLayout } from "./sheet-layout";
import { gameSystemNamed } from "./systems";

/** A shipped system's entry types, by system name; copies, so callers may change them. */
export const presetEntryTypes = (system: string): EntryType[] =>
  structuredClone([...(gameSystemNamed(system)?.system.entryTypes ?? [])]);

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
