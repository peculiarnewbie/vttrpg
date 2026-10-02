import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { repeatLabel, repeatNotation, rollTimes } from "./builder-parts";
import { parseNotation } from "./dice-notation";
import { SheetLayout } from "./sheet-layout";
import { layoutProblems } from "./sheet-refs";

const layoutWith = (items: unknown): SheetLayout =>
  ({
    system: "Test",
    name: "Repeats",
    pages: [{ id: "main", title: "Main", blocks: [] }],
    builder: { steps: [{ id: "rolls", title: "Rolls", parts: [{ type: "rolls", items }] }] },
  }) as unknown as SheetLayout;

describe("rolls repeat and notes", () => {
  it("repeats one chat roll with the groups kept apart, labelling it ×N", () => {
    expect(rollTimes({})).toBe(1);
    expect(rollTimes({ times: 3 })).toBe(3);
    expect(repeatLabel({ label: "Virtue", dice: "3d6" })).toBe("Virtue");
    expect(repeatNotation({ label: "Virtue", dice: "3d6" })).toBe("3d6");
    expect(repeatLabel({ label: "Ability scores", dice: "4d6kh3", times: 4 })).toBe(
      "Ability scores ×4",
    );
    expect(repeatNotation({ label: "Ability scores", dice: "4d6kh3", times: 4 })).toBe(
      "4d6kh3 | 4d6kh3 | 4d6kh3 | 4d6kh3",
    );
    expect(
      parseNotation(repeatNotation({ label: "Ability scores", dice: "4d6kh3", times: 4 })).ok,
    ).toBe(true);
  });

  it("saves times and notes, within their limits", () => {
    const decoded = Schema.decodeUnknownSync(SheetLayout)(
      layoutWith([{ label: "Ability scores", dice: "4d6kh3", times: 4, note: "Keep three" }]),
    );
    expect(decoded.builder?.steps[0].parts).toEqual([
      {
        type: "rolls",
        items: [{ label: "Ability scores", dice: "4d6kh3", times: 4, note: "Keep three" }],
      },
    ]);
    // Notes stay short; repeats stay inside the notation's 8 groups.
    const invalid = (items: unknown) =>
      Schema.decodeUnknownResult(SheetLayout)(layoutWith(items))._tag;
    expect(invalid([{ label: "Roll", dice: "1d6", times: 0 }])).toBe("Failure");
    expect(invalid([{ label: "Roll", dice: "1d6", times: 9 }])).toBe("Failure");
    expect(invalid([{ label: "Roll", dice: "1d6", times: 12 }])).toBe("Failure");
    expect(invalid([{ label: "Roll", dice: "1d6", note: "x".repeat(121) }])).toBe("Failure");
    expect(invalid([{ label: "x".repeat(61), dice: "1d6" }])).toBe("Failure");
  });

  it("checks the combined notation, not just the single roll", () => {
    // Short singles whose repeats overflow the notation's limits.
    expect(layoutProblems(layoutWith([{ label: "Virtue", dice: "3d6" }]))).toEqual([]);
    expect(layoutProblems(layoutWith([{ label: "Pairs", dice: "1d6 | 1d6", times: 5 }]))).toEqual([
      expect.stringMatching(/^Roll "Pairs ×5": At most 8 groups/),
    ]);
    const long = Array.from({ length: 15 }, () => "1d6").join("+");
    expect(parseNotation(long).ok).toBe(true);
    expect(layoutProblems(layoutWith([{ label: "Long", dice: long, times: 4 }]))).toEqual([
      expect.stringMatching(/^Roll "Long ×4": At most 200 characters/),
    ]);
    // A broken single roll is still flagged, under its repeated label.
    expect(layoutProblems(layoutWith([{ label: "Bad", dice: "2q6", times: 2 }]))).toEqual([
      expect.stringMatching(/^Roll "Bad ×2": /),
    ]);
  });
});
