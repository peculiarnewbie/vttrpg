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
  layerId: Schema.optionalKey(BoardAssetId),
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
export const MAX_BOARD_LAYERS = 12;
export const MAX_BOARD_SCENES = 50;
export const BoardLayer = Schema.Struct({
  id: BoardAssetId,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  locked: Schema.Boolean,
  hidden: Schema.Boolean,
});
export type BoardLayer = typeof BoardLayer.Type;
const Layers = Schema.Array(BoardLayer).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_BOARD_LAYERS),
  Schema.makeFilter((layers) => new Set(layers.map((layer) => layer.id)).size === layers.length),
);
export const BoardDocument = Schema.Struct({
  background: Schema.NullOr(BoardAssetId),
  layers: Schema.optionalKey(Layers),
  elements: Schema.Array(BoardElement).check(
    Schema.isMaxLength(MAX_BOARD_ELEMENTS),
    Schema.makeFilter(
      (elements) => new Set(elements.map((item) => item.id)).size === elements.length,
    ),
  ),
});
export type BoardDocument = typeof BoardDocument.Type;
export const BoardSnapshot = Schema.Struct({
  sceneId: Schema.optionalKey(BoardAssetId),
  sceneName: Schema.optionalKey(Schema.String),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  document: BoardDocument,
});
export type BoardSnapshot = typeof BoardSnapshot.Type;
export const PublishBoardInput = BoardSnapshot;
export const emptyBoard = (): BoardSnapshot => ({
  revision: 0,
  document: {
    background: null,
    elements: [],
    layers: [
      { id: "map", name: "Map", locked: false, hidden: false },
      { id: "tokens", name: "Tokens", locked: false, hidden: false },
    ],
  },
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

export function normalizeBoard(
  document: BoardDocument,
): BoardDocument & { layers: readonly BoardLayer[] } {
  const layers = document.layers?.length
    ? document.layers
    : [{ id: "default", name: "Default", locked: false, hidden: false }];
  return {
    ...document,
    layers,
    elements: document.elements.map((element) => ({
      ...element,
      layerId: layers.some((layer) => layer.id === element.layerId)
        ? element.layerId
        : layers[0].id,
    })),
  };
}
export function orderedBoardElements(document: BoardDocument): readonly BoardElement[] {
  const normalized = normalizeBoard(document);
  return normalized.layers.flatMap((layer) =>
    normalized.elements.filter((element) => element.layerId === layer.id),
  );
}
export function stripHiddenLayers(snapshot: BoardSnapshot): BoardSnapshot {
  const document = normalizeBoard(snapshot.document);
  const visible = document.layers.filter((layer) => !layer.hidden);
  return {
    ...snapshot,
    document: {
      ...document,
      layers: visible.length
        ? visible
        : [{ id: "default", name: "Default", locked: false, hidden: false }],
      elements: document.elements.filter((element) =>
        visible.some((layer) => layer.id === element.layerId),
      ),
    },
  };
}
export function orderBoardElement(
  document: BoardDocument,
  id: string,
  edge: "front" | "back",
): BoardDocument {
  const normalized = normalizeBoard(document);
  const element = normalized.elements.find((item) => item.id === id);
  if (!element) return normalized;
  const others = normalized.elements.filter((item) => item.id !== id);
  return {
    ...normalized,
    elements: edge === "front" ? [...others, element] : [element, ...others],
  };
}
export function deleteBoardLayer(document: BoardDocument, id: string): BoardDocument {
  const normalized = normalizeBoard(document);
  if (normalized.layers.length === 1) return normalized;
  const index = normalized.layers.findIndex((layer) => layer.id === id);
  if (index < 0) return normalized;
  const target = normalized.layers[index > 0 ? index - 1 : 1];
  return {
    ...normalized,
    layers: normalized.layers.filter((layer) => layer.id !== id),
    elements: normalized.elements.map((element) =>
      element.layerId === id ? { ...element, layerId: target.id } : element,
    ),
  };
}
export const SceneName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100));
export const CreateSceneInput = Schema.Struct({
  name: SceneName,
  duplicateFrom: Schema.optionalKey(BoardAssetId),
});
export const UpdateSceneInput = Schema.Struct({
  name: Schema.optionalKey(SceneName),
  group: Schema.optionalKey(Schema.NullOr(SceneName)),
  sort: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_BOARD_SCENES - 1 })),
  ),
});
export const SceneMetadata = Schema.Struct({
  id: BoardAssetId,
  name: SceneName,
  group: Schema.NullOr(SceneName),
  sort: Schema.Int,
  revision: Schema.Int,
  updatedAt: Schema.String,
  elementCount: Schema.Int,
});
export type SceneMetadata = typeof SceneMetadata.Type;
export const SceneList = Schema.Struct({
  scenes: Schema.Array(SceneMetadata),
  activeSceneId: BoardAssetId,
});
export type SceneList = typeof SceneList.Type;
