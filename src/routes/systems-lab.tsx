import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal } from "solid-js";
import { SheetBlocks } from "../components/sheet-blocks";
import type { SheetLayout, SheetValues } from "../domain/sheet-layout";
import { bladesInTheDark, mothership, mythicBastionland } from "../domain/sheet-presets";
import { colors, fonts, skin } from "../theme/tokens.stylex";
import { skins, themeClass, themeNames, type ThemeName } from "../theme/themes";
import { sx } from "../theme/sx";

/*
 * Proof that game-system sheets can be pure data: three systems built from the
 * same generic blocks (src/domain/sheet-presets.ts), each in all three themes.
 */

const samples: { layout: SheetLayout; name: string; subtitle: string; values: SheetValues }[] = [
  {
    layout: mythicBastionland,
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
  {
    layout: mothership,
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
  {
    layout: bladesInTheDark,
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
      items: [
        { carried: true, item: "Fine lockpicks", load: 0 },
        { carried: true, item: "A blade or two", load: 1 },
        { carried: false, item: "Climbing gear", load: 2 },
      ],
    },
  },
];

const page = stylex.create({
  root: {
    minHeight: "100vh",
    padding: "24px",
    backgroundColor: "#3a3835",
    color: "#eee",
    fontFamily: "system-ui, sans-serif",
  },
  h1: { margin: "0 0 4px", fontSize: "20px", color: "#fff" },
  intro: { maxWidth: "1120px", marginBottom: "20px", fontSize: "14px", color: "#cfcac2" },
  system: { marginBottom: "28px" },
  h2: { margin: "0 0 10px", fontSize: "16px", color: "#fff" },
  row: { display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" },
  column: { display: "flex", flexDirection: "column", gap: "6px", width: "340px" },
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
  last: { fontSize: "12px", color: "#e8e2d6", minHeight: "16px" },
});

function Panel(props: { theme: ThemeName; sample: (typeof samples)[number] }) {
  const [values, setValues] = createSignal<SheetValues>(structuredClone(props.sample.values));
  const [last, setLast] = createSignal("");
  const roll = (label: string, dice: string) => {
    const match = /^(\d*)d(\d+)$/.exec(dice);
    if (!match) return;
    const count = Number(match[1] || 1);
    const results = Array.from(
      { length: count },
      () => 1 + Math.floor(Math.random() * Number(match[2])),
    );
    setLast(`${label}: ${dice} → ${results.join(", ")}`);
  };
  return (
    <div {...sx(page.column)}>
      <span {...sx(page.caption)}>{skins[props.theme].label}</span>
      <div {...sx(...themeClass(props.theme), page.panel)}>
        <SheetBlocks
          layout={props.sample.layout}
          name={props.sample.name}
          subtitle={props.sample.subtitle}
          values={values()}
          header={skins[props.theme].header}
          onChange={(key, value) => setValues((previous) => ({ ...previous, [key]: value }))}
          onRoll={roll}
        />
      </div>
      <Show when={last()}>
        <span {...sx(page.last)}>🎲 {last()}</span>
      </Show>
    </div>
  );
}

export default function SystemsLab() {
  return (
    <main {...sx(page.root)}>
      <h1 {...sx(page.h1)}>Game systems from generic blocks</h1>
      <p {...sx(page.intro)}>
        Each sheet is data (src/domain/sheet-presets.ts) rendered by one component. Trackers
        (number, pips, bar, clock), stat strips, field grids, typed lists with rollable dice,
        checkbox rows, text and rolls — nothing system-specific in code. Everything is clickable.
      </p>
      <For each={samples}>
        {(sample) => (
          <section {...sx(page.system)}>
            <h2 {...sx(page.h2)}>{sample.layout.system}</h2>
            <div {...sx(page.row)}>
              <For each={themeNames}>{(theme) => <Panel theme={theme} sample={sample} />}</For>
            </div>
          </section>
        )}
      </For>
    </main>
  );
}
