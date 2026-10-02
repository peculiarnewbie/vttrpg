import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal, onSettled } from "solid-js";
import { api } from "../client/api";
import type { CompendiumStore } from "../client/compendium-store";
import type { WorldLibraries } from "../domain/corpus-rpc";
import type { SaveTemplateInput, SheetTemplate } from "../domain/schemas";
import { gameSystems, type GameSystem } from "../domain/systems";
import { colors, fontSize, space } from "../theme/tokens.stylex";
import { sx } from "../theme/sx";
import { styles } from "./styles.stylex";
import { Badge, Button, ErrorBanner } from "./ui";

/*
 * Start a world from one of the systems the app ships: its sheet templates,
 * and its library (rules text under an open licence) when one is published —
 * otherwise just its entry types, for the DM to fill. Systems without an open
 * licence never have a library. Nothing is replaced: templates and types
 * already in the world stay as they are.
 */

const templateName = (item: GameSystem, layout: { name: string }) =>
  `${item.system.name} — ${layout.name}`;

export function SystemSetup(props: {
  worldId: string;
  templates: readonly SheetTemplate[];
  onTemplates: (templates: SheetTemplate[]) => void;
  compendium: Pick<CompendiumStore, "typeById" | "refresh">;
  /** Libraries are on for this deployment. */
  corpus: boolean;
}) {
  const [libraries, setLibraries] = createSignal<WorldLibraries | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal("");
  const [error, setError] = createSignal("");
  const refreshLibraries = async () => {
    if (props.corpus) setLibraries(await api.libraries(props.worldId));
  };
  onSettled(() => {
    void refreshLibraries().catch(() => setLibraries(null));
  });

  const missingTemplates = (item: GameSystem) =>
    (item.system.layouts ?? []).filter(
      (layout) => !props.templates.some((template) => template.name === templateName(item, layout)),
    );
  const enabled = (item: GameSystem) =>
    libraries()?.enabled.some((source) => source.sourceId === item.source?.id) ?? false;
  const published = (item: GameSystem) =>
    libraries()?.available.some((source) => source.id === item.source?.id) ?? false;

  const setUp = async (item: GameSystem) => {
    setBusy(item.system.id);
    setError("");
    setNotice("");
    try {
      const added: SheetTemplate[] = [];
      for (const layout of missingTemplates(item)) {
        const input: SaveTemplateInput = {
          name: templateName(item, layout),
          layout,
          fields: [],
          stats: [],
          tickers: [],
          rolls: [],
        };
        added.push(await api.saveTemplate(props.worldId, input));
      }
      if (added.length) props.onTemplates([...props.templates, ...added]);
      let content = "";
      if (item.source && enabled(item)) content = "Its library was already enabled.";
      else if (item.source && published(item)) {
        await api.enableLibrary(props.worldId, item.source.id, {});
        content = `Enabled the ${item.source.name} library.`;
      } else {
        const fresh = item.system.entryTypes.filter((type) => !props.compendium.typeById(type.id));
        for (const type of fresh) await api.saveEntryType(props.worldId, type);
        content = fresh.length
          ? item.source
            ? "Added its entry types; its library isn't published here yet, so entries are yours to write."
            : "Added its entry types; entries are yours to write from your book."
          : "Its entry types were already here.";
      }
      await Promise.all([props.compendium.refresh(), refreshLibraries()]);
      setNotice(
        `${item.system.name}: ${added.length ? `added ${added.map((template) => template.name).join(", ")}. ` : "sheets were already here. "}${content}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not set up the system");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section {...sx(styles.col)} aria-label="Game systems">
      <h2 {...sx(styles.h3)}>Game systems</h2>
      <p {...sx(styles.muted)}>
        Start from a system: its character sheets, and its rules text where it's published under an
        open licence. You can change everything afterwards.
      </p>
      <ErrorBanner message={error()} />
      <Show when={notice()}>
        <p role="status" {...sx(s.notice)}>
          {notice()}
        </p>
      </Show>
      <div {...sx(s.grid)}>
        <For each={gameSystems}>
          {(item) => (
            <article {...sx(styles.card, styles.col)} aria-label={item.system.name}>
              <div {...sx(styles.row)}>
                <strong>{item.system.name}</strong>
                <div {...sx(styles.spacer)} />
                <Show when={enabled(item)}>
                  <Badge tone="accent">Library on</Badge>
                </Show>
              </div>
              <span {...sx(styles.muted)}>{item.system.description}</span>
              <span {...sx(s.small)}>
                Sheets: {(item.system.layouts ?? []).map((layout) => layout.name).join(", ")}
                {" · "}
                {item.source
                  ? `Text: ${item.source.name}, ${item.source.licence.name}`
                  : "No rules text: write entries from your own book"}
              </span>
              <div {...sx(styles.row)}>
                <Button
                  small
                  variant="primary"
                  disabled={busy() !== null}
                  onClick={() => void setUp(item)}
                >
                  {busy() === item.system.id ? "Setting up…" : "Use this system"}
                </Button>
                <Show when={item.source}>
                  <a href="/legal" {...sx(s.small)}>
                    Licence & attribution
                  </a>
                </Show>
              </div>
            </article>
          )}
        </For>
      </div>
    </section>
  );
}

const s = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: space.x3,
  },
  small: { fontSize: fontSize.caption, color: colors.textMuted },
  notice: { margin: 0, fontSize: fontSize.caption },
});
