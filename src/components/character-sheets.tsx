import { For, Show, createEffect, createSignal, onSettled } from "solid-js";
import { api } from "../client/api";
import { computeStats } from "../domain/dice";
import type {
  Character,
  SaveCharacterInput,
  SheetTemplate,
  Visibility,
  WorldMember,
} from "../domain/schemas";
import { Badge, Button, EmptyState, Field, Input, Modal } from "./ui";
import { styles } from "./styles.stylex";
import { sx } from "../theme/sx";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

type Props = {
  worldId: string;
  me: WorldMember;
  isDm: boolean;
  characters: Character[];
  templates: SheetTemplate[];
  members: WorldMember[];
  onRoll: (characterId: string, rollId: string, visibility: Visibility) => void;
  onTicker: (characterId: string, tickerId: string, value: number) => void;
  onSave: (input: SaveCharacterInput) => Promise<void>;
  onDelete: (characterId: string) => Promise<void>;
  onUploadAvatar: (characterId: string, file: File) => Promise<void>;
};

const templateFor = (templates: SheetTemplate[], character: Character) =>
  templates.find((template) => template.id === character.templateId) ?? templates[0];

const selectionKey = (worldId: string) => `ttrpg:selected-character:${worldId}`;

export function CharacterSheets(props: Props) {
  const stored =
    typeof localStorage !== "undefined" ? localStorage.getItem(selectionKey(props.worldId)) : null;
  const [selectedId, setSelectedId] = createSignal<string | null>(stored);
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [newTemplateId, setNewTemplateId] = createSignal(props.templates[0]?.id ?? "");
  const [newMemberId, setNewMemberId] = createSignal(props.me.id);
  const [editing, setEditing] = createSignal(false);
  const [draftName, setDraftName] = createSignal("");
  const [draftValues, setDraftValues] = createSignal<Record<string, string | number>>({});
  const [avatarError, setAvatarError] = createSignal("");

  const select = (characterId: string | null) => {
    setSelectedId(characterId);
    if (typeof localStorage !== "undefined") {
      if (characterId) localStorage.setItem(selectionKey(props.worldId), characterId);
      else localStorage.removeItem(selectionKey(props.worldId));
    }
    setEditing(false);
  };

  // On load (and when characters change), keep a valid selection so reopening
  // the menu lands on the sheet the user had open.
  createEffect(
    () => props.characters.map((character) => character.id).join(","),
    () => {
      const current = selectedId();
      if (current && props.characters.some((character) => character.id === current)) return;
      if (props.characters.length > 0) select(props.characters[0].id);
      else if (current) select(null);
    },
  );

  onSettled(() => {
    if (!selectedId() && props.characters.length > 0) select(props.characters[0].id);
  });

  const selected = () =>
    props.characters.find((character) => character.id === selectedId()) ?? null;
  const canEdit = (character: Character) => props.isDm || character.memberId === props.me.id;

  const startEdit = (character: Character) => {
    setDraftName(character.name);
    setDraftValues({ ...character.values });
    setEditing(true);
  };

  const saveEdit = async (character: Character) => {
    await props.onSave({
      id: character.id,
      name: draftName(),
      templateId: character.templateId,
      memberId: character.memberId,
      values: draftValues(),
    });
    setEditing(false);
  };

  const uploadAvatar = async (character: Character, file: File) => {
    setAvatarError("");
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError("Picture must be 5MB or smaller");
      return;
    }
    try {
      await props.onUploadAvatar(character.id, file);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Could not upload picture");
    }
  };

  const create = async (event: Event) => {
    event.preventDefault();
    if (!newName().trim()) return;
    await props.onSave({
      name: newName().trim(),
      templateId: newTemplateId() || props.templates[0]?.id || "",
      memberId: props.isDm ? newMemberId() : props.me.id,
      values: {},
    });
    setNewName("");
    setCreating(false);
  };

  const renderFields = (character: Character, template: SheetTemplate, readOnly: boolean) => {
    const groups = new Map<string, typeof template.fields>();
    for (const field of template.fields) {
      const key = field.group ?? "Sheet";
      groups.set(key, [...(groups.get(key) ?? []), field]);
    }
    return (
      <For each={[...groups.entries()]}>
        {([group, fields]) => (
          <section {...sx(styles.col)}>
            <span {...sx(styles.eyebrow)}>{group}</span>
            <div {...sx(styles.sheetGrid)}>
              <For each={fields}>
                {(field) => {
                  const value = () =>
                    editing()
                      ? (draftValues()[field.id] ?? field.defaultValue ?? "")
                      : (character.values[field.id] ?? field.defaultValue ?? "");
                  return (
                    <div {...sx(styles.field)}>
                      <span {...sx(styles.label)}>{field.label}</span>
                      <Show
                        when={editing()}
                        fallback={<div {...sx(styles.fieldValue)}>{String(value() || "—")}</div>}
                      >
                        <input
                          {...sx(styles.input)}
                          type={field.kind === "number" ? "number" : "text"}
                          value={value()}
                          disabled={readOnly}
                          onInput={(event) => {
                            const raw = event.currentTarget.value;
                            setDraftValues((prev) => ({
                              ...prev,
                              [field.id]: field.kind === "number" ? Number(raw) : raw,
                            }));
                          }}
                        />
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </section>
        )}
      </For>
    );
  };

  return (
    <div>
      <div {...sx(styles.row)}>
        <h3 {...sx(styles.h3)}>Characters</h3>
        <div {...sx(styles.spacer)} />
        <Button variant="primary" small onClick={() => setCreating(true)}>
          New character
        </Button>
      </div>
      <div {...sx(styles.divider)} />

      <Show
        when={props.characters.length > 0}
        fallback={<EmptyState>No characters yet. Create one to fill in a sheet.</EmptyState>}
      >
        <div {...sx(styles.rowWrap)}>
          <For each={props.characters}>
            {(character) => (
              <button
                {...sx(
                  styles.card,
                  styles.cardInteractive,
                  selectedId() === character.id && styles.noteItemActive,
                )}
                onClick={() => select(character.id)}
              >
                <span {...sx(styles.h4)}>{character.name}</span>
                <span {...sx(styles.faint)}>
                  {props.members.find((member) => member.id === character.memberId)?.displayName ??
                    "Unassigned"}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={selected()}>
        {(character) => {
          const template = () => templateFor(props.templates, character());
          return (
            <Show when={template()}>
              {(sheet) => (
                <div {...sx(styles.window)}>
                  <div {...sx(styles.windowTitle)}>
                    <span>{sheet().name}</span>
                    <div {...sx(styles.spacer)} />
                    <Show when={editing()}>
                      <Button small onClick={() => setEditing(false)}>
                        Cancel
                      </Button>
                      <Button small variant="primary" onClick={() => void saveEdit(character())}>
                        Save
                      </Button>
                    </Show>
                    <Show when={!editing() && canEdit(character())}>
                      <Button small onClick={() => startEdit(character())}>
                        Edit
                      </Button>
                    </Show>
                    <Show when={props.isDm}>
                      <Button
                        small
                        variant="danger"
                        onClick={() => {
                          void props.onDelete(character().id);
                          select(null);
                        }}
                      >
                        Delete
                      </Button>
                    </Show>
                  </div>
                  <div {...sx(styles.windowBody, styles.col)}>
                    <div {...sx(styles.row)}>
                      <Show
                        when={character().avatarKey}
                        fallback={
                          <div {...sx(styles.avatarPlaceholder)}>
                            {character().name.slice(0, 1).toUpperCase()}
                          </div>
                        }
                      >
                        <img
                          src={api.avatarUrl(props.worldId, character().id, character().avatarKey!)}
                          alt={character().name}
                          {...sx(styles.avatarLarge)}
                        />
                      </Show>
                      <div {...sx(styles.col)}>
                        <Show when={editing()}>
                          <Field label="Name">
                            <Input value={draftName()} onInput={setDraftName} />
                          </Field>
                        </Show>
                        <Show when={!editing()}>
                          <h2 {...sx(styles.h2)}>{character().name}</h2>
                        </Show>
                        <Show when={canEdit(character())}>
                          <label {...sx(styles.button, styles.buttonGhost, styles.buttonSmall)}>
                            Upload picture
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              style={{ display: "none" }}
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                if (file) void uploadAvatar(character(), file);
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                        </Show>
                        <Show when={avatarError()}>
                          <span {...sx(styles.errorBanner)}>{avatarError()}</span>
                        </Show>
                      </div>
                    </div>

                    <section {...sx(styles.col)}>
                      <span {...sx(styles.eyebrow)}>Rolls</span>
                      <Show when={editing()}>
                        <span {...sx(styles.faint)}>
                          Finish editing to roll. Rolls are paused while you edit the sheet.
                        </span>
                      </Show>
                      <div {...sx(styles.sheetGrid)}>
                        <For each={sheet().rolls}>
                          {(roll) => (
                            <button
                              {...sx(styles.rollButton)}
                              disabled={editing()}
                              onClick={() => props.onRoll(character().id, roll.id, roll.visibility)}
                            >
                              <span>{roll.label}</span>
                              <span {...sx(styles.row)}>
                                <span {...sx(styles.mono)}>
                                  {roll.dice.map((die) => `${die.count}d${die.sides}`).join("+")}
                                </span>
                                <Badge
                                  tone={
                                    roll.visibility === "dm"
                                      ? "dm"
                                      : roll.visibility === "private"
                                        ? "private"
                                        : "plain"
                                  }
                                >
                                  {roll.visibility}
                                </Badge>
                              </span>
                            </button>
                          )}
                        </For>
                      </div>
                    </section>

                    <Show when={sheet().stats.length > 0}>
                      <section {...sx(styles.col)}>
                        <span {...sx(styles.eyebrow)}>Stats</span>
                        <div {...sx(styles.sheetGrid)}>
                          <For each={sheet().stats}>
                            {(stat) => {
                              const values = () => (editing() ? draftValues() : character().values);
                              const stats = () => computeStats(sheet().stats, values());
                              return (
                                <div {...sx(styles.statBox)}>
                                  <span {...sx(styles.label)}>{stat.label}</span>
                                  <span {...sx(styles.statValue)}>{stats()[stat.id] ?? 0}</span>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </section>
                    </Show>

                    <Show when={sheet().tickers.length > 0}>
                      <section {...sx(styles.col)}>
                        <span {...sx(styles.eyebrow)}>Trackers</span>
                        <div {...sx(styles.sheetGrid)}>
                          <For each={sheet().tickers}>
                            {(ticker) => {
                              const current = () =>
                                character().tickers[ticker.id] ?? ticker.defaultValue;
                              const pct = () =>
                                `${Math.round(((current() - ticker.min) / Math.max(1, ticker.max - ticker.min)) * 100)}%`;
                              return (
                                <div {...sx(styles.ticker)}>
                                  <div {...sx(styles.row)}>
                                    <span {...sx(styles.label)}>{ticker.label}</span>
                                    <div {...sx(styles.spacer)} />
                                    <span {...sx(styles.mono)}>
                                      {current()}/{ticker.max}
                                    </span>
                                  </div>
                                  <div {...sx(styles.tickerBar)}>
                                    <div
                                      {...sx(styles.tickerFill)}
                                      style={{ width: pct(), "background-color": ticker.color }}
                                    />
                                  </div>
                                  <div {...sx(styles.tickerControls)}>
                                    <Button
                                      small
                                      disabled={!canEdit(character())}
                                      onClick={() =>
                                        props.onTicker(character().id, ticker.id, current() - 1)
                                      }
                                    >
                                      −
                                    </Button>
                                    <Button
                                      small
                                      disabled={!canEdit(character())}
                                      onClick={() =>
                                        props.onTicker(character().id, ticker.id, current() + 1)
                                      }
                                    >
                                      +
                                    </Button>
                                  </div>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </section>
                    </Show>

                    {renderFields(character(), sheet(), !canEdit(character()))}
                  </div>
                </div>
              )}
            </Show>
          );
        }}
      </Show>

      <Modal when={creating()} title="New character" onClose={() => setCreating(false)}>
        <form {...sx(styles.col)} onSubmit={create}>
          <Field label="Name">
            <Input value={newName()} onInput={setNewName} placeholder="Character name" />
          </Field>
          <Field label="Template">
            <select
              {...sx(styles.select)}
              value={newTemplateId()}
              onChange={(event) => setNewTemplateId(event.currentTarget.value)}
            >
              <For each={props.templates}>
                {(template) => <option value={template.id}>{template.name}</option>}
              </For>
            </select>
          </Field>
          <Show when={props.isDm}>
            <Field label="Assign to player">
              <select
                {...sx(styles.select)}
                value={newMemberId()}
                onChange={(event) => setNewMemberId(event.currentTarget.value)}
              >
                <For each={props.members}>
                  {(member) => <option value={member.id}>{member.displayName}</option>}
                </For>
              </select>
            </Field>
          </Show>
          <Button type="submit" variant="primary" disabled={!newName().trim()}>
            Create
          </Button>
        </form>
      </Modal>
    </div>
  );
}
