// @vitest-environment jsdom
import { flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme/theme-context";
import { ThemeToggle } from "./ui";

vi.mock("@solidjs/web", () => vi.importActual("../../node_modules/@solidjs/web/dist/web.dev.js"));
vi.mock("solid-js", () => vi.importActual("../../node_modules/solid-js/dist/solid.dev.js"));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  localStorage.clear();
});

function picker() {
  localStorage.setItem("ttrpg.theme", "rulebook");
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () =>
      ThemeProvider({
        get children() {
          return ThemeToggle();
        },
      }),
    host,
  );
  return {
    host,
    trigger: host.querySelector<HTMLButtonElement>("button")!,
    choices: () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')),
  };
}

it("offers all three themes, persists selection, and marks only the selected theme", async () => {
  const ui = picker();
  ui.trigger.click();
  flush();
  await Promise.resolve();
  expect(ui.choices().map((item) => item.textContent?.replace("✓", "").trim())).toEqual([
    "Rulebook",
    "OSR zine",
    "Dark fantasy",
  ]);
  expect(ui.host.querySelector('[role="group"]')?.getAttribute("aria-labelledby")).toBeTruthy();
  for (const [index, name] of ["rulebook", "zine", "fantasy"].entries()) {
    ui.choices()[index].click();
    flush();
    expect(localStorage.getItem("ttrpg.theme")).toBe(name);
    expect(ui.trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(ui.trigger);
    ui.trigger.click();
    flush();
    await Promise.resolve();
    expect(ui.choices().map((item) => item.getAttribute("aria-checked"))).toEqual(
      [0, 1, 2].map((i) => String(i === index)),
    );
  }
});

it("supports arrow navigation and Escape returns focus to the trigger", async () => {
  const ui = picker();
  ui.trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  flush();
  await Promise.resolve();
  expect(document.activeElement).toBe(ui.choices()[2]);
  ui.choices()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(document.activeElement).toBe(ui.choices()[0]);
  ui.choices()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
  expect(document.activeElement).toBe(ui.choices()[2]);
  ui.choices()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  flush();
  expect(ui.choices()).toHaveLength(0);
  expect(document.activeElement).toBe(ui.trigger);
});
