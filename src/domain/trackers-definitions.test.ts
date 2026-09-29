import { describe, expect, it } from "vitest";
import { bastionlandClassic } from "./sheet-presets";
import { trackerDefinitions } from "./trackers-definitions";

const legacy = {
  id: "hp",
  label: "HP",
  min: 0,
  max: 40,
  defaultValue: 20,
};

describe("trackerDefinitions", () => {
  it("returns legacy tickers when there is no layout", () => {
    expect(trackerDefinitions({ tickers: [legacy] })).toEqual([legacy]);
  });

  it("adds layout trackers, including those inside groups, starting at max by default", () => {
    const ids = trackerDefinitions({ tickers: [], layout: bastionlandClassic });
    expect(ids.map((item) => item.id)).toEqual(["vig", "cla", "spi", "gd", "glory"]);
    expect(ids.find((item) => item.id === "gd")).toMatchObject({ min: 0, max: 6, defaultValue: 6 });
  });

  it("lets the layout win on a shared key and clamps its start", () => {
    const layout = {
      system: "X",
      name: "Y",
      pages: [
        {
          id: "p",
          title: "P",
          blocks: [
            {
              id: "t",
              type: "trackers" as const,
              items: [{ key: "hp", label: "Health", min: 0, max: 10, start: 99 }],
            },
          ],
        },
      ],
    };
    expect(trackerDefinitions({ tickers: [legacy], layout })).toEqual([
      { id: "hp", label: "Health", min: 0, max: 10, defaultValue: 10 },
    ]);
  });

  it("handles a missing template", () => {
    expect(trackerDefinitions(undefined)).toEqual([]);
  });
});
