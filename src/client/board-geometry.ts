import {
  DEFAULT_BOARD_FONT_SIZE,
  MIN_BOARD_FONT_SIZE,
  MAX_BOARD_FONT_SIZE,
  screenToBoard,
  zoomAt,
  type BoardCamera,
  type BoardElement,
} from "../domain/board";

export type Point = { x: number; y: number };
export type BoardBounds = Pick<BoardElement, "x" | "y" | "width" | "height">;
export const resizeHandles = [
  { id: "nw", x: 0, y: 0, label: "top left" },
  { id: "n", x: 0.5, y: 0, label: "top" },
  { id: "ne", x: 1, y: 0, label: "top right" },
  { id: "e", x: 1, y: 0.5, label: "right" },
  { id: "se", x: 1, y: 1, label: "bottom right" },
  { id: "s", x: 0.5, y: 1, label: "bottom" },
  { id: "sw", x: 0, y: 1, label: "bottom left" },
  { id: "w", x: 0, y: 0.5, label: "left" },
] as const;
export type ResizeHandle = (typeof resizeHandles)[number]["id"];
export const clampCoordinate = (value: number) => Math.max(-100000, Math.min(100000, value));

// Normalize wheel units and cap large mouse-wheel ticks without losing trackpad precision.
export function wheelZoomFactor(deltaY: number, deltaMode: number, pageHeight: number) {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1);
  return Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.001);
}

export function resizeBounds({
  initial,
  handle,
  delta,
  keepRatio,
  scaleLimits,
}: {
  initial: BoardBounds;
  handle: ResizeHandle;
  delta: Point;
  keepRatio: boolean;
  scaleLimits?: { min: number; max: number };
}): BoardBounds {
  const west = handle.includes("w"),
    east = handle.includes("e");
  const north = handle.includes("n"),
    south = handle.includes("s");
  const right = initial.x + initial.width,
    bottom = initial.y + initial.height;
  // Keep the opposite edge anchored, including at the storage coordinate limits.
  const minWidth = west ? Math.max(24, right - 100000) : 24;
  const minHeight = north ? Math.max(24, bottom - 100000) : 24;
  const maxWidth = west ? Math.min(8000, right + 100000) : 8000;
  const maxHeight = north ? Math.min(8000, bottom + 100000) : 8000;
  let width = initial.width + (west ? -delta.x : east ? delta.x : 0);
  let height = initial.height + (north ? -delta.y : south ? delta.y : 0);
  if (keepRatio && handle.length === 2) {
    const scaleX = width / initial.width,
      scaleY = height / initial.height;
    const requested = Math.abs(scaleX - 1) > Math.abs(scaleY - 1) ? scaleX : scaleY;
    const scale = Math.max(
      minWidth / initial.width,
      minHeight / initial.height,
      scaleLimits?.min ?? 0,
      Math.min(
        maxWidth / initial.width,
        maxHeight / initial.height,
        scaleLimits?.max ?? Infinity,
        requested,
      ),
    );
    width = initial.width * scale;
    height = initial.height * scale;
  } else {
    width = Math.max(minWidth, Math.min(maxWidth, width));
    height = Math.max(minHeight, Math.min(maxHeight, height));
  }
  return {
    x: west ? right - width : initial.x,
    y: north ? bottom - height : initial.y,
    width,
    height,
  };
}

export const boardFontSize = (element: BoardElement) =>
  element.type === "text" ? (element.fontSize ?? DEFAULT_BOARD_FONT_SIZE) : DEFAULT_BOARD_FONT_SIZE;

export function resizeElement({
  element,
  handle,
  delta,
  unlockImageRatio = false,
}: {
  element: BoardElement;
  handle: ResizeHandle;
  delta: Point;
  unlockImageRatio?: boolean;
}): BoardElement {
  if (element.type === "image" || handle === "e" || handle === "w")
    return {
      ...element,
      ...resizeBounds({ initial: element, handle, delta, keepRatio: !unlockImageRatio }),
    };

  // Text corners (and top/bottom handles) scale glyphs and card together.
  // Left/right handles above change the wrapping width without changing the font.
  const fontSize = boardFontSize(element);
  const vertical = handle === "n" || handle === "s";
  const centerX = element.x + element.width / 2;
  const bounds = resizeBounds({
    initial: element,
    handle: handle === "n" ? "ne" : handle === "s" ? "se" : handle,
    delta: vertical ? { x: 0, y: delta.y } : delta,
    keepRatio: true,
    scaleLimits: {
      min: Math.max(
        MIN_BOARD_FONT_SIZE / fontSize,
        vertical ? (2 * (centerX - 100000)) / element.width : 0,
      ),
      max: Math.min(
        MAX_BOARD_FONT_SIZE / fontSize,
        vertical ? (2 * (centerX + 100000)) / element.width : Infinity,
      ),
    },
  });
  return {
    ...element,
    ...bounds,
    x: vertical ? clampCoordinate(centerX - bounds.width / 2) : bounds.x,
    fontSize: Math.max(
      MIN_BOARD_FONT_SIZE,
      Math.min(MAX_BOARD_FONT_SIZE, (fontSize * bounds.width) / element.width),
    ),
  };
}

export const touchPair = (points: readonly [Point, Point]) => ({
  center: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
  distance: Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)),
});

export function pinchCamera({
  camera,
  initial,
  current,
}: {
  camera: BoardCamera;
  initial: ReturnType<typeof touchPair>;
  current: ReturnType<typeof touchPair>;
}): BoardCamera {
  const anchor = screenToBoard(initial.center, camera);
  const zoom = zoomAt(
    camera,
    initial.center,
    (camera.zoom * current.distance) / initial.distance,
  ).zoom;
  return { x: current.center.x - anchor.x * zoom, y: current.center.y - anchor.y * zoom, zoom };
}
