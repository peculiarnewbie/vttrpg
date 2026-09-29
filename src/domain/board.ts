import * as Schema from "effect/Schema";

export const MAX_BOARD_ELEMENTS = 100;
export const MAX_BOARD_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_BOARD_IMAGE_PIXELS = 4096;
export const DEFAULT_BOARD_FONT_SIZE = 20;
export const MIN_BOARD_FONT_SIZE = 8;
export const MAX_BOARD_FONT_SIZE = 512;
export const BoardAssetId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,80}$/));
const Coordinate = Schema.Finite.check(Schema.isBetween({ minimum: -100000, maximum: 100000 }));
const Dimension = Schema.Finite.check(Schema.isBetween({ minimum: 24, maximum: 8000 }));
const geometry = {
  id: BoardAssetId,
  x: Coordinate,
  y: Coordinate,
  width: Dimension,
  height: Dimension,
};
export const BoardElement = Schema.Union([
  Schema.Struct({
    ...geometry,
    type: Schema.Literal("image"),
    assetId: BoardAssetId,
    label: Schema.String.check(Schema.isMaxLength(200)),
  }),
  Schema.Struct({
    ...geometry,
    type: Schema.Literal("text"),
    text: Schema.String.check(Schema.isMaxLength(2000)),
    // Older snapshots omit this field and render at DEFAULT_BOARD_FONT_SIZE.
    fontSize: Schema.optionalKey(
      Schema.Finite.check(
        Schema.isBetween({ minimum: MIN_BOARD_FONT_SIZE, maximum: MAX_BOARD_FONT_SIZE }),
      ),
    ),
  }),
]);
export type BoardElement = typeof BoardElement.Type;
export const BoardDocument = Schema.Struct({
  background: Schema.NullOr(BoardAssetId),
  elements: Schema.Array(BoardElement).check(
    Schema.isMaxLength(MAX_BOARD_ELEMENTS),
    Schema.makeFilter(
      (elements) => new Set(elements.map((item) => item.id)).size === elements.length,
    ),
  ),
});
export type BoardDocument = typeof BoardDocument.Type;
export const BoardSnapshot = Schema.Struct({
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  document: BoardDocument,
});
export type BoardSnapshot = typeof BoardSnapshot.Type;
export const PublishBoardInput = BoardSnapshot;
export const emptyBoard = (): BoardSnapshot => ({
  revision: 0,
  document: { background: null, elements: [] },
});

export type BoardCamera = { x: number; y: number; zoom: number };
export const screenToBoard = (point: { x: number; y: number }, camera: BoardCamera) => ({
  x: (point.x - camera.x) / camera.zoom,
  y: (point.y - camera.y) / camera.zoom,
});
export const zoomAt = (
  camera: BoardCamera,
  point: { x: number; y: number },
  zoom: number,
): BoardCamera => {
  const nextZoom = Math.max(0.1, Math.min(4, zoom));
  const anchor = screenToBoard(point, camera);
  return { x: point.x - anchor.x * nextZoom, y: point.y - anchor.y * nextZoom, zoom: nextZoom };
};
export const isElementVisible = (
  element: BoardElement,
  camera: BoardCamera,
  size: { width: number; height: number },
) => {
  const padding = 200;
  return (
    (element.x + element.width) * camera.zoom + camera.x >= -padding &&
    (element.y + element.height) * camera.zoom + camera.y >= -padding &&
    element.x * camera.zoom + camera.x <= size.width + padding &&
    element.y * camera.zoom + camera.y <= size.height + padding
  );
};

// Camera rectangles can extend beyond element storage bounds when panning or zooming out.
export const BoardFocusRect = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite.check(Schema.isGreaterThan(0)),
  height: Schema.Finite.check(Schema.isGreaterThan(0)),
});
export type BoardFocusRect = typeof BoardFocusRect.Type;

export const boardViewport = (
  camera: BoardCamera,
  size: { width: number; height: number },
): BoardFocusRect => ({
  ...screenToBoard({ x: 0, y: 0 }, camera),
  width: size.width / camera.zoom,
  height: size.height / camera.zoom,
});

export function fitBoardRect(
  rect: BoardFocusRect,
  size: { width: number; height: number },
): BoardCamera {
  const zoom = zoomAt(
    { x: 0, y: 0, zoom: 1 },
    { x: 0, y: 0 },
    Math.min(
      1,
      Math.max(1, size.width - 80) / rect.width,
      Math.max(1, size.height - 160) / rect.height,
    ),
  ).zoom;
  return {
    x: size.width / 2 - (rect.x + rect.width / 2) * zoom,
    y: size.height / 2 - (rect.y + rect.height / 2) * zoom,
    zoom,
  };
}
