import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal } from "solid-js";
import { SheetBlocks } from "../components/sheet-blocks";
import type {
  LayoutBlock,
  SheetLayout,
  SheetValues,
  VariantOverrides,
} from "../domain/sheet-layout";
import { presets } from "../domain/sheet-presets";
import { colors, fonts, skin } from "../theme/tokens.stylex";
import { skins, themeClass, themeNames } from "../theme/themes";
import { sx } from "../theme/sx";

/*
 * Proof that game-system sheets can be pure data: premade layouts built from the
 * same generic blocks (src/domain/sheet-presets.ts), in every theme, at phone,
 * panel, and wide widths. Customize swaps a block's variant (a viewer's own
 * choice) or its span (a layout edit), live across all three themes.
 */

const characters: Record<string, { name: string; subtitle: string; values: SheetValues }> = {
  "Mythic Bastionland": {
    name: "Sir Tamsin",
    subtitle: "The Ford Knight",
    values: {
      vig: 14,
      cla: 9,
      spi: 11,
      gd: 3,
      glory: 2,
      armour: 1,
      rank: "Knight",
      age: 31,
      property: [
        { item: "Longsword", dmg: "d8", tags: ["hefty"] },
        { item: "Round shield", dmg: "", tags: ["A1"] },
        { item: "Dagger", dmg: "d6", tags: [] },
        { item: "Hooded lantern", dmg: "", tags: [] },
      ],
      seer: "The Weeping Oak",
      passion: "Mercy",
      ambition: "Hold the ford",
      oath: "No blade crosses",
      ability: "Ferryman's Right — once per journey, name a crossing and it will hold.",
      scars: [{ scar: "Cloven jaw" }, { scar: "Saw the Wyrm's eye" }],
      fatigue: ["Hungry"],
    },
  },
  Mothership: {
    name: "Rook Okafor",
    subtitle: "Marine · Pinkerton-class hauler",
    values: {
      str: 45,
      spd: 35,
      int: 28,
      com: 50,
      san: 30,
      fear: 25,
      body: 35,
      hp: 8,
      wounds: 1,
      stress: 4,
      conditions: ["Frightened"],
      skills: [
        { skill: "Military Training", tier: ["Trained"], bonus: 10 },
        { skill: "Athletics", tier: ["Trained"], bonus: 10 },
        { skill: "Firearms", tier: ["Expert"], bonus: 15 },
      ],
      weapons: [
        { name: "Pulse rifle", dmg: "3d10", shots: 5 },
        { name: "Combat knife", dmg: "1d10", shots: "" },
      ],
      gear: [
        { item: "Vaccsuit", notes: "AP 7" },
        { item: "Motion tracker", notes: "" },
      ],
      credits: "1,250",
      trinket: "Faded photograph of a moon",
    },
  },
  "Blades in the Dark": {
    name: "Silk",
    subtitle: "Lurk · Crow's Foot",
    values: {
      playbook: "Lurk",
      heritage: "Iruvia",
      vice: "Gambling",
      look: "Long coat, soot-dark gloves",
      stress: 4,
      trauma: ["Paranoid"],
      harm: [
        { level: 2, harm: "Broken wrist" },
        { level: 1, harm: "Battered" },
      ],
      healing: 1,
      vendetta: 5,
      hunt: 1,
      study: 2,
      survey: 1,
      tinker: 0,
      finesse: 2,
      prowl: 3,
      skirmish: 1,
      wreck: 0,
      attune: 0,
      command: 1,
      consort: 2,
      sway: 1,
      items: [
        { carried: true, item: "Fine lockpicks", load: 0 },
        { carried: true, item: "A blade or two", load: 1 },
        { carried: false, item: "Climbing gear", load: 2 },
      ],
    },
  },
};

const widths = { phone: 290, panel: 340, wide: 720 } as const;
type Width = keyof typeof widths;

/** Set a block's span (panel) or wide span anywhere in the layout, groups included. */
const withSpan = (layout: SheetLayout, id: string, key: "span" | "wide", value: number) => ({
  ...layout,
  pages: layout.pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) =>
      block.id === id ? ({ ...block, [key]: value } as LayoutBlock) : block,
    ),
  })),
});

