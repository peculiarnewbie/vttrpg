// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Schema from "effect/Schema";
import { ClientFrame, type CursorPosition } from "../domain/schemas";
import { createCursorPublisher, loadLiveCursors, saveLiveCursors } from "./live-cursors";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("live cursor publishing", () => {
  it("sends immediately then coalesces movement to the latest position at 20Hz", () => {
    vi.useFakeTimers();
    const sent: (CursorPosition | null)[] = [];
    const publisher = createCursorPublisher((position) => sent.push(position));
    publisher.update({ x: 1, y: 2 });
    publisher.update({ x: 3, y: 4 });
    publisher.update({ x: 5, y: 6 });
    expect(sent).toEqual([{ x: 1, y: 2 }]);
    vi.advanceTimersByTime(50);
    expect(sent).toEqual([
      { x: 1, y: 2 },
      { x: 5, y: 6 },
    ]);
    publisher.clear();
  });

  it("removes the cursor immediately and cancels queued movement when leaving or disabling", () => {
    vi.useFakeTimers();
    const sent: (CursorPosition | null)[] = [];
    const publisher = createCursorPublisher((position) => sent.push(position));
    publisher.update({ x: 1, y: 2 });
    publisher.update({ x: 3, y: 4 });
    publisher.update(null);
    publisher.clear();
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([{ x: 1, y: 2 }, null]);
  });

  it("remembers the toggle", () => {
    expect(loadLiveCursors()).toBe(true);
    saveLiveCursors(false);
    expect(loadLiveCursors()).toBe(false);
    saveLiveCursors(true);
    expect(loadLiveCursors()).toBe(true);
  });

  it("rejects nonfinite and out-of-bounds positions at the realtime boundary", () => {
    for (const x of [NaN, Infinity, -Infinity, 100001, -100001]) {
      expect(
        Schema.decodeUnknownResult(ClientFrame)({ type: "cursor", position: { x, y: 0 } })._tag,
      ).toBe("Failure");
    }
    expect(Schema.decodeUnknownResult(ClientFrame)({ type: "cursor", position: null })._tag).toBe(
      "Success",
    );
  });
});
