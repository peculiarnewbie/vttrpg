import type { Scope } from "./derived";
import { allBlocks } from "./layout-edit";
import { isKnownPart, valueFilled, type SheetLayout, type SheetValues } from "./sheet-layout";
import { formulaHolds, refLabel } from "./sheet-refs";

/*
 * What's still blank, step by step, for the builder's `review` part. Pure:
 * which other applying steps exist, whether each reads as done, and the
 * keys still empty in them. The view only navigates; nothing here writes.
 */

export type ReviewRow = {
  readonly stepId: string;
  readonly title: string;
  /** Whether the step's `done` formula holds — a hint, never a gate. */
  readonly done: boolean;
  /**
   * What's still empty, by its label on the sheet: fields and stats in a
   * blocks part, text/entry/checks blocks, lists with no rows, choose targets.
   */
  readonly blank: readonly string[];
};

/**
 * One row per step that applies (its `when` holds) except `excludeStepId`
 * (the step holding the review part), in builder order. Unknown part kinds
 * are ignored; a blocks part naming a removed block just skips it.
 */
export const reviewRows = (
  layout: SheetLayout,
  values: SheetValues,
  scope: Scope,
  excludeStepId?: string,
): ReviewRow[] => {
  const steps = layout.builder?.steps ?? [];
  const blocks = new Map(allBlocks(layout).map((block) => [block.id, block]));
  return steps.flatMap((step, index): ReviewRow[] => {
    if (step.id === excludeStepId || !formulaHolds(step.when, scope)) return [];
    const blank = new Set<string>();
    const missing = (key: string) => {
      if (!valueFilled(values[key])) blank.add(key);
    };
    for (const part of step.parts) {
      if (!isKnownPart(part)) continue;
      if (part.type === "blocks") {
        for (const id of part.blocks) {
          const block = blocks.get(id);
          if (!block) continue;
          switch (block.type) {
            case "fields":
            case "stats":
              for (const item of block.items) missing(item.key);
              break;
            case "text":
            case "entry":
            case "checks":
            case "list":
              missing(block.key);
              break;
            default:
              break; // Headings, rolls and trackers hold nothing the player fills in.
          }
        }
      } else if (part.type === "choose") {
        missing(part.key);
      }
      // Rolls, tables and review parts hold nothing to fill in.
    }
    return [
      {
        stepId: step.id,
        title: step.title || `Step ${index + 1}`,
        done: formulaHolds(step.done, scope, false),
        blank: [...blank].map((key) => refLabel(layout, { key })),
      },
    ];
  });
};
