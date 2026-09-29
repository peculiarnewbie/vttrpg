import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { Note, NoteSummary, SaveNoteInput } from "./schemas";
import { canEditNote, canSaveNote, canSeeNote } from "./note-permissions";

const note: NoteSummary = {
  id: "n",
  ownerMemberId: "author",
  title: "Journal",
  visibility: "private",
  updatedAt: "",
};
const owner = { id: "author", role: "player" as const };
const player = { id: "reader", role: "player" as const };
const dm = { id: "dm", role: "dm" as const };

it("preserves old note and input JSON shapes", () => {
  expect(Schema.decodeUnknownSync(NoteSummary)(note).editableByAll).toBeUndefined();
  expect(Schema.decodeUnknownSync(Note)({ ...note, content: "" }).editableByAll).toBeUndefined();
  expect(
    Schema.decodeUnknownSync(SaveNoteInput)({ title: "", content: "", visibility: "private" })
      .editableByAll,
  ).toBeUndefined();
});

it("never grants visibility through the shared editing flag", () => {
  for (const editableByAll of [false, true]) {
    expect(canSeeNote({ ...note, editableByAll }, player)).toBe(false);
    expect(canEditNote({ ...note, editableByAll }, dm)).toBe(false);
    expect(canSeeNote({ ...note, visibility: "dm", editableByAll }, player)).toBe(false);
  }
  expect(canEditNote(note, owner)).toBe(true);
  expect(canEditNote({ ...note, visibility: "dm" }, dm)).toBe(true);
  expect(canEditNote({ ...note, visibility: "public" }, player)).toBe(false);
  expect(canEditNote({ ...note, visibility: "public", editableByAll: true }, player)).toBe(true);
});

it("keeps permissions owner-only even for DMs and shared editors", () => {
  const shared = { ...note, visibility: "public" as const, editableByAll: true };
  const input = { title: "New", content: "Text", visibility: "public" as const };
  for (const member of [dm, player]) {
    expect(canSaveNote(shared, input, member)).toBe(true);
    expect(canSaveNote(shared, { ...input, visibility: "private" }, member)).toBe(false);
    expect(canSaveNote(shared, { ...input, editableByAll: false }, member)).toBe(false);
  }
  expect(
    canSaveNote(shared, { ...input, editableByAll: false, visibility: "private" }, owner),
  ).toBe(true);
});
