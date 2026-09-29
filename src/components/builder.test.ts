// @vitest-environment jsdom
import { flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BuilderPanel, idFromLabel } from "./builder";

vi.mock("@solidjs/web", () => vi.importActual("../../node_modules/@solidjs/web/dist/web.dev.js"));
vi.mock("solid-js", () => vi.importActual("../../node_modules/solid-js/dist/solid.dev.js"));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

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

it("defaults old trackers to Auto and preserves a display selection when editing the tracker", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () =>
      BuilderPanel({
        worldId: "world",
        templates: [
          {
            id: "sheet",
            worldId: "world",
            name: "Sheet",
            fields: [],
            stats: [],
            rolls: [],
            tickers: [{ id: "guard", label: "Guard", min: 0, max: 10, defaultValue: 10 }],
            updatedAt: "2026-09-29T00:00:00.000Z",
          },
        ],
        onTemplates: () => {},
      }),
    host,
  );

  const display = () =>
    Array.from(host.querySelectorAll("select")).find(
      (select) => select.getAttribute("aria-label") === "Guard display",
    )!;
  expect(display().value).toBe("auto");
  expect(Array.from(display().options, (option) => option.text)).toEqual([
    "Auto",
    "Pips",
    "Bar",
    "Number",
  ]);
  for (const value of ["pips", "bar", "number", "auto"]) {
    display().value = value;
    display().dispatchEvent(new Event("change", { bubbles: true }));
    flush();
    expect(display().value).toBe(value);
    const max = host.querySelectorAll<HTMLInputElement>('input[type="number"]')[1];
    max.value = "14";
    max.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    expect(display().value).toBe(value);
    expect(host.querySelectorAll<HTMLInputElement>('input[type="number"]')[2].value).toBe("14");
  }
});
