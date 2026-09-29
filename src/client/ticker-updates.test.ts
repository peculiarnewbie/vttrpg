import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { Character, type TickerDefinition } from "../domain/schemas";
import { createTickerUpdates } from "./ticker-updates";

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
    const updates = createTickerUpdates();
    let visible = character;
    for (let i = 1; i <= 5; i++)
      visible = updates.stage(visible, hp, visible.tickers.hp - 1, String(i));
    expect(visible.tickers.hp).toBe(5);
    for (let i = 1; i <= 5; i++) {
      visible = updates.reconcile({ ...character, tickers: { hp: 10 - i } }, String(i));
      expect(visible.tickers.hp).toBe(5);
    }
    expect(updates.reconcile({ ...character, tickers: { hp: 8 } }).tickers.hp).toBe(8);
  });
  it("keeps independent trackers pending and accepts the server's clamped acknowledgement", () => {
    const updates = createTickerUpdates();
    const other = { ...hp, id: "other" };
    let visible = updates.stage(character, hp, 7, "hp-request");
    visible = updates.stage(visible, other, 4, "other-request");
    visible = updates.reconcile({ ...character, tickers: { hp: 6, other: 10 } }, "hp-request");
    expect(visible.tickers).toEqual({ hp: 6, other: 4 });
    expect(updates.reset()[0].tickers).toEqual({ hp: 6, other: 10 });
  });
  it("clamps direct targets to personal bounds and restores confirmed state on rejection", () => {
    const updates = createTickerUpdates();
    const personal = { ...character, tickerMax: { hp: 20 } };
    expect(updates.stage(personal, hp, 99, "a").tickers.hp).toBe(20);
    expect(updates.stage(personal, hp, -99, "b").tickers.hp).toBe(0);
    expect(updates.reset()).toEqual([personal]);
    expect(updates.reconcile(personal)).toEqual(personal);
  });
});
