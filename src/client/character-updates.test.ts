import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { Character, type TickerDefinition } from "../domain/schemas";
import { trackerDefinitions } from "../domain/trackers-definitions";
import { createCharacterUpdates } from "./character-updates";

const character: Character = {
  id: "hero",
  worldId: "world",
  memberId: "player",
  name: "Hero",
  templateId: "sheet",
  values: {},
  tickers: { hp: 10 },
  createdAt: "now",
  updatedAt: "now",
};
const hp: TickerDefinition = { id: "hp", label: "Health", min: 0, max: 10, defaultValue: 10 };

describe("optimistic tracker updates", () => {
  it("decodes old characters without maximum overrides", () => {
    expect(Schema.decodeUnknownSync(Character)(character)).toEqual(character);
  });
  it("preserves five rapid decrements while earlier acknowledgements arrive", () => {
    const updates = createCharacterUpdates();
    let visible = character;
    for (let i = 1; i <= 5; i++)
      visible = updates.stageTracker(visible, hp, visible.tickers.hp - 1, String(i));
    expect(visible.tickers.hp).toBe(5);
    for (let i = 1; i <= 5; i++) {
      visible = updates.reconcile({ ...character, tickers: { hp: 10 - i } }, String(i));
      expect(visible.tickers.hp).toBe(5);
    }
    expect(updates.reconcile({ ...character, tickers: { hp: 8 } }).tickers.hp).toBe(8);
  });
  it("keeps independent trackers pending and accepts the server's clamped acknowledgement", () => {
    const updates = createCharacterUpdates();
    const other = { ...hp, id: "other" };
    let visible = updates.stageTracker(character, hp, 7, "hp-request");
    visible = updates.stageTracker(visible, other, 4, "other-request");
    visible = updates.reconcile({ ...character, tickers: { hp: 6, other: 10 } }, "hp-request");
    expect(visible.tickers).toEqual({ hp: 6, other: 4 });
    expect(updates.reset()[0].tickers).toEqual({ hp: 6, other: 10 });
  });
  it("clamps direct targets to personal bounds and restores confirmed state on rejection", () => {
    const updates = createCharacterUpdates();
    const personal = { ...character, tickerMax: { hp: 20 } };
    expect(updates.stageTracker(personal, hp, 99, "a").tickers.hp).toBe(20);
    expect(updates.stageTracker(personal, hp, -99, "b").tickers.hp).toBe(0);
    expect(updates.reset()).toEqual([personal]);
    expect(updates.reconcile(personal)).toEqual(personal);
  });
});

