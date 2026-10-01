import { afterEach, expect, it, vi } from "vitest";
import type { IndexRow } from "../domain/compendium-index";
import { connectWorld } from "./realtime";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn<(data: string) => void>();
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}
const row: IndexRow = {
  id: "world/item/rope",
  typeId: "item",
  name: "Rope",
  tags: [],
  visibility: "public",
  rev: 1,
  updatedAt: "now",
};
const setup = () => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("location", { protocol: "https:", host: "table.test" });
  const onFrame = vi.fn();
  const onStatus = vi.fn();
  const controller = connectWorld("world", { onFrame, onStatus });
  const socket = FakeWebSocket.instances[0];
  return { controller, socket, onFrame, onStatus };
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const sent = (socket: FakeWebSocket, index = 0) => JSON.parse(socket.send.mock.calls[index][0]);

it("sends schema-validated searches with unique ids and matches replies out of order", async () => {
  const { controller, socket, onFrame, onStatus } = setup();
  expect(socket.url).toBe("wss://table.test/api/worlds/world/ws");
  socket.open();
  const first = controller.search({ query: "rope", typeIds: ["item"], limit: 10 });
  const second = controller.search({ query: "sword" });
  expect(sent(socket)).toEqual({
    type: "search",
    requestId: "s1",
    query: "rope",
    typeIds: ["item"],
    limit: 10,
  });
  expect(sent(socket, 1).requestId).toBe("s2");
  const reply = { type: "search.result", requestId: "s2", results: [row] };
  socket.receive(reply);
  expect(await second).toEqual([row]);
  socket.receive({ type: "search.result", requestId: "s1", results: [] });
  expect(await first).toEqual([]);
  expect(onFrame).toHaveBeenCalledWith(reply);
  expect(onStatus.mock.calls.flat()).toEqual(["connecting", "open"]);
  expect(vi.getTimerCount()).toBe(0);
  controller.close();
});

it("rejects only the search matching an error and forwards every valid frame", async () => {
  const { controller, socket, onFrame } = setup();
  socket.open();
  const first = controller.search({ query: "rope" });
  const rejected = expect(first).rejects.toThrow("denied");
  const second = controller.search({ query: "sword" });
  socket.receive({ type: "error", requestId: "s1", message: "denied" });
  await rejected;
  socket.receive({ type: "error", message: "unrelated" });
  socket.receive({ type: "search.result", requestId: "unknown", results: [] });
  socket.receive({ type: "compendium.updated", rev: 2 });
  socket.receive({ type: "search.result", requestId: "s2", results: [row] });
  expect(await second).toEqual([row]);
  expect(onFrame).toHaveBeenCalledTimes(5);
  expect(vi.getTimerCount()).toBe(0);
  controller.close();
});

it("rejects after five seconds and still forwards a late reply", async () => {
  const { controller, socket, onFrame } = setup();
  socket.open();
  const promise = controller.search({ query: "rope" });
  const rejected = expect(promise).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(4999);
  expect(onFrame).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  socket.receive({ type: "search.result", requestId: "s1", results: [row] });
  expect(onFrame).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  controller.close();
});

it("holds frames and searches sent while connecting until the socket opens", async () => {
  const { controller, socket } = setup();
  controller.send({ type: "cursor", position: null });
  controller.send({
    type: "chat",
    content: "early",
    kind: "ooc",
    visibility: "public",
    recipientMemberIds: [],
  });
  const search = controller.search({ query: "rope" });
  expect(socket.send).not.toHaveBeenCalled();
  socket.open();
  expect(sent(socket, 0)).toMatchObject({ type: "chat", content: "early" });
  const request = sent(socket, 1);
  expect(request).toMatchObject({ type: "search", query: "rope" });
  socket.receive({ type: "search.result", requestId: request.requestId, results: [row] });
  await expect(search).resolves.toEqual([row]);
});

it("drops a waiting search that times out before the socket opens", async () => {
  const { controller, socket } = setup();
  const search = controller.search({ query: "rope" });
  vi.advanceTimersByTime(5000);
  await expect(search).rejects.toThrow("timed out");
  socket.open();
  expect(socket.send).not.toHaveBeenCalled();
});

it("rejects invalid searches without sending, and every search once closed", async () => {
  const { controller, socket } = setup();
  socket.open();
  await expect(controller.search({ query: "x".repeat(121) })).rejects.toThrow("Invalid");
  await expect(controller.search({ query: "rope", limit: 51 })).rejects.toThrow("Invalid");
  expect(socket.send).not.toHaveBeenCalled();
  controller.close();
  await expect(controller.search({ query: "rope" })).rejects.toThrow("closed");
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects every pending request on disconnect and searches again after reconnect", async () => {
  const { controller, socket } = setup();
  socket.open();
  const first = expect(controller.search({ query: "rope" })).rejects.toThrow("closed");
  const second = expect(controller.search({ query: "sword" })).rejects.toThrow("closed");
  socket.close();
  await Promise.all([first, second]);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1500);
  const next = FakeWebSocket.instances[1];
  next.open();
  const third = controller.search({ query: "shield" });
  expect(sent(next).requestId).toBe("s3");
  next.receive({ type: "search.result", requestId: "s3", results: [row] });
  expect(await third).toEqual([row]);
  controller.close();
});

it("explicit close rejects pending requests immediately and cancels reconnect", async () => {
  const { controller, socket } = setup();
  socket.open();
  const rejected = expect(controller.search({ query: "rope" })).rejects.toThrow("closed");
  controller.close();
  await rejected;
  await vi.advanceTimersByTimeAsync(10000);
  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("ignores malformed frames and cleans up when send throws", async () => {
  const { controller, socket, onFrame } = setup();
  socket.open();
  socket.onmessage?.({ data: "invalid json" });
  socket.receive({ type: "search.result", requestId: "s1", results: [{ id: "bad" }] });
  expect(onFrame).not.toHaveBeenCalled();
  socket.send.mockImplementationOnce(() => {
    throw new Error("send failed");
  });
  await expect(controller.search({ query: "rope" })).rejects.toThrow("send failed");
  expect(vi.getTimerCount()).toBe(0);
  controller.close();
});
