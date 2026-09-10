import { For, Show, createSignal, onSettled } from "solid-js";
import { api, ApiError } from "../client/api";
import type { NoteSummary, Visibility, WorldMember } from "../domain/schemas";
import { Badge, Button, EmptyState, ErrorBanner, Field, Input, Textarea } from "./ui";
import { styles } from "./styles.stylex";
import { sx } from "../theme/sx";

export function NotesPanel(props: {
  worldId: string;
  me: WorldMember;
  notes: NoteSummary[];
  onNotes: (notes: NoteSummary[]) => void;
}) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [title, setTitle] = createSignal("");
  const [content, setContent] = createSignal("");
  const [visibility, setVisibility] = createSignal<Visibility>("private");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const refresh = async () => {
    try {
      props.onNotes(await api.listNotes(props.worldId));
    } catch {
      // ignore
    }
  };

  const open = async (noteId: string) => {
    setSelectedId(noteId);
    setError("");
    try {
      const note = await api.getNote(props.worldId, noteId);
      setTitle(note.title);
      setContent(note.content);
      setVisibility(note.visibility);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open note");
    }
  };

  onSettled(() => {
    if (props.notes.length > 0) void open(props.notes[0].id);
  });

  const create = async () => {
    const id = crypto.randomUUID();
    setBusy(true);
    try {
      const note = await api.saveNote(props.worldId, id, {
        title: "New note",
        visibility: "private",
        content: "",
      });
      await refresh();
      setSelectedId(id);
      setTitle(note.title);
      setContent(note.content);
      setVisibility(note.visibility);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create note");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const id = selectedId();
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      await api.saveNote(props.worldId, id, {
        title: title(),
        visibility: visibility(),
        content: content(),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save note");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const id = selectedId();
    if (!id) return;
    setBusy(true);
    try {
      await api.deleteNote(props.worldId, id);
      setSelectedId(null);
      setTitle("");
      setContent("");
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
                  onClick={() => void open(note.id)}
                >
                  <span>{note.title}</span>
                  <span {...sx(styles.faint)}>{note.visibility}</span>
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
              <div {...sx(styles.spacer)} />
              <Button small variant="danger" disabled={busy()} onClick={remove}>
                Delete
              </Button>
              <Button small variant="primary" disabled={busy()} onClick={save}>
                {busy() ? "Saving..." : "Save"}
              </Button>
            </div>
            <Field label="Title">
              <Input value={title()} onInput={setTitle} />
            </Field>
            <Field label="Visibility">
              <select
                {...sx(styles.select)}
                value={visibility()}
                onChange={(event) => setVisibility(event.currentTarget.value as Visibility)}
              >
                <option value="private">Private (only me)</option>
                <option value="dm">DM only</option>
                <option value="public">Public</option>
              </select>
            </Field>
            <Textarea value={content()} onInput={setContent} placeholder="Write anything..." />
          </div>
        </Show>
      </div>
    </div>
  );
}
