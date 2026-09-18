import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { BoardElement, screenToBoard } from "../domain/board";
import { pinchCamera, resizeBounds, resizeHandles, touchPair } from "./board-geometry";

const initial = { x: 100, y: 200, width: 200, height: 100 };

describe("direct board resizing", () => {
  it.each([
    ["nw", { x: 140, y: 220, width: 160, height: 80 }],
    ["n", { x: 100, y: 220, width: 200, height: 80 }],
    ["ne", { x: 100, y: 220, width: 240, height: 80 }],
    ["e", { x: 100, y: 200, width: 240, height: 100 }],
    ["se", { x: 100, y: 200, width: 240, height: 120 }],
    ["s", { x: 100, y: 200, width: 200, height: 120 }],
    ["sw", { x: 140, y: 200, width: 160, height: 120 }],
    ["w", { x: 140, y: 200, width: 160, height: 100 }],
  ] as const)("anchors the opposite edge when resizing %s", (handle, expected) => {
    expect(resizeBounds({ initial, handle, delta: { x: 40, y: 20 }, keepRatio: false })).toEqual(
      expected,
    );
  });

  it("preserves an image's ratio around the opposite corner", () => {
    const result = resizeBounds({
      initial,
      handle: "nw",
      delta: { x: -100, y: -20 },
      keepRatio: true,
    });
    expect(result.width / result.height).toBe(2);
    expect(result.x + result.width).toBe(initial.x + initial.width);
    expect(result.y + result.height).toBe(initial.y + initial.height);
    expect(result.width).toBe(300);
  });

  it("keeps extreme drags and crossing the opposite edge publishable", () => {
    const decode = Schema.decodeUnknownResult(BoardElement);
    for (const x of [-100000, 0, 100000])
      for (const width of [24, 200, 8000])
        for (const handle of resizeHandles)
          for (const delta of [
            { x: -500000, y: -500000 },
            { x: 500000, y: 500000 },
          ])
            for (const keepRatio of [false, true]) {
              const bounds = resizeBounds({
                initial: { x, y: x, width, height: 100 },
                handle: handle.id,
                delta,
                keepRatio,
              });
              expect(decode({ ...bounds, id: "test", type: "text", text: "" })._tag).toBe(
                "Success",
              );
              if (keepRatio && handle.id.length === 2)
                expect(bounds.width / bounds.height).toBeCloseTo(width / 100);
            }
  });
});

describe("two finger board navigation", () => {
  it("zooms and pans around the scene point between the fingers", () => {
    const camera = { x: -150, y: 75, zoom: 0.5 };
    const initial = touchPair([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    const current = touchPair([
      { x: 80, y: 140 },
      { x: 280, y: 140 },
    ]);
    const result = pinchCamera({ camera, initial, current });
    expect(result.zoom).toBe(1);
    expect(screenToBoard(current.center, result)).toEqual(screenToBoard(initial.center, camera));
  });

  it("anchors the midpoint at zoom limits and handles coincident fingers", () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const initial = touchPair([
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    ]);
    const current = touchPair([
      { x: 0, y: 100 },
      { x: 400, y: 100 },
    ]);
    const result = pinchCamera({ camera, initial, current });
    expect(result.zoom).toBe(4);
    expect(screenToBoard(current.center, result)).toEqual(screenToBoard(initial.center, camera));
  });
});
