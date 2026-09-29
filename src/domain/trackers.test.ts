import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TickerDefinition } from "./schemas";
import { trackerDisplay, trackerPips, trackerPipValue } from "./trackers";

describe("trackerDisplay", () => {
  it("decodes old definitions and resolves absent display as auto", () => {
    const def = Schema.decodeUnknownSync(TickerDefinition)({
      id: "guard",
      label: "Guard",
      min: 0,
      max: 12,
      defaultValue: 12,
    });
    expect(def.display).toBeUndefined();
    expect(trackerDisplay(def)).toBe("pips");
  });

  it.each([
    [0, 12, "pips"],
    [0, 13, "bar"],
    [10, 22, "pips"],
    [-6, 6, "pips"],
    [-6, 7, "bar"],
    [5, 5, "pips"],
  ] as const)("resolves auto for %i to %i as %s", (min, max, expected) => {
    expect(trackerDisplay({ min, max, display: "auto" })).toBe(expected);
    expect(trackerDisplay({ min, max })).toBe(expected);
  });

  it.each(["pips", "bar", "number"] as const)("honors explicit %s at any range", (display) => {
    for (const max of [3, 30]) {
      const def = Schema.decodeUnknownSync(TickerDefinition)({
        id: "guard",
        label: "Guard",
        min: 0,
        max,
        defaultValue: 0,
        display,
      });
      expect(trackerDisplay(def)).toBe(display);
    }
  });

  it("rejects unsupported display types", () => {
    expect(() =>
      Schema.decodeUnknownSync(TickerDefinition)({
        id: "guard",
        label: "Guard",
        min: 0,
        max: 10,
        defaultValue: 0,
        display: "circle",
      }),
    ).toThrow();
  });
});

describe("tracker pips", () => {
  it("lists points above the minimum through the effective maximum", () => {
    expect(trackerPips(2, 5)).toEqual([3, 4, 5]);
    expect(trackerPips(-2, 1)).toEqual([-1, 0, 1]);
    expect(trackerPips(2, 2)).toEqual([]);
    expect(trackerPips(2, 1)).toEqual([]);
  });

  it("empties the top pip and sets any other pip absolutely", () => {
    expect(trackerPipValue(1, 1)).toBe(0);
    expect(trackerPipValue(3, 3)).toBe(2);
    expect(trackerPipValue(2, 5)).toBe(2);
    expect(trackerPipValue(5, 2)).toBe(5);
    expect(trackerPipValue(-1, -1)).toBe(-2);
  });
});
