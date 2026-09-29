import type { NoteSummary, SaveNoteInput, WorldMember } from "./schemas";

export const canSeeNote = (note: NoteSummary, member: Pick<WorldMember, "id" | "role">) => {
  if (note.ownerMemberId === member.id) return true;
  if (note.visibility === "public") return true;
  if (note.visibility === "dm") return member.role === "dm";
  return false;
};

export const canEditNote = (note: NoteSummary, member: Pick<WorldMember, "id" | "role">) =>
  canSeeNote(note, member) &&
  (note.ownerMemberId === member.id || member.role === "dm" || note.editableByAll === true);

export const canSaveNote = (
  note: NoteSummary,
  input: SaveNoteInput,
  member: Pick<WorldMember, "id" | "role">,
) =>
  canEditNote(note, member) &&
  (note.ownerMemberId === member.id ||
    (input.visibility === note.visibility &&
      (input.editableByAll === undefined ||
        input.editableByAll === (note.editableByAll ?? false))));
