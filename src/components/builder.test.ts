import { describe, expect, it } from "vitest";
import { idFromLabel } from "./builder";

describe("idFromLabel", () => {
  const items = [{ id: "vigour" }, { id: "guard" }, { id: "new_tracker" }];

  it("slugs the label", () => {
    expect(idFromLabel("Max Clarity!", items, 2)).toBe("max_clarity");
  });

  it("avoids ids used by other items", () => {
    expect(idFromLabel("Guard", items, 2)).toBe("guard_2");
  });

  it("may keep its own current id", () => {
    expect(idFromLabel("New tracker", items, 2)).toBe("new_tracker");
  });
});
