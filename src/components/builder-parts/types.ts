import type { JSX } from "@solidjs/web";
import type { CompendiumStore } from "../../client/compendium-store";
import type { PartOf } from "../../domain/builder-parts";
import type { EntryType } from "../../domain/compendium";
import type { Scope } from "../../domain/derived";
import type { BuilderPart, SheetLayout, SheetValues } from "../../domain/sheet-layout";
import type { CompendiumLookup } from "../sheet-blocks";

/*
 * What a builder part sees and how it writes. Parts read only the
 * `BuilderContext` and write only through `BuilderActions` — never the
 * character's store directly — so every write is one of these explicit
 * actions, and a part could later run anywhere these can be passed (an
 * extension's frame, through messages).
 */

export type BuilderCompendium = CompendiumLookup & Pick<CompendiumStore, "rowByName">;

export type BuilderContext = {
  readonly layout: SheetLayout;
  /** The character's values (trackers are read through `tracker`). */
  readonly values: SheetValues;
  /** A tracker's current value and maximum, as the sheet shows them. */
  readonly tracker: (key: string) => { value: number; max: number } | undefined;
  /** What formulas read on this character: values, trackers, derived values. */
  readonly scope: () => Scope;
  readonly compendium?: BuilderCompendium;
  readonly readOnly: boolean;
};

export type BuilderActions = {
  readonly setValue: (key: string, value: SheetValues[string]) => void;
  readonly setTracker: (key: string, value: number) => void;
  /** A tracker's maximum for this character (saved with Done, like Edit's); `null` restores the layout's. */
  readonly setTrackerMax: (key: string, max: number | null) => void;
  /** Posts a roll to chat — never to the sheet. */
  readonly roll: (label: string, dice: string) => void;
  readonly rollTable?: (entryId: string, field: string) => void;
  readonly openEntry?: (entryId: string) => void;
};

export type PartViewProps<T extends BuilderPart["type"]> = {
  readonly part: PartOf<T>;
  readonly context: BuilderContext;
  readonly actions: BuilderActions;
  /** Sheet blocks, rendered as on the sheet in edit mode (the host's own rendering). */
  readonly renderBlocks: (ids: readonly string[]) => JSX.Element;
  /** Go to another step of the builder (by step id) — navigation, not a write. */
  readonly navigate: (stepId: string) => void;
};

export type PartEditorProps<T extends BuilderPart["type"]> = {
  readonly part: PartOf<T>;
  /** Accessible name prefix, e.g. "Step 2 part 1". */
  readonly label: string;
  readonly layout: SheetLayout;
  readonly entryTypes: readonly EntryType[];
  readonly onChange: (part: PartOf<T>) => void;
};
