// @vitest-environment jsdom
import { flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import { InlineName } from "./board-scenes";

// Select the real browser runtimes for DOM tests in the Node test runner.
vi.mock("@solidjs/web", () => vi.importActual("../../node_modules/@solidjs/web/dist/web.dev.js"));
vi.mock("solid-js", () => vi.importActual("../../node_modules/solid-js/dist/solid.dev.js"));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

function editor(allowEmpty = false) {
  const saved: string[] = [];
  let closed = false;
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () =>
      InlineName({
        label: "Scene name",
        value: "Old scene",
        allowEmpty,
        save: (name) => saved.push(name),
        onClose: () => {
          closed = true;
        },
      }),
    host,
  );
  const input = host.querySelector("input")!;
  const form = host.querySelector("form")!;
  return {
    input,
    saved,
    closed: () => closed,
    submit(value: string) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      flush();
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    },
  };
}

it("focuses the inline name and trims a committed name", () => {
  const field = editor();
  expect(document.activeElement).toBe(field.input);
  field.submit("  Forest  ");
  expect(field.saved).toEqual(["Forest"]);
  expect(field.closed()).toBe(true);
});

it("rejects blank names but allows clearing a group", () => {
  const field = editor();
  field.submit("   ");
  expect(field.saved).toEqual([]);
  expect(field.closed()).toBe(false);
  dispose?.();
  const group = editor(true);
  group.submit("   ");
  expect(group.saved).toEqual([""]);
});

it("Escape cancels without committing or dismissing the containing popover", () => {
  const field = editor();
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  field.input.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(field.closed()).toBe(true);
  expect(field.saved).toEqual([]);
});
