import { afterEach, expect, it, vi } from "vitest";
import { createNoteAutosave } from "./note-autosave";

afterEach(() => vi.useRealTimers());

it("debounces edits and flushes before the debounce expires", async () => {
  vi.useFakeTimers();
  let saves = 0;
  const autosave = createNoteAutosave({
    save: async () => {
      saves++;
    },
    onStatus: () => {},
  });
  autosave.changed();
  await vi.advanceTimersByTimeAsync(500);
  autosave.changed();
  await vi.advanceTimersByTimeAsync(799);
  expect(saves).toBe(0);
  expect(await autosave.flush()).toBe(true);
  expect(saves).toBe(1);
  expect(autosave.pending()).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(saves).toBe(1);
});

it("serializes a new edit made during an in-flight save", async () => {
  let release: (() => void) | undefined;
  let saves = 0;
  const statuses: string[] = [];
  const autosave = createNoteAutosave({
    save: async () => {
      saves++;
      if (saves === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    },
    onStatus: (status) => statuses.push(status),
  });
  autosave.changed();
  const flushed = autosave.flush();
  autosave.changed();
  expect(autosave.flush()).toBe(flushed);
  expect(saves).toBe(1);
  release?.();
  expect(await flushed).toBe(true);
  expect(saves).toBe(2);
  expect(statuses.at(-1)).toBe("saved");
  autosave.dispose();
});

it("retains failed changes until a successful retry", async () => {
  let fail = true;
  const autosave = createNoteAutosave({
    save: async () => {
      if (fail) throw new Error("offline");
    },
    onStatus: () => {},
  });
  autosave.changed();
  expect(await autosave.flush()).toBe(false);
  expect(autosave.pending()).toBe(true);
  fail = false;
  expect(await autosave.flush()).toBe(true);
  expect(autosave.pending()).toBe(false);
});
