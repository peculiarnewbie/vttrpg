import { expect, it } from "vitest";
import { notationRefs, parseNotation } from "./dice-notation";
import { allBlocks, layoutKeys } from "./layout-edit";
import type { SheetValues } from "./sheet-layout";
import { sheetDerived, sheetRefLookup, sheetScope } from "./sheet-refs";
import { gameSystems } from "./systems/index";

/*
 * Formulas keep their meaning as the language grows: every shipped layout's
 * derived values, derived list cells and roll refs, on a made-up character,
 * match the snapshot recorded before the change.
 */

const sample = (keys: readonly string[]): SheetValues =>
  Object.fromEntries(keys.map((key, index) => [key, (index * 7) % 19]));

it("evaluates every shipped layout's formulas as before", () => {
  const results: Record<string, unknown> = {};
  for (const { system } of gameSystems)
    for (const layout of system.layouts ?? []) {
      const values: SheetValues = sample(layoutKeys(layout));
      const lists = allBlocks(layout).filter((block) => block.type === "list");
      for (const list of lists)
        values[list.key] = [0, 1].map((n) =>
          Object.fromEntries(list.columns.map((column, index) => [column.key, n * 3 + index])),
        );
      const scope = sheetScope(layout, values);
      const lookup = sheetRefLookup(layout, values);
      const rolls = allBlocks(layout).flatMap((block) =>
        block.type === "rolls"
          ? block.items.map((item) => item.dice)
          : block.type === "stats" || block.type === "trackers"
            ? block.items.flatMap((item) => (item.roll ? [item.roll] : []))
            : [],
      );
      results[`${system.name} — ${layout.name}`] = {
        derived: sheetDerived(layout, values).values,
        cells: lists.map((list) => ({
          list: list.key,
          sums: list.columns.map((column) => scope.value({ key: list.key, column: column.key })),
        })),
        refs: rolls.map((dice) => {
          const parsed = parseNotation(dice);
          return parsed.ok ? notationRefs(parsed.value).map((ref) => lookup(ref)?.value) : null;
        }),
      };
    }
  expect(results).toMatchSnapshot();
});
