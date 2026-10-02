import { For, Show, createEffect, createSignal, onSettled } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { api } from "../client/api";
import { computeStats } from "../domain/dice";
import { effectiveLayout } from "../domain/layout-from-template";
import { layoutTrackers } from "../domain/sheet-layout";
import { refValues, sheetScope } from "../domain/sheet-refs";
import { trackerDefinitions } from "../domain/trackers-definitions";
import { CharacterBuilder, type BuilderCompendium } from "./character-builder";
import { SheetBlocks, type RollRow, type SheetRoll } from "./sheet-blocks";
import type {
  Character,
  CharacterValue,
  SaveCharacterInput,
  SheetTemplate,
  Visibility,
  WorldMember,
} from "../domain/schemas";
import { Button, EmptyState, Field, Input, Modal } from "./ui";
import { styles } from "./styles.stylex";
import { colors, fonts, radii, skin, space } from "../theme/tokens.stylex";
import { useTheme } from "../theme/theme-context";
import { sx } from "../theme/sx";

// Dense, paper-sheet layout: players learn a sheet by heart, so favour seeing
// everything at once over airy cards. Hairlines separate sections.
const hairline = {
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: colors.border,
} as const;
const sheetStyles = stylex.create({
  sheet: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    fontSize: "13px",
    fontFamily: fonts.body,
  },
  bar: { display: "flex", alignItems: "center", gap: "2px", marginTop: "-2px" },
  barButton: {
    paddingInline: "6px",
    paddingBlock: "2px",
    borderWidth: 0,
    borderRadius: radii.sm,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.textMuted,
    fontSize: "12px",
    cursor: "pointer",
  },
  barPrimary: { color: colors.accent, fontWeight: 600 },
  barDanger: { color: colors.danger },
  identity: { display: "flex", alignItems: "center", gap: "8px", textAlign: "center" },
  identityBand: {
    marginInline: `calc(-1 * ${space.x3})`,
    paddingInline: space.x3,
    paddingBlock: "6px",
    textAlign: "left",
    backgroundColor: colors.accent,
    backgroundImage: skin.band,
    backgroundSize: skin.bandSize,
    color: colors.accentText,
    borderBottomWidth: "3px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.borderStrong,
  },
  bandText: { color: colors.accentText },
  portrait: {
    flexShrink: 0,
    width: "40px",
    height: "40px",
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    borderRadius: radii.sm,
    ...hairline,
    backgroundColor: colors.surfaceMuted,
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: "16px",
  },
  portraitSmall: { width: "28px", height: "28px", fontSize: "12px" },
  roster: { display: "flex", flexDirection: "column" },
  rosterRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingBlock: "5px",
    paddingInline: "4px",
    borderWidth: 0,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    color: colors.text,
    textAlign: "left",
    cursor: "pointer",
  },
  rosterName: {
    fontFamily: fonts.display,
    fontSize: "13px",
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  rosterTrackers: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    fontFamily: fonts.numeric,
    fontSize: "11px",
    color: colors.textMuted,
    whiteSpace: "nowrap",
  },
  portraitEditable: { cursor: "pointer", ":hover": { borderColor: colors.accent } },
  portraitImage: { width: "100%", height: "100%", objectFit: "cover" },
  identityText: { display: "flex", flexDirection: "column", minWidth: 0, flex: 1 },
  name: {
    margin: 0,
    fontFamily: fonts.display,
    fontSize: "26px",
    fontWeight: skin.headWeight,
    textTransform: skin.nameTransform,
    color: colors.accent,
    lineHeight: 1.15,
    letterSpacing: skin.nameTracking,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  nameInput: {
    fontFamily: fonts.display,
    fontSize: "20px",
    letterSpacing: skin.nameTracking,
    textTransform: skin.nameTransform,
  },
  meta: {
    fontSize: "11px",
    color: colors.textMuted,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginTop: "4px",
    fontFamily: fonts.display,
    fontSize: "12px",
    fontWeight: skin.headWeight,
    letterSpacing: skin.headTracking,
    textTransform: skin.headTransform,
    color: colors.accent,
    "::before": { content: skin.ornament },
  },
  summary: { cursor: "pointer", userSelect: "none", listStyle: "none" },
  rule: { flex: 1, height: skin.ruleHeight, backgroundImage: skin.rule },
  // One column set for every tracker row (rows use subgrid), so bars and pips line up
  // even when a theme's letter-spaced labels are wider than the minimum.
  trackers: {
    display: "grid",
    gridTemplateColumns: "minmax(44px, max-content) 22px minmax(0, 1fr) auto",
    columnGap: "4px",
    rowGap: "3px",
  },
  tracker: {
    gridColumn: "1 / -1",
    display: "grid",
    gridTemplateColumns: "subgrid",
    alignItems: "center",
    rowGap: "2px",
  },
  trackerLabel: {
    fontFamily: fonts.display,
    fontSize: "11px",
    fontWeight: skin.headWeight,
    textTransform: skin.headTransform,
    letterSpacing: skin.headTracking,
    color: colors.textMuted,
    whiteSpace: "nowrap",
  },
  step: {
    width: "22px",
    height: "22px",
    padding: 0,
    borderRadius: skin.stepperRadius,
    transform: `rotate(${skin.stepperRotate})`,
    ...hairline,
    backgroundColor: { default: colors.surface, ":hover": colors.surfaceHover },
    color: colors.text,
    fontSize: "13px",
    lineHeight: 1,
    cursor: "pointer",
    ":disabled": { opacity: 0.4, cursor: "default" },
  },
  stepGlyph: { display: "inline-block", transform: `rotate(calc(-1 * ${skin.stepperRotate}))` },
  ledgerStep: {
    borderWidth: 0,
    backgroundColor: "transparent",
    transform: "none",
    fontSize: "20px",
  },
  pipValue: { minWidth: 0, justifySelf: "end" },
  pips: {
    gridColumn: "2 / 4",
    display: "flex",
    flexWrap: "wrap",
    gap: "3px",
    paddingBlock: "3px",
  },
  pip: {
    width: skin.pipSize,
    height: skin.pipSize,
    flexShrink: 0,
    padding: 0,
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: skin.pipBorder,
    borderRadius: skin.pipRadius,
    backgroundColor: { default: "transparent", ":hover": colors.surfaceHover },
    cursor: "pointer",
    ":disabled": { cursor: "default" },
  },
  pipOn: { backgroundColor: { default: skin.pipOn, ":hover": skin.pipOn } },
  trackerValue: { height: "22px", minWidth: "48px", position: "relative" },
  ledgerValue: { height: "28px" },
  ledgerNumber: { fontSize: "20px", paddingTop: 0 },
  meter: {
    position: "relative",
    height: "22px",
    overflow: "hidden",
    borderRadius: skin.controlRadius,
    ...hairline,
    backgroundColor: skin.meterTrack,
  },
  meterFill: {
    position: "absolute",
    insetBlock: 0,
    left: 0,
    backgroundImage: skin.meterFill,
    opacity: 0.9,
  },
  meterValue: {
    position: "relative",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "baseline",
    justifyContent: "center",
    gap: "1px",
    paddingTop: "3px",
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.text,
    textShadow: `0 0 2px ${colors.surface}, 0 0 3px ${colors.surface}, 0 0 4px ${colors.surface}`,
    fontFamily: fonts.numeric,
    fontSize: "13px",
    cursor: "text",
    ":disabled": { cursor: "default" },
  },
  meterMax: { fontSize: "11px", color: colors.textMuted },
  meterInput: {
    position: "relative",
    width: "100%",
    height: "100%",
    borderWidth: 0,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: fonts.numeric,
    fontSize: "13px",
    textAlign: "center",
  },
  maxEdit: {
    gridColumn: "2 / -1",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "11px",
    color: colors.textMuted,
  },
  maxInput: { width: "64px" },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBlock: "3px",
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: colors.border,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    minWidth: 0,
  },
  statLabel: {
    fontSize: "9px",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: colors.textMuted,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
    paddingInline: "4px",
  },
  statValue: { fontFamily: fonts.numeric, fontSize: "18px", fontWeight: 700, lineHeight: 1.1 },
  rolls: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))",
    gap: "3px",
  },
  roll: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    minWidth: 0,
    height: "26px",
    paddingInline: "6px",
    borderRadius: skin.controlRadius,
    boxShadow: skin.controlShadow,
    ...hairline,
    backgroundColor: { default: colors.surface, ":hover": colors.surfaceHover },
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: "12px",
    textAlign: "left",
    cursor: "pointer",
    ":disabled": { opacity: 0.5, cursor: "default" },
  },
  rollLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rollPrivacy: {
    fontSize: "9px",
    fontWeight: 700,
    textTransform: "uppercase",
    paddingInline: "3px",
    borderRadius: radii.sm,
    backgroundColor: colors.accentMuted,
    color: colors.accent,
  },
  rollDice: {
    fontFamily: fonts.numeric,
    fontSize: "11px",
    color: colors.textMuted,
    whiteSpace: "nowrap",
  },
  group: { display: "flex", flexDirection: "column", gap: "3px" },
  fields: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
    columnGap: "10px",
    rowGap: "1px",
  },
  field: {
    display: "flex",
    alignItems: "baseline",
    gap: "6px",
    minWidth: 0,
    paddingBlock: "2px",
    borderBottomWidth: "1px",
    borderBottomStyle: "dotted",
    borderBottomColor: colors.border,
  },
  fieldWide: { gridColumn: "1 / -1", flexDirection: "column", alignItems: "stretch", gap: "2px" },
  fieldLabel: { fontSize: "11px", color: colors.textMuted, whiteSpace: "nowrap" },
  fieldValue: {
    fontFamily: fonts.body,
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    fontWeight: 600,
    overflowWrap: "anywhere",
  },
  longtext: {
    textAlign: "left",
    fontWeight: 400,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  empty: { color: colors.textFaint, fontWeight: 400 },
  input: {
    flex: 1,
    minWidth: 0,
    height: "24px",
    paddingInline: "5px",
    borderRadius: skin.controlRadius,
    boxShadow: skin.controlShadow,
    ...hairline,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: "12px",
    ":focus": { borderColor: colors.accent, outline: "none" },
  },
  textarea: {
    height: "auto",
    minHeight: "72px",
    paddingBlock: "4px",
    resize: "vertical",
    fontFamily: "inherit",
  },
});

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
  /** Save one value right away (fields, lists, checkbox rows). */
  onValue: (characterId: string, key: string, value: CharacterValue) => void;
  onLayoutPref: (characterId: string, blockId: string, variant: string | null) => void;
  /** A roll that isn't one of the template's roll definitions, e.g. a Property row's d8. */
  onRollDice: (notation: string, label: string, sheet?: SheetRoll) => void;
  /** The world's compendium, for entry blocks, "from compendium" lists and the builder. */
  compendium?: BuilderCompendium;
  onOpenEntry?: (entryId: string) => void;
  /** Roll one of an entry's oracle tables (the builder's table rolls). */
  onRollTable?: (entryId: string, field: string) => void;
  onSave: (input: SaveCharacterInput) => Promise<Character>;
  onDelete: (characterId: string) => Promise<void>;
  onUploadAvatar: (characterId: string, file: File) => Promise<void>;
  /** Lock or unlock a shared sheet (DM). */
  onLock?: (characterId: string, locked: boolean) => void;
};