const page = stylex.create({
  root: {
    minHeight: "100vh",
    padding: "24px",
    colorScheme: "dark",
    backgroundColor: "#3a3835",
    color: "#eee",
    fontFamily: "system-ui, sans-serif",
  },
  h1: { margin: "0 0 4px", fontSize: "20px", color: "#fff" },
  intro: { maxWidth: "1120px", margin: "0 0 14px", fontSize: "14px", color: "#cfcac2" },
  controls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "14px",
    marginBottom: "18px",
    fontSize: "13px",
  },
  group: { display: "inline-flex", alignItems: "center", gap: "4px" },
  toggle: {
    paddingInline: "10px",
    paddingBlock: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#77716a",
    borderRadius: "4px",
    backgroundColor: "transparent",
    color: "#eee",
    cursor: "pointer",
  },
  on: { backgroundColor: "#eee", color: "#222" },
  row: { display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" },
  column: { display: "flex", flexDirection: "column", gap: "6px" },
  caption: { fontSize: "12px", color: "#bdb7ad" },
  panel: {
    padding: "12px",
    color: colors.text,
    fontFamily: fonts.body,
    backgroundColor: colors.surface,
    backgroundImage: skin.paper,
    backgroundSize: skin.paperSize,
    borderWidth: skin.panelBorderWidth,
    borderStyle: "solid",
    borderColor: colors.border,
    boxShadow: skin.panelShadow,
  },
  footer: { marginTop: "14px", fontSize: "12px", color: "#cfcac2" },
  code: { fontFamily: "ui-monospace, monospace", color: "#ffd9a8" },
});

export default function SystemsLab() {
  const [presetIndex, setPresetIndex] = createSignal(0);
  const [layout, setLayout] = createSignal<SheetLayout>(presets[0]);
  const [width, setWidth] = createSignal<Width>("panel");
  const [customize, setCustomize] = createSignal(false);
  const [overrides, setOverrides] = createSignal<VariantOverrides>({});
  const [values, setValues] = createSignal<SheetValues>({});
  const [last, setLast] = createSignal("");
  const character = () => characters[layout().system];
  const choose = (index: number) => {
    setPresetIndex(index);
    setLayout(presets[index]);
    setOverrides({});
    setValues(structuredClone(characters[presets[index].system].values));
  };
  choose(0);
  const roll = (label: string, dice: string) => {
    const match = /^(\d*)d(\d+)$/.exec(dice);
    if (!match) return;
    const results = Array.from(
      { length: Number(match[1] || 1) },
      () => 1 + Math.floor(Math.random() * Number(match[2])),
    );
    setLast(`${label}: ${dice} → ${results.join(", ")}`);
  };

  return (
    <main {...sx(page.root)}>
      <h1 {...sx(page.h1)}>Game systems from generic blocks</h1>
      <p {...sx(page.intro)}>
        Premade layouts are data rendered by one component on a 6-column flow grid. Every block has
        variants over the same data; narrow sheets stack, wide ones use each block's wide span.
        Customize shows per-block controls: style is a player's own choice, width edits the layout.
        Everything is clickable.
      </p>
      <div {...sx(page.controls)}>
        <label {...sx(page.group)}>
          Layout
          <select
            aria-label="Layout"
            value={presetIndex()}
            onChange={(event) => choose(Number(event.currentTarget.value))}
          >
            <For each={presets}>
              {(preset, index) => (
                <option value={index()}>
                  {preset.system} — {preset.name}
                </option>
              )}
            </For>
          </select>
        </label>
        <span {...sx(page.group)} role="group" aria-label="Sheet width">
          <For each={Object.keys(widths) as Width[]}>
            {(key) => (
              <button
                {...sx(page.toggle, width() === key && page.on)}
                aria-pressed={width() === key ? "true" : "false"}
                onClick={() => setWidth(key)}
              >
                {key} {widths[key]}px
              </button>
            )}
          </For>
        </span>
        <button
          {...sx(page.toggle, customize() && page.on)}
          aria-pressed={customize() ? "true" : "false"}
          onClick={() => setCustomize(!customize())}
        >
          Customize
        </button>
        <button
          {...sx(page.toggle)}
          onClick={() => {
            setLayout(presets[presetIndex()]);
            setOverrides({});
          }}
        >
          Reset
        </button>
        <Show when={last()}>
          <span>🎲 {last()}</span>
        </Show>
      </div>
      <div {...sx(page.row)}>
        <For each={themeNames}>
          {(theme) => (
            <div {...sx(page.column)} style={{ width: `${widths[width()] + 24}px` }}>
              <span {...sx(page.caption)}>{skins[theme].label}</span>
              <div {...sx(...themeClass(theme), page.panel)}>
                <SheetBlocks
                  layout={layout()}
                  name={character().name}
                  subtitle={character().subtitle}
                  values={values()}
                  header={skins[theme].header}
                  overrides={overrides()}
                  customize={customize()}
                  onVariant={(id, variant) =>
                    setOverrides((previous) => ({ ...previous, [id]: variant }))
                  }
                  onSpan={(id, span) =>
                    setLayout((previous) =>
                      withSpan(previous, id, width() === "wide" ? "wide" : "span", span),
                    )
                  }
                  onChange={(key, value) =>
                    setValues((previous) => ({ ...previous, [key]: value }))
                  }
                  onRoll={roll}
                />
              </div>
            </div>
          )}
        </For>
      </div>
      <p {...sx(page.footer)}>
        Viewer's style overrides: <span {...sx(page.code)}>{JSON.stringify(overrides())}</span>
      </p>
    </main>
  );
}
