// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadWorldPanels, saveWorldPanels } from "./world-panels";

describe("local world panel preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
  });
  it("remembers each panel independently and scopes preferences to its world", () => {
    saveWorldPanels("one", { chat: false, tools: true });
    expect(loadWorldPanels("one")).toEqual({ chat: false, tools: true });
    expect(loadWorldPanels("two")).toEqual({ chat: true, tools: true });
  });
  it("recovers from corrupted storage and avoids overlapping panels on small screens", () => {
    localStorage.setItem("tabletop:panels:one", "broken json");
    expect(loadWorldPanels("one")).toEqual({ chat: true, tools: true });
    Object.defineProperty(window, "innerWidth", { value: 390 });
    expect(loadWorldPanels("one")).toEqual({ chat: false, tools: false });
    saveWorldPanels("one", { chat: true, tools: true });
    expect(loadWorldPanels("one")).toEqual({ chat: true, tools: false });
  });
});
