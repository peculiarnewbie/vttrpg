import { screenToBoard, zoomAt, type BoardCamera, type BoardElement } from "../domain/board";

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

export function resizeBounds({
  initial,
  handle,
  delta,
  keepRatio,
}: {
  initial: BoardBounds;
  handle: ResizeHandle;
  delta: Point;
  keepRatio: boolean;
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
      Math.min(maxWidth / initial.width, maxHeight / initial.height, requested),
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
