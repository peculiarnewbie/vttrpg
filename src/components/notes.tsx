import { useBeforeLeave } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../theme/tokens.stylex";
import { createNoteAutosave, type NoteSaveStatus } from "../client/note-autosave";
import { renderNoteMarkdown } from "../client/note-markdown";
import { For, Show, createSignal, createEffect, onCleanup, onSettled } from "solid-js";
import { api, ApiError } from "../client/api";
import type { Note, NoteSummary, Visibility, WorldMember } from "../domain/schemas";
import { Badge, Button, EmptyState, ErrorBanner, Field, Input, Textarea } from "./ui";
import { styles } from "./styles.stylex";
import { sx } from "../theme/sx";

export function NotesPanel(props: {
  worldId: string;
  me: WorldMember;
  members: WorldMember[];
  notes: NoteSummary[];
  onNotes: (notes: NoteSummary[]) => void;
}) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [ownerId, setOwnerId] = createSignal<string | null>(null);
  const [title, setTitle] = createSignal("");
  const [content, setContent] = createSignal("");
  const [visibility, setVisibility] = createSignal<Visibility>("private");
  const [editableByAll, setEditableByAll] = createSignal(false);
  const [preview, setPreview] = createSignal(false);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<NoteSaveStatus>("saved");
  let loadVersion = 0;
  let editVersion = 0;

  const isOwner = () => ownerId() === props.me.id;
  const canEdit = () => isOwner() || props.me.role === "dm" || editableByAll();
  const memberName = (memberId: string | null) =>
    props.members.find((member) => member.id === memberId)?.displayName ?? "Unknown";
  const refresh = async () => props.onNotes(await api.listNotes(props.worldId));
  const autosave = createNoteAutosave({
    save: async () => {
      const id = selectedId();
      if (!id) return;
      await api.saveNote(props.worldId, id, {
        title: title(),
        content: content(),
        visibility: visibility(),
        editableByAll: editableByAll(),
      });
      await refresh();
    },
    onStatus: (next, err) => {
      setStatus(next);
      setError(
        next === "error"
          ? err instanceof ApiError
            ? err.message
            : "Could not save note. Retry to keep your changes."
          : "",
      );
    },
  });
  const changed = () => {
    editVersion++;
    autosave.changed();
  };
  const apply = (note: Note) => {
    setSelectedId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setVisibility(note.visibility);
    setEditableByAll(note.editableByAll ?? false);
    setOwnerId(note.ownerMemberId);
  };
  const open = async (noteId: string) => {
    if (busy()) return;
    setBusy(true);
    try {
      if (!(await autosave.flush())) return;
      const version = ++loadVersion;
      const note = await api.getNote(props.worldId, noteId);
      if (version === loadVersion) {
        apply(note);
        setPreview(false);
        setError("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open note");
    } finally {
      setBusy(false);
    }
  };

  createEffect(
    () => props.notes,
    (notes) => {
      const id = selectedId();
      if (!id || busy() || autosave.pending()) return;
      if (!notes.some((note) => note.id === id)) {
        ++loadVersion;
        setSelectedId(null);
        setOwnerId(null);
        return;
      }
      const version = ++loadVersion;
      const edits = editVersion;
      void api
        .getNote(props.worldId, id)
        .then((note) => {
          if (
            version === loadVersion &&
            edits === editVersion &&
            !autosave.pending() &&
            selectedId() === id
          )
            apply(note);
        })
        .catch(() => setError("Could not refresh the open note"));
    },
  );

  useBeforeLeave((event) => {
    if (!autosave.pending()) return;
    event.preventDefault();
    void autosave.flush().then((saved) => {
      if (saved) event.retry(true);
    });
  });
  onSettled(() => {
    if (props.notes.length > 0) void open(props.notes[0].id);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (autosave.pending()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    onCleanup(() => window.removeEventListener("beforeunload", beforeUnload));
  });
  onCleanup(() => {
    ++loadVersion;
    autosave.dispose();
  });

  const create = async () => {
    setBusy(true);
    try {
      if (!(await autosave.flush())) return;
      const note = await api.saveNote(props.worldId, crypto.randomUUID(), {
        title: "New note",
        visibility: "private",
        content: "",
      });
      ++loadVersion;
      apply(note);
      setPreview(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create note");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const id = selectedId();
    if (!id) return;
    setBusy(true);
    try {
      if (!(await autosave.flush())) return;
      await api.deleteNote(props.worldId, id);
      ++loadVersion;
      setSelectedId(null);
      setOwnerId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete note");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div {...sx(styles.row)}>
        <h3 {...sx(styles.h3)}>Notes</h3>
        <div {...sx(styles.spacer)} />
        <Button variant="primary" small disabled={busy()} onClick={create}>
          New note
        </Button>
      </div>
      <div {...sx(styles.divider)} />
      <ErrorBanner message={error()} />

      <div {...sx(styles.notesLayout)}>
        <div {...sx(styles.navList)}>
          <Show when={props.notes.length > 0} fallback={<EmptyState>No notes yet.</EmptyState>}>
            <For each={props.notes}>
              {(note) => (
                <button
                  {...sx(styles.noteItem, selectedId() === note.id && styles.noteItemActive)}
                  disabled={busy()}
                  onClick={() => void open(note.id)}
                >
                  <span>{note.title}</span>
                  <span {...sx(styles.faint)}>
                    {note.visibility}
                    {note.ownerMemberId !== props.me.id
                      ? ` · by ${memberName(note.ownerMemberId)}`
                      : ""}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>

        <Show when={selectedId()} fallback={<EmptyState>Select a note or create one.</EmptyState>}>
          <div {...sx(styles.col)}>
            <div {...sx(styles.row)}>
              <Badge
                tone={
                  visibility() === "public" ? "success" : visibility() === "dm" ? "dm" : "private"
                }
              >
                {visibility()}
              </Badge>
              <Show when={!canEdit()}>
                <Badge tone="plain">read only</Badge>
              </Show>
              <div {...sx(styles.spacer)} />
              <Show when={isOwner()}>
                <Button small variant="danger" disabled={busy()} onClick={remove}>
                  Delete
                </Button>
              </Show>
              <Show when={canEdit()}>
                <span {...sx(styles.faint)} role="status">
                  {status() === "saved"
                    ? "Saved"
                    : status() === "error"
                      ? "Save failed"
                      : "Saving…"}
                </span>
                <Show when={status() === "error"}>
                  <Button small disabled={busy()} onClick={() => void autosave.flush()}>
                    Retry
                  </Button>
                </Show>
                <Button small onClick={() => setPreview(!preview())}>
                  {preview() ? "Edit" : "Preview"}
                </Button>
              </Show>
            </div>

            <Show
              when={canEdit()}
              fallback={
                <>
                  <h3 {...sx(styles.h3)}>{title()}</h3>
                  <div
                    {...sx(noteStyles.markdown)}
                    innerHTML={renderNoteMarkdown(content() || "Empty note.")}
                  />
                </>
              }
            >
              <fieldset disabled={busy()} {...sx(noteStyles.editor)}>
                <Field label="Title">
                  <Input
                    disabled={busy()}
                    value={title()}
                    onInput={(value) => {
                      setTitle(value);
                      changed();
                    }}
                  />
                </Field>
                <Show when={isOwner()}>
                  <Field label="Visibility">
                    <select
                      {...sx(styles.select)}
                      disabled={busy()}
                      value={visibility()}
                      onChange={(event) => {
                        setVisibility(event.currentTarget.value as Visibility);
                        changed();
                      }}
                    >
                      <option value="private">Private (only me)</option>
                      <option value="dm">DM only</option>
                      <option value="public">Public</option>
                    </select>
                  </Field>
                  <label {...sx(styles.row)}>
                    <input
                      type="checkbox"
                      disabled={busy()}
                      checked={editableByAll()}
                      onChange={(event) => {
                        setEditableByAll(event.currentTarget.checked);
                        changed();
                      }}
                    />
                    Let everyone who can see this note edit it
                  </label>
                </Show>
                <Show
                  when={!preview()}
                  fallback={
                    <div
                      {...sx(noteStyles.markdown)}
                      innerHTML={renderNoteMarkdown(content() || "Empty note.")}
                    />
                  }
                >
                  <Textarea
                    value={content()}
                    onInput={(value) => {
                      setContent(value);
                      changed();
                    }}
                    placeholder="Write anything..."
                  />
                </Show>
              </fieldset>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

const noteStyles = stylex.create({
  editor: { borderWidth: 0, margin: 0, padding: 0, minWidth: 0 },
  markdown: {
    color: colors.text,
    backgroundColor: colors.surface,
    lineHeight: 1.6,
    overflowWrap: "anywhere",
    overflowX: "auto",
    padding: 12,
    borderRadius: 4,
  },
});
