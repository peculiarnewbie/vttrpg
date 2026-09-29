import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import {
  BoardElement,
  boardViewport,
  fitBoardRect,
  MIN_BOARD_FONT_SIZE,
  MAX_BOARD_FONT_SIZE,
  screenToBoard,
} from "../domain/board";
import {
  boardFontSize,
  pinchCamera,
  resizeBounds,
  resizeElement,
  resizeHandles,
  touchPair,
  wheelZoomFactor,
} from "./board-geometry";

const initial = { x: 100, y: 200, width: 200, height: 100 };
const text: BoardElement = { ...initial, id: "text", type: "text", text: "Into the woods" };

describe("precise wheel zoom", () => {
  it("limits large wheel ticks to gentle changes and reverses direction symmetrically", () => {
    expect(wheelZoomFactor(120, 0, 800)).toBeCloseTo(0.905, 3);
    expect(wheelZoomFactor(1200, 0, 800)).toBe(wheelZoomFactor(120, 0, 800));
    expect(wheelZoomFactor(120, 0, 800) * wheelZoomFactor(-120, 0, 800)).toBeCloseTo(1);
  });
  it("preserves fine trackpad deltas and normalizes line and page units", () => {
    expect(wheelZoomFactor(1, 0, 800)).toBeCloseTo(0.999, 5);
    expect(wheelZoomFactor(3, 1, 800)).toBe(wheelZoomFactor(48, 0, 800));
    expect(wheelZoomFactor(1, 2, 800)).toBe(wheelZoomFactor(800, 0, 800));
    expect(wheelZoomFactor(0, 0, 800)).toBe(1);
  });
});

describe("text scaling", () => {
  it.each(["nw", "ne", "sw", "se"] as const)(
    "scales legacy text from the %s corner around its opposite corner",
    (handle) => {
      const result = resizeElement({
        element: text,
        handle,
        delta: { x: handle.includes("w") ? -200 : 200, y: handle.includes("n") ? -100 : 100 },
      });
      expect(result.width).toBe(400);
      expect(result.height).toBe(200);
      expect(boardFontSize(result)).toBe(40);
      expect(result.x + (handle.includes("w") ? result.width : 0)).toBe(
        text.x + (handle.includes("w") ? text.width : 0),
      );
      expect(result.y + (handle.includes("n") ? result.height : 0)).toBe(
        text.y + (handle.includes("n") ? text.height : 0),
      );
      expect(boardFontSize(text)).toBe(20);
    },
  );

  it.each(["n", "s"] as const)(
    "scales from the %s edge while preserving the horizontal center",
    (handle) => {
      const result = resizeElement({
        element: text,
        handle,
        delta: { x: 800, y: handle === "n" ? -50 : 50 },
      });
      expect(boardFontSize(result)).toBe(30);
      expect(result.width).toBe(300);
      expect(result.height).toBe(150);
      expect(result.x + result.width / 2).toBe(text.x + text.width / 2);
    },
  );

  it.each(["w", "e"] as const)(
    "changes wrapping width from %s without scaling the letters",
    (handle) => {
      const element = { ...text, fontSize: 36 };
      const result = resizeElement({ element, handle, delta: { x: 80, y: 40 } });
      expect(boardFontSize(result)).toBe(36);
      expect(result.height).toBe(element.height);
      expect(result.width).toBe(handle === "w" ? 120 : 280);
    },
  );

  it("scales repeatedly from the saved font size and halts the whole card at font limits", () => {
    const larger = resizeElement({ element: text, handle: "se", delta: { x: 100, y: 50 } });
    const smaller = resizeElement({ element: larger, handle: "se", delta: { x: -100, y: -50 } });
    expect(boardFontSize(smaller)).toBe(20);
    expect(smaller.width).toBe(text.width);
    for (const [delta, fontSize] of [
      [-100000, MIN_BOARD_FONT_SIZE],
      [100000, MAX_BOARD_FONT_SIZE],
    ] as const) {
      const result = resizeElement({ element: text, handle: "se", delta: { x: delta, y: delta } });
      expect(boardFontSize(result)).toBe(fontSize);
      expect(result.width / text.width).toBeCloseTo(fontSize / 20);
      expect(result.height / text.height).toBeCloseTo(fontSize / 20);
    }
  });

  it("keeps every text handle publishable at coordinate, dimension, and font limits", () => {
    const decode = Schema.decodeUnknownResult(BoardElement);
    for (const x of [-100000, 0, 100000])
      for (const width of [24, 217.3, 8000])
        for (const fontSize of [8, 23.7, 512])
          for (const handle of resizeHandles)
            for (const delta of [-500000, 500000]) {
              const result = resizeElement({
                element: { ...text, x, y: x, width, fontSize },
                handle: handle.id,
                delta: { x: delta, y: delta },
              });
              expect(decode(result)._tag).toBe("Success");
            }
  });
});

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

describe("camera focus", () => {
  it("expresses the visible rectangle in board coordinates", () => {
    expect(boardViewport({ x: 80, y: -40, zoom: 2 }, { width: 1000, height: 600 })).toEqual({
      x: -40,
      y: 20,
      width: 500,
      height: 300,
    });
  });
  it("centers negative bounds and fits the limiting axis with toolbar clearance", () => {
    const rect = { x: -800, y: -500, width: 1600, height: 1000 };
    const camera = fitBoardRect(rect, { width: 1000, height: 600 });
    expect(camera.zoom).toBeCloseTo(0.44);
    expect(screenToBoard({ x: 500, y: 300 }, camera)).toEqual({ x: 0, y: 0 });
    expect(rect.width * camera.zoom).toBeLessThanOrEqual(920);
    expect(rect.height * camera.zoom).toBeLessThanOrEqual(440);
  });
  it("uses horizontal clearance for wide regions and respects existing zoom limits", () => {
    expect(
      fitBoardRect({ x: 0, y: 0, width: 2000, height: 100 }, { width: 1000, height: 600 }).zoom,
    ).toBe(0.46);
    expect(fitBoardRect(initial, { width: 1000, height: 600 }).zoom).toBe(1);
    expect(fitBoardRect(initial, { width: 0, height: 0 }).zoom).toBe(0.1);
    expect(fitBoardRect({ ...initial, width: 100000 }, { width: 1000, height: 600 }).zoom).toBe(
      0.1,
    );
  });
});
