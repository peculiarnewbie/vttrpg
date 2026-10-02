import type { Component } from "solid-js";
import type { BuilderPart } from "../../domain/sheet-layout";
import { BlocksEditor, BlocksView } from "./blocks";
import { BudgetEditor, BudgetView } from "./budget";
import { ChooseEditor, ChooseView } from "./choose";
import { ReviewEditor, ReviewView } from "./review";
import { RollsEditor, RollsView } from "./rolls";
import { ShowEditor, ShowView } from "./show";
import { ScoresEditor, ScoresView } from "./scores";
import { TablesEditor, TablesView } from "./tables";
import type { PartEditorProps, PartViewProps } from "./types";

export type { BuilderActions, BuilderCompendium, BuilderContext } from "./types";

/*
 * How each part kind looks in the builder and is edited in the layout
 * editor. Its label, blank part and problem checks are in
 * domain/builder-parts.ts; a kind missing from either map is a compile error.
 */
export const partViews: {
  readonly [T in BuilderPart["type"]]: {
    readonly View: Component<PartViewProps<T>>;
    readonly Editor: Component<PartEditorProps<T>>;
  };
} = {
  blocks: { View: BlocksView, Editor: BlocksEditor },
  choose: { View: ChooseView, Editor: ChooseEditor },
  rolls: { View: RollsView, Editor: RollsEditor },
  show: { View: ShowView, Editor: ShowEditor },
  tables: { View: TablesView, Editor: TablesEditor },
  review: { View: ReviewView, Editor: ReviewEditor },
  budget: { View: BudgetView, Editor: BudgetEditor },
  scores: { View: ScoresView, Editor: ScoresEditor },
};

/** The view and editor for a part, typed for that part. */
export const partView = <T extends BuilderPart["type"]>(type: T) =>
  partViews[type] as unknown as {
    View: Component<PartViewProps<T>>;
    Editor: Component<PartEditorProps<T>>;
  };