const shared = (character: Character) => character.scope === "world";

const templateFor = (templates: SheetTemplate[], character: Character) =>
  templates.find((template) => template.id === character.templateId) ?? templates[0];

const selectionKey = (worldId: string) => `ttrpg:selected-character:${worldId}`;

export function CharacterSheets(props: Props) {
  const theme = useTheme();
  const bandHeader = () => theme.skin().header === "band";
  const stored =
    typeof localStorage !== "undefined" ? localStorage.getItem(selectionKey(props.worldId)) : null;
  const [selectedId, setSelectedId] = createSignal<string | null>(stored);
  const [view, setView] = createSignal<"sheet" | "list">(stored ? "sheet" : "list");
  const [deleting, setDeleting] = createSignal<Character | null>(null);
  const [deleteError, setDeleteError] = createSignal("");
  const [deletingBusy, setDeletingBusy] = createSignal(false);
  const [draftMax, setDraftMax] = createSignal<Record<string, number>>({});
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [newTemplateId, setNewTemplateId] = createSignal(props.templates[0]?.id ?? "");
  const [newMemberId, setNewMemberId] = createSignal(props.me.id);
  const [editing, setEditing] = createSignal(false);
  // The builder: Edit's drafts and Save, with the layout's builder steps instead of the sheet.
  const [building, setBuilding] = createSignal(false);
  // Style mode: pick each block's variant (stats as bars, lists as cards…) for this character.
  const [customizing, setCustomizing] = createSignal(false);
  const [draftName, setDraftName] = createSignal("");
  const [avatarError, setAvatarError] = createSignal("");

  const selected = () =>
    props.characters.find((character) => character.id === selectedId()) ?? null;
  // Shared sheets (a crew, a steading) are everyone's until the DM locks one.
  const canEdit = (character: Character) =>
    props.isDm || (shared(character) ? !character.locked : character.memberId === props.me.id);
  const isShared = (templateId: string) =>
    props.templates.find((template) => template.id === templateId)?.layout?.subject === "shared";
  const roster = () => [
    ...props.characters.filter(shared),
    ...props.characters.filter((character) => !shared(character)),
  ];

  const select = (characterId: string | null) => {
    setSelectedId(characterId);
    if (typeof localStorage !== "undefined") {
      if (characterId) localStorage.setItem(selectionKey(props.worldId), characterId);
      else localStorage.removeItem(selectionKey(props.worldId));
    }
    setEditing(false);
    setBuilding(false);
    setView(characterId ? "sheet" : "list");
  };

  // Keep a valid selection so reopening the menu lands on the sheet you had open.
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

  const startEdit = (character: Character) => {
    setDraftName(character.name);
    setDraftMax({ ...character.tickerMax });
    setEditing(true);
  };
  const startBuild = (character: Character) => {
    startEdit(character);
    setBuilding(true);
  };
  const stopEdit = () => {
    setEditing(false);
    setBuilding(false);
  };
  const hasBuilder = (templateId: string) =>
    !!props.templates.find((template) => template.id === templateId)?.layout?.builder?.steps.length;

  // Values are saved one at a time as they're edited; Save commits the name and maxima.
  const saveEdit = async (character: Character) => {
    await props.onSave({
      id: character.id,
      name: draftName(),
      templateId: character.templateId,
      memberId: character.memberId,
      values: character.values,
      tickerMax: draftMax(),
    });
    stopEdit();
  };

  /** Template rolls keep their modifiers and visibility; anything else rolls its dice. */
  const rollFromSheet = (
    character: Character,
    template: SheetTemplate,
    label: string,
    dice: string,
    row?: RollRow,
  ) => {
    const defined = template.rolls.find((roll) => roll.label === label);
    if (defined) props.onRoll(character.id, defined.id, defined.visibility);
    // Only the owner or the DM can roll with a character's values.
    else
      props.onRollDice(
        dice,
        label,
        canEdit(character) ? { characterId: character.id, row } : undefined,
      );
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

  const create = async (event: Event, build = false) => {
    event.preventDefault();
    if (!newName().trim()) return;
    const templateId = newTemplateId() || props.templates[0]?.id || "";
    const character = await props.onSave({
      name: newName().trim(),
      templateId,
      memberId: props.isDm && !isShared(templateId) ? newMemberId() : props.me.id,
      values: {},
      ...(isShared(templateId) ? { scope: "world" as const } : {}),
    });
    setNewName("");
    setCreating(false);
    select(character.id);
    if (build) startBuild(character);
  };

  const memberName = (character: Character) =>
    shared(character)
      ? character.locked
        ? "Shared · locked"
        : "Shared"
      : (props.members.find((member) => member.id === character.memberId)?.displayName ??
        "Unassigned");

  return (
    <div {...sx(styles.col)}>
      <Show when={view() === "list" || props.characters.length === 0}>
        <div {...sx(styles.row)}>
          <div {...sx(styles.spacer)} />
          <Button variant="primary" small onClick={() => setCreating(true)}>
            New character
          </Button>
        </div>
      </Show>

      <Show
        when={props.characters.length > 0}
        fallback={<EmptyState>No characters yet. Create one to fill in a sheet.</EmptyState>}
      >
        <Show when={view() === "list"}>
          <div {...sx(sheetStyles.roster)}>
            <For each={roster()}>
              {(character) => {
                const trackers = () => trackerDefinitions(templateFor(props.templates, character));
                return (
                  <button {...sx(sheetStyles.rosterRow)} onClick={() => select(character.id)}>
                    <span {...sx(sheetStyles.portrait, sheetStyles.portraitSmall)}>
                      <Show
                        when={character.avatarKey}
                        fallback={character.name.slice(0, 1).toUpperCase()}
                      >
                        <img
                          src={api.avatarUrl(props.worldId, character.id, character.avatarKey!)}
                          alt=""
                          {...sx(sheetStyles.portraitImage)}
                        />
                      </Show>
                    </span>
                    <span {...sx(sheetStyles.identityText)}>
                      <span {...sx(sheetStyles.rosterName)}>{character.name}</span>
                      <span {...sx(sheetStyles.meta)}>{memberName(character)}</span>
                    </span>
                    <span {...sx(sheetStyles.rosterTrackers)}>
                      <For each={trackers()}>
                        {(ticker) => (
                          <span>
                            {ticker.label}{" "}
                            <strong>
                              {character.tickers[ticker.id] ?? ticker.defaultValue}/
                              {character.tickerMax?.[ticker.id] ?? ticker.max}
                            </strong>
                          </span>
                        )}
                      </For>
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>

        <Show when={view() === "sheet" && selected()}>
          {(character) => {
            const template = () => templateFor(props.templates, character());
            return (
              <Show when={template()}>
                {(sheet) => {
                  /** The sheet, or just some of its blocks (a builder step). */
                  const renderSheet = (blocks?: readonly string[]) => (
                    <SheetBlocks
                      layout={effectiveLayout(sheet())}
                      name={character().name}
                      showName={false}
                      values={character().values}
                      overrides={character().layoutPrefs}
                      editing={editing()}
                      customize={customizing() && !editing()}
                      trackerValue={(item) =>
                        character().tickers[item.key] ?? item.start ?? item.max
                      }
                      trackerMax={(item) =>
                        (editing() ? draftMax()[item.key] : undefined) ??
                        character().tickerMax?.[item.key] ??
                        item.max
                      }
                      computed={(key) =>
                        sheet().stats.some((stat) => stat.id === key)
                          ? computeStats(sheet().stats, character().values)[key]
                          : undefined
                      }
                      onTracker={(key, value) => {
                        if (canEdit(character())) props.onTicker(character().id, key, value);
                      }}
                      onTrackerMax={(key, max) =>
                        setDraftMax((previous) => {
                          const next = { ...previous };
                          if (max === null) delete next[key];
                          else next[key] = max;
                          return next;
                        })
                      }
                      onChange={(key, value) => {
                        if (canEdit(character()) && value !== undefined)
                          props.onValue(character().id, key, value as CharacterValue);
                      }}
                      onVariant={(blockId, variant) =>
                        props.onLayoutPref(character().id, blockId, variant)
                      }
                      onRoll={(label, dice, row) =>
                        rollFromSheet(character(), sheet(), label, dice, row)
                      }
                      readOnly={!canEdit(character())}
                      blocks={blocks}
                      compendium={props.compendium}
                      onOpenEntry={props.onOpenEntry}
                    />
                  );
                  return (
                    <div {...sx(sheetStyles.sheet)}>
                      <div {...sx(sheetStyles.bar)}>
                        <button {...sx(sheetStyles.barButton)} onClick={() => setView("list")}>
                          ← All
                        </button>
                        <div {...sx(styles.spacer)} />
                        <Show when={editing()}>
                          <button {...sx(sheetStyles.barButton)} onClick={stopEdit}>
                            Cancel
                          </button>
                          <button
                            {...sx(sheetStyles.barButton, sheetStyles.barPrimary)}
                            onClick={() => void saveEdit(character())}
                          >
                            {building() ? "Done" : "Save"}
                          </button>
                        </Show>
                        <Show when={!editing() && canEdit(character())}>
                          <button
                            {...sx(sheetStyles.barButton, customizing() && sheetStyles.barPrimary)}
                            aria-pressed={customizing() ? "true" : "false"}
                            title="Choose how each part of this sheet looks"
                            onClick={() => setCustomizing(!customizing())}
                          >
                            {customizing() ? "Done styling" : "Style"}
                          </button>
                          <Show when={!customizing()}>
                            <Show when={effectiveLayout(sheet()).builder?.steps.length}>
                              <button
                                {...sx(sheetStyles.barButton)}
                                title="Fill in this character step by step"
                                onClick={() => startBuild(character())}
                              >
                                Builder
                              </button>
                            </Show>
                            <button
                              {...sx(sheetStyles.barButton)}
                              onClick={() => startEdit(character())}
                            >
                              Edit
                            </button>
                          </Show>
                        </Show>
                        <Show
                          when={props.isDm && !editing() && shared(character()) && props.onLock}
                        >
                          <button
                            {...sx(sheetStyles.barButton)}
                            aria-pressed={character().locked ? "true" : "false"}
                            title={
                              character().locked
                                ? "Let every member edit this sheet again"
                                : "Only you can edit it while it's locked"
                            }
                            onClick={() => props.onLock?.(character().id, !character().locked)}
                          >
                            {character().locked ? "Unlock" : "Lock"}
                          </button>
                        </Show>
                        <Show when={props.isDm && !editing()}>
                          <button
                            {...sx(sheetStyles.barButton, sheetStyles.barDanger)}
                            onClick={() => {
                              setDeleteError("");
                              setDeleting(character());
                            }}
                          >
                            Delete
                          </button>
                        </Show>
                      </div>

                      <div {...sx(sheetStyles.identity, bandHeader() && sheetStyles.identityBand)}>
                        <label
                          {...sx(
                            sheetStyles.portrait,
                            canEdit(character()) && sheetStyles.portraitEditable,
                          )}
                          title={canEdit(character()) ? "Change picture" : undefined}
                        >
                          <Show
                            when={character().avatarKey}
                            fallback={<span>{character().name.slice(0, 1).toUpperCase()}</span>}
                          >
                            <img
                              src={api.avatarUrl(
                                props.worldId,
                                character().id,
                                character().avatarKey!,
                              )}
                              alt=""
                              {...sx(sheetStyles.portraitImage)}
                            />
                          </Show>
                          <Show when={canEdit(character())}>
                            <input
                              type="file"
                              aria-label="Change picture"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              style={{ display: "none" }}
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                if (file) void uploadAvatar(character(), file);
                                event.currentTarget.value = "";
                              }}
                            />
                          </Show>
                        </label>
                        <div {...sx(sheetStyles.identityText)}>
                          <Show
                            when={editing()}
                            fallback={
                              <h2 {...sx(sheetStyles.name, bandHeader() && sheetStyles.bandText)}>
                                {character().name}
                              </h2>
                            }
                          >
                            <input
                              {...sx(sheetStyles.input, sheetStyles.nameInput)}
                              aria-label="Name"
                              value={draftName()}
                              onInput={(event) => setDraftName(event.currentTarget.value)}
                            />
                          </Show>
                          <span {...sx(sheetStyles.meta, bandHeader() && sheetStyles.bandText)}>
                            {memberName(character())} · {sheet().name}
                          </span>
                        </div>
                      </div>
                      <Show when={avatarError()}>
                        <span {...sx(styles.errorBanner)}>{avatarError()}</span>
                      </Show>

                      <Show
                        when={building() && effectiveLayout(sheet()).builder?.steps.length}
                        fallback={renderSheet()}
                      >
                        <CharacterBuilder
                          context={{
                            get layout() {
                              return effectiveLayout(sheet());
                            },
                            get values() {
                              return character().values;
                            },
                            tracker: (key) => {
                              const item = layoutTrackers(effectiveLayout(sheet())).find(
                                (tracker) => tracker.key === key,
                              );
                              return item
                                ? {
                                    value: character().tickers[key] ?? item.start ?? item.max,
                                    max:
                                      draftMax()[key] ?? character().tickerMax?.[key] ?? item.max,
                                  }
                                : undefined;
                            },
                            scope: () =>
                              sheetScope(
                                effectiveLayout(sheet()),
                                refValues(
                                  effectiveLayout(sheet()),
                                  character().values,
                                  character().tickers,
                                ),
                              ),
                            get compendium() {
                              return props.compendium;
                            },
                            get readOnly() {
                              return !canEdit(character());
                            },
                          }}
                          actions={{
                            setValue: (key, value) => {
                              if (canEdit(character()) && value !== undefined)
                                props.onValue(character().id, key, value as CharacterValue);
                            },
                            setTracker: (key, value) => {
                              if (canEdit(character())) props.onTicker(character().id, key, value);
                            },
                            // A draft like Edit's maxima: saved with Done, dropped by Cancel.
                            setTrackerMax: (key, max) =>
                              setDraftMax((previous) => {
                                const next = { ...previous };
                                if (max === null) delete next[key];
                                else next[key] = max;
                                return next;
                              }),
                            roll: (label, dice) => rollFromSheet(character(), sheet(), label, dice),
                            rollTable: props.onRollTable,
                            openEntry: props.onOpenEntry,
                          }}
                          renderBlocks={(ids) => renderSheet(ids)}
                        />
                      </Show>
                    </div>
                  );
                }}
              </Show>
            );
          }}
        </Show>
      </Show>

      <Modal
        when={Boolean(deleting())}
        title="Delete character"
        onClose={() => {
          if (!deletingBusy()) setDeleting(null);
        }}
      >
        <div {...sx(styles.col)}>
          <p>Delete {deleting()?.name}? This cannot be undone.</p>
          <Show when={deleteError()}>
            <p>{deleteError()}</p>
          </Show>
          <Button disabled={deletingBusy()} onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={deletingBusy()}
            onClick={() => {
              const character = deleting();
              if (!character) return;
              setDeletingBusy(true);
              void props
                .onDelete(character.id)
                .then(() => {
                  setDeleting(null);
                  if (selectedId() === character.id) select(null);
                })
                .catch((error: unknown) => {
                  setDeleteError(
                    error instanceof Error ? error.message : "Could not delete character",
                  );
                })
                .finally(() => setDeletingBusy(false));
            }}
          >
            Delete character
          </Button>
        </div>
      </Modal>

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
          <Show when={isShared(newTemplateId())}>
            <span {...sx(styles.muted)}>
              A shared sheet: every member can edit it, and you can lock it.
            </span>
          </Show>
          <Show when={props.isDm && !isShared(newTemplateId())}>
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
          <div {...sx(styles.row)}>
            <Button type="submit" variant="primary" disabled={!newName().trim()}>
              Create
            </Button>
            <Show when={hasBuilder(newTemplateId() || props.templates[0]?.id || "")}>
              <Button disabled={!newName().trim()} onClick={(event) => void create(event, true)}>
                Create and open builder
              </Button>
            </Show>
          </div>
        </form>
      </Modal>
    </div>
  );
}
