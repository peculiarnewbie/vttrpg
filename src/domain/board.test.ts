import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  BoardSnapshot,
  emptyBoard,
  isElementVisible,
  screenToBoard,
  zoomAt,
  type BoardElement,
} from "./board";

const element: BoardElement = {
  id: "note",
  type: "text",
  text: "The old forest",
  x: 100,
  y: -50,
  width: 200,
  height: 100,
};
const valid = { revision: 1, document: { background: "forest", elements: [element] } };
const decode = Schema.decodeUnknownResult(BoardSnapshot);

describe("board boundary", () => {
  it("accepts empty and populated snapshots", () => {
    expect(decode(emptyBoard())._tag).toBe("Success");
    expect(decode(valid)._tag).toBe("Success");
  });
  it.each([
    { ...element, x: Infinity },
    { ...element, y: NaN },
    { ...element, width: -10 },
    { ...element, height: 9000 },
    { ...element, type: "script" },
    { ...element, text: "x".repeat(2001) },
    { ...element, id: "../other-world" },
  ])("rejects malformed geometry, content, and IDs: %j", (invalid) => {
    expect(decode({ ...valid, document: { ...valid.document, elements: [invalid] } })._tag).toBe(
      "Failure",
    );
  });
  it("rejects duplicate IDs, oversized boards, and arbitrary image URLs", () => {
    for (const elements of [
      [element, element],
      Array.from({ length: 101 }, (_, index) => ({ ...element, id: `note-${index}` })),
    ]) {
      expect(decode({ ...valid, document: { background: null, elements } })._tag).toBe("Failure");
    }
    expect(
      decode({ ...valid, document: { background: "https://example.com/a.png", elements: [] } })
        ._tag,
    ).toBe("Failure");
  });
});

describe("board camera", () => {
  it("keeps the point under the cursor anchored while zooming", () => {
    const camera = { x: -145, y: 230, zoom: 0.75 },
      point = { x: 390, y: 180 };
    const before = screenToBoard(point, camera);
    const after = screenToBoard(point, zoomAt(camera, point, 2));
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
  it("bounds zoom and retains partially visible elements", () => {
    const camera = { x: 0, y: 0, zoom: 1 },
      size = { width: 800, height: 600 };
    expect(zoomAt(camera, { x: 0, y: 0 }, 100).zoom).toBe(4);
    expect(zoomAt(camera, { x: 0, y: 0 }, 0).zoom).toBe(0.1);
    expect(isElementVisible(element, camera, size)).toBe(true);
    expect(isElementVisible({ ...element, x: 2000 }, camera, size)).toBe(false);
    expect(isElementVisible({ ...element, x: 2000 }, { x: -1800, y: 0, zoom: 1 }, size)).toBe(true);
  });
});
