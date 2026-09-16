import * as Schema from "effect/Schema";

export const MAX_BOARD_ELEMENTS = 100;
export const MAX_BOARD_IMAGE_BYTES = 5 * 1024 * 1024;
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
