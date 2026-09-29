// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { loadDiceTotals, setShowDiceTotals, showDiceTotals } from "./dice-display";

afterEach(() => {
  vi.unstubAllGlobals();
  setShowDiceTotals(true);
  localStorage.clear();
});

it("defaults to visible totals for missing or unrecognized preferences", () => {
  expect(loadDiceTotals()).toBe(true);
  localStorage.setItem("ttrpg:dice-display", "invalid");
  expect(loadDiceTotals()).toBe(true);
});

it("shares the current setting and persists it for the next visit", () => {
  setShowDiceTotals(false);
  expect(showDiceTotals()).toBe(false);
  expect(loadDiceTotals()).toBe(false);
  setShowDiceTotals(true);
  expect(showDiceTotals()).toBe(true);
  expect(loadDiceTotals()).toBe(true);
});

it("keeps the toggle usable when browser storage is unavailable", () => {
  vi.stubGlobal("localStorage", undefined);
  expect(loadDiceTotals()).toBe(true);
  setShowDiceTotals(false);
  expect(showDiceTotals()).toBe(false);
  setShowDiceTotals(true);
  expect(showDiceTotals()).toBe(true);
});
