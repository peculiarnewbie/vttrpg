import { ClientFrame, ServerFrame } from "./schemas";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  BoardSnapshot,
  emptyBoard,
  normalizeBoard,
  orderedBoardElements,
  orderBoardElement,
  deleteBoardLayer,
  stripHiddenLayers,
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
  it("accepts legacy text without a font size and preserves explicit font sizes", () => {
    expect(decode(valid)._tag).toBe("Success");
    const sized = {
      ...valid,
      document: { ...valid.document, elements: [{ ...element, fontSize: 42.5 }] },
    };
    expect(Schema.decodeUnknownSync(BoardSnapshot)(sized)).toEqual(sized);
  });
  it.each([
    { ...element, x: Infinity },
    { ...element, y: NaN },
    { ...element, width: -10 },
    { ...element, height: 9000 },
    { ...element, type: "script" },
    { ...element, text: "x".repeat(2001) },
    { ...element, id: "../other-world" },
    { ...element, fontSize: 0 },
    { ...element, fontSize: 513 },
    { ...element, fontSize: Infinity },
    { ...element, fontSize: "large" },
    { ...element, fontSize: null },
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

describe("board focus frames", () => {
  const rect = { x: -200, y: 400, width: 2000, height: 1000 };
  it("accepts client requests and server cues without changing the board document", () => {
    expect(Schema.decodeUnknownResult(ClientFrame)({ type: "board.focus", rect })._tag).toBe(
      "Success",
    );
    expect(
      Schema.decodeUnknownResult(ServerFrame)({ type: "board.focus", rect, from: "DM" })._tag,
    ).toBe("Success");
    expect(Schema.decodeUnknownResult(ServerFrame)({ type: "board.focus", rect })._tag).toBe(
      "Failure",
    );
  });
  it.each([
    { width: 0 },
    { height: -1 },
    { x: Infinity },
    { y: NaN },
    { width: "200" },
    { height: null },
  ])("rejects malformed focus geometry: %j", (invalid) => {
    const frame = { type: "board.focus", rect: { ...rect, ...invalid }, from: "DM" };
    expect(Schema.decodeUnknownResult(ClientFrame)(frame)._tag).toBe("Failure");
    expect(Schema.decodeUnknownResult(ServerFrame)(frame)._tag).toBe("Failure");
  });
});

describe("board layers", () => {
  const layers = [
    { id: "map", name: "Map", locked: true, hidden: false },
    { id: "secret", name: "DM prep", locked: false, hidden: true },
    { id: "tokens", name: "Tokens", locked: false, hidden: false },
  ];
  const document = {
    background: "ambient",
    layers,
    elements: [
      { ...element, id: "token-a", layerId: "tokens" },
      { ...element, id: "map-a", layerId: "map" },
      { ...element, id: "hidden", layerId: "secret", text: "A secret", assetId: "private-asset" },
      { ...element, id: "token-b", layerId: "tokens" },
      { ...element, id: "map-b", layerId: "map" },
    ],
  };
  const order = (document: Parameters<typeof orderedBoardElements>[0]) =>
    orderedBoardElements(document).map((item) => item.id);
  it("normalizes legacy documents without changing their content or order", () => {
    const normalized = normalizeBoard(valid.document);
    expect(normalized.layers).toEqual([
      { id: "default", name: "Default", locked: false, hidden: false },
    ]);
    expect(normalized.elements).toEqual([{ ...element, layerId: "default" }]);
    expect(normalized.background).toBe("forest");
    expect(normalizeBoard(normalized)).toEqual(normalized);
    expect(
      normalizeBoard({ ...document, elements: [{ ...element, layerId: "missing" }] }).elements[0]
        .layerId,
    ).toBe("map");
  });
  it("renders by layer, preserving order within each layer", () => {
    expect(order(document)).toEqual(["map-a", "map-b", "hidden", "token-a", "token-b"]);
    expect(order(orderBoardElement(document, "map-a", "front"))).toEqual([
      "map-b",
      "map-a",
      "hidden",
      "token-a",
      "token-b",
    ]);
    expect(order(orderBoardElement(document, "token-b", "back"))).toEqual([
      "map-a",
      "map-b",
      "hidden",
      "token-b",
      "token-a",
    ]);
    expect(order({ ...document, layers: [...layers].reverse() })).toEqual([
      "token-a",
      "token-b",
      "hidden",
      "map-a",
      "map-b",
    ]);
  });
  it("strips hidden elements and metadata without mutating the DM snapshot", () => {
    const snapshot = { revision: 7, sceneId: "scene", sceneName: "Live", document };
    const visible = stripHiddenLayers(snapshot);
    expect(visible.revision).toBe(7);
    expect(visible.sceneId).toBe("scene");
    expect(visible.document.background).toBe("ambient");
    expect(visible.document.layers?.map((layer) => layer.id)).toEqual(["map", "tokens"]);
    expect(visible.document.elements.map((item) => item.id)).not.toContain("hidden");
    expect(JSON.stringify(visible)).not.toContain("A secret");
    expect(JSON.stringify(visible)).not.toContain("private-asset");
    expect(snapshot.document.elements).toHaveLength(5);
    const allHidden = stripHiddenLayers({
      ...snapshot,
      document: { ...document, layers: layers.map((layer) => ({ ...layer, hidden: true })) },
    });
    expect(allHidden.document.elements).toEqual([]);
    expect(decode(allHidden)._tag).toBe("Success");
  });
  it("moves deleted layer elements to the layer below, preserving the last layer", () => {
    const next = deleteBoardLayer(document, "secret");
    expect(next.layers?.map((layer) => layer.id)).toEqual(["map", "tokens"]);
    expect(next.elements.find((item) => item.id === "hidden")?.layerId).toBe("map");
    expect(
      deleteBoardLayer(document, "map").elements.find((item) => item.id === "map-a")?.layerId,
    ).toBe("secret");
    const single = normalizeBoard(valid.document);
    expect(deleteBoardLayer(single, "default")).toEqual(single);
  });
  it("limits layers and rejects duplicate IDs and malformed fields", () => {
    for (const invalid of [
      [],
      [layers[0], layers[0]],
      Array.from({ length: 13 }, (_, id) => ({ ...layers[0], id: `layer-${id}` })),
      [{ ...layers[0], locked: "yes" }],
    ]) {
      expect(decode({ ...valid, document: { ...valid.document, layers: invalid } })._tag).toBe(
        "Failure",
      );
    }
  });
});