describe("optimistic character updates", () => {
  it("clamps a layout tracker using its merged definition and personal maximum", () => {
    const updates = createCharacterUpdates();
    const definition = trackerDefinitions({
      tickers: [hp],
      layout: {
        system: "test",
        name: "Test",
        pages: [
          {
            id: "page",
            title: "Sheet",
            blocks: [
              {
                id: "trackers",
                type: "trackers",
                items: [{ key: "hp", label: "Health", min: 2, max: 6, start: 4 }],
              },
            ],
          },
        ],
      },
    })[0];
    expect(updates.stageTracker(character, definition, 99, "1").tickers.hp).toBe(6);
    expect(updates.stageTracker(character, definition, -99, "2").tickers.hp).toBe(2);
    expect(
      updates.stageTracker({ ...character, tickerMax: { hp: 12 } }, definition, 99, "3").tickers.hp,
    ).toBe(12);
  });

  it("keeps rapid successive rich values visible through earlier acknowledgements", () => {
    const updates = createCharacterUpdates();
    let visible = updates.stageValue(
      character,
      "inventory",
      [{ item: "Rope", tags: ["gear"] }],
      "1",
    );
    visible = updates.stageValue(visible, "inventory", [{ item: "Torch", carried: true }], "2");
    visible = updates.reconcile(
      { ...character, values: { inventory: [{ item: "Rope", tags: ["gear"] }] } },
      "1",
    );
    expect(visible.values.inventory).toEqual([{ item: "Torch", carried: true }]);
    visible = updates.reconcile(
      { ...character, values: { inventory: [{ item: "Torch", carried: true }] } },
      "2",
    );
    expect(visible.values.inventory).toEqual([{ item: "Torch", carried: true }]);
    expect(updates.reset()).toEqual([]);
  });

  it("does not roll values back when acknowledgements arrive out of order", () => {
    const updates = createCharacterUpdates();
    let visible = updates.stageValue(character, "name", "First", "1");
    visible = updates.stageValue(visible, "name", "Latest", "2");
    visible = updates.reconcile({ ...character, values: { name: "Latest" } }, "2");
    expect(visible.values.name).toBe("Latest");
    visible = updates.reconcile({ ...character, values: { name: "First" } }, "1");
    expect(visible.values.name).toBe("Latest");
    expect(updates.reset()).toEqual([]);
    expect(updates.reconcile({ ...character, values: { name: "Remote" } }).values.name).toBe(
      "Remote",
    );
  });

  it("reconciles independent keys out of order while keeping other kinds pending", () => {
    const updates = createCharacterUpdates();
    let visible = updates.stageValue(character, "a", true, "1");
    visible = updates.stageValue(visible, "b", ["tag"], "2");
    visible = updates.stageTracker(visible, hp, 6, "3");
    visible = updates.stagePref(visible, "stats", "bars");
    visible = updates.reconcile({ ...character, values: { a: true, b: ["tag"] } }, "2");
    visible = updates.reconcile({ ...character, values: { a: true } }, "1");
    expect(visible.values).toEqual({ a: true, b: ["tag"] });
    expect(visible.tickers.hp).toBe(6);
    expect(visible.layoutPrefs).toEqual({ stats: "bars" });
    expect(updates.reset()).toEqual([{ ...character, values: { a: true, b: ["tag"] } }]);
  });

  it("reconciles pref echoes, including rapid changes and clearing an override", () => {
    const updates = createCharacterUpdates();
    let visible = updates.stagePref(character, "stats", "boxes");
    visible = updates.stagePref(visible, "stats", "bars");
    visible = updates.reconcile({ ...character, layoutPrefs: { stats: "boxes" } });
    expect(visible.layoutPrefs).toEqual({ stats: "bars" });
    visible = updates.reconcile({ ...character, layoutPrefs: { stats: "bars" } });
    expect(updates.reset()).toEqual([]);
    visible = updates.stagePref(visible, "stats", null);
    expect(visible.layoutPrefs).toEqual({});
    expect(updates.reconcile({ ...character, layoutPrefs: {} }).layoutPrefs).toEqual({});
    expect(updates.reset()).toEqual([]);
  });

  it("restores confirmed values, trackers and prefs together on error or disconnect", () => {
    const updates = createCharacterUpdates();
    const original = { ...character, values: { text: "Before" }, layoutPrefs: { stats: "strip" } };
    let visible = updates.stageValue(original, "text", "After", "value");
    visible = updates.stageTracker(visible, hp, 2, "tracker");
    visible = updates.stagePref(visible, "stats", null);
    expect(visible.values.text).toBe("After");
    expect(visible.tickers.hp).toBe(2);
    expect(visible.layoutPrefs).toEqual({});
    expect(updates.reset()).toEqual([original]);
    expect(updates.reset()).toEqual([]);
    expect(updates.reconcile(original)).toEqual(original);
  });

  it("keeps tracker and value keys separate even when their names match", () => {
    const updates = createCharacterUpdates();
    let visible = updates.stageTracker(character, hp, 4, "tracker");
    visible = updates.stageValue(visible, "hp", "text", "value");
    visible = updates.reconcile({ ...character, tickers: { hp: 4 } }, "tracker");
    expect(visible.tickers.hp).toBe(4);
    expect(visible.values.hp).toBe("text");
  });
});
