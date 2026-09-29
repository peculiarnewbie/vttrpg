import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/400-italic.css";
import "@fontsource/eb-garamond/600.css";
import "@fontsource/im-fell-english-sc/400.css";
import "@fontsource/anton/400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/800.css";
import "@fontsource/alegreya/400.css";
import "@fontsource/alegreya/400-italic.css";
import "@fontsource/alegreya/700.css";
import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal } from "solid-js";
import { sx } from "../theme/sx";

/*
 * Design lab: the same character sheet in three candidate art directions, at the
 * real tools-panel width, so the table can pick one before the app is restyled.
 * Static sample data; steppers and pips work locally.
 */

type Tracker = { id: string; label: string; short: string; value: number; max: number };

const sample = {
  name: "Sir Tamsin",
  title: "The Ford Knight",
  player: "Arif",
  trackers: [
    { id: "vig", label: "Vigour", short: "VIG", value: 14, max: 14 },
    { id: "cla", label: "Clarity", short: "CLA", value: 9, max: 11 },
    { id: "spi", label: "Spirit", short: "SPI", value: 11, max: 12 },
    { id: "gd", label: "Guard", short: "GD", value: 3, max: 5 },
  ] satisfies Tracker[],
  stats: [
    { label: "Armour", value: "1" },
    { label: "Glory", value: "2" },
    { label: "Rank", value: "Knight" },
    { label: "Age", value: "31" },
  ],
  rolls: [
    { label: "Longsword", dice: "d8" },
    { label: "Dagger", dice: "d6" },
    { label: "Shield bash", dice: "d4" },
    { label: "Save", dice: "d20", note: "me" },
  ],
  groups: [
    {
      name: "Knight",
      fields: [
        { label: "Seer", value: "The Weeping Oak" },
        { label: "Passion", value: "Mercy" },
        { label: "Ambition", value: "Hold the ford" },
        { label: "Oath", value: "No blade crosses" },
      ],
    },
    {
      name: "Property",
      long: "Longsword (d8), round shield (A1), dagger (d6), hooded lantern, rope, three days of rations, a map of the Mire with one river inked in red.",
    },
    {
      name: "Scars",
      long: "Cloven jaw — speaks slowly (−1 CLA max).\nSaw the Wyrm's eye — cannot sleep beneath open sky.",
    },
  ],
};

type Variant = {
  key: string;
  title: string;
  blurb: string;
  ornament: string;
  pips: boolean;
  s: Record<string, stylex.StyleXStyles>;
};

// ---------------------------------------------------------------------------
// 1. Rulebook — a printed page: paper grain, ink serif, small caps, one oxblood.
// ---------------------------------------------------------------------------
const ink = "#1f1a14";
const oxblood = "#7a1f1a";
const rulebook = stylex.create({
  backdrop: { backgroundColor: "#cfc3a8", padding: "14px" },
  root: {
    width: "340px",
    padding: "14px 16px 18px",
    color: ink,
    fontFamily: "'EB Garamond', Georgia, serif",
    fontSize: "15px",
    lineHeight: 1.3,
    backgroundColor: "#f1e9d6",
    backgroundImage:
      "radial-gradient(rgba(110,80,30,0.07) 1px, transparent 1.2px), radial-gradient(ellipse at 30% 0%, rgba(255,255,255,0.5), transparent 60%)",
    backgroundSize: "3px 3px, 100% 100%",
    boxShadow: "0 1px 0 #fff8 inset, 0 6px 24px rgba(40,25,5,0.25)",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  header: { textAlign: "center", paddingBottom: "2px" },
  name: {
    margin: 0,
    fontFamily: "'IM Fell English SC', Georgia, serif",
    fontSize: "30px",
    fontWeight: 400,
    lineHeight: 1,
    letterSpacing: "0.02em",
  },
  title: { fontStyle: "italic", fontSize: "15px", color: "#5a4a36" },
  meta: { fontSize: "12px", color: "#7d6b53" },
  head: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "4px",
    fontFamily: "'IM Fell English SC', Georgia, serif",
    fontSize: "15px",
    color: oxblood,
  },
  rule: { flex: 1, height: "1px", backgroundColor: "#8a765a" },
  trackers: { display: "flex", flexDirection: "column", gap: "4px" },
  tracker: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto auto",
    alignItems: "baseline",
    gap: "6px",
    borderBottomWidth: "1px",
    borderBottomStyle: "dotted",
    borderBottomColor: "#a08c6c",
    paddingBottom: "2px",
  },
  trackerLabel: { fontSize: "16px" },
  value: { fontSize: "20px", fontWeight: 600, fontVariantNumeric: "oldstyle-nums" },
  max: { fontSize: "14px", color: "#7d6b53" },
  step: {
    width: "20px",
    height: "20px",
    padding: 0,
    borderRadius: "50%",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#8a765a",
    backgroundColor: { default: "transparent", ":hover": "#e6dcc3" },
    color: ink,
    fontFamily: "inherit",
    fontSize: "14px",
    lineHeight: 1,
    cursor: "pointer",
  },
  stats: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", textAlign: "center" },
  stat: {
    display: "flex",
    flexDirection: "column",
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: "#b3a282",
    ":last-child": { borderRightWidth: 0 },
  },
  statLabel: { fontFamily: "'IM Fell English SC', serif", fontSize: "12px", color: "#6a5840" },
  statValue: { fontSize: "20px", fontWeight: 600, lineHeight: 1.1 },
  rolls: { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: "14px", rowGap: "2px" },
  roll: {
    display: "flex",
    alignItems: "baseline",
    gap: "6px",
    padding: "1px 0",
    borderWidth: 0,
    backgroundColor: "transparent",
    color: ink,
    fontFamily: "inherit",
    fontSize: "15px",
    textAlign: "left",
    cursor: "pointer",
    ":hover": { color: oxblood },
  },
  rollLabel: { flex: 1, textDecorationLine: "underline", textDecorationStyle: "dotted" },
  rollDice: { fontStyle: "italic", color: oxblood },
  badge: { fontSize: "11px", fontStyle: "italic", color: "#7d6b53" },
  fields: { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: "14px" },
  field: { display: "flex", flexDirection: "column", paddingBottom: "3px" },
  fieldLabel: { fontFamily: "'IM Fell English SC', serif", fontSize: "12px", color: "#6a5840" },
  fieldValue: { fontSize: "15px", fontStyle: "italic" },
  long: { fontSize: "14px", whiteSpace: "pre-wrap", textIndent: "1em" },
  pip: {},
  pipOn: {},
});

// ---------------------------------------------------------------------------
// 2. OSR zine — black on off-white, one riso ink, condensed caps, halftone.
// ---------------------------------------------------------------------------
const riso = "#ff4f8b";
const zine = stylex.create({
  backdrop: { backgroundColor: "#d9d6cf", padding: "14px" },
  root: {
    width: "340px",
    padding: "0 0 14px",
    color: "#111",
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: "12px",
    lineHeight: 1.35,
    backgroundColor: "#f7f4ec",
    borderWidth: "3px",
    borderStyle: "solid",
    borderColor: "#111",
    boxShadow: `6px 6px 0 ${riso}`,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  header: {
    padding: "10px 12px 8px",
    color: "#111",
    backgroundColor: riso,
    backgroundImage: "radial-gradient(rgba(17,17,17,0.35) 1px, transparent 1.4px)",
    backgroundSize: "5px 5px",
    borderBottomWidth: "3px",
    borderBottomStyle: "solid",
    borderBottomColor: "#111",
  },
  name: {
    margin: 0,
    fontFamily: "Anton, Impact, sans-serif",
    fontSize: "40px",
    fontWeight: 400,
    lineHeight: 0.95,
    textTransform: "uppercase",
    letterSpacing: "0.01em",
  },
  title: { fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" },
  meta: { fontSize: "11px" },
  head: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginInline: "12px",
    marginTop: "2px",
    fontFamily: "Anton, Impact, sans-serif",
    fontSize: "18px",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  rule: { flex: 1, height: "3px", backgroundColor: "#111" },
  trackers: { display: "flex", flexDirection: "column", gap: "5px", marginInline: "12px" },
  tracker: {
    display: "grid",
    gridTemplateColumns: "40px 1fr auto",
    alignItems: "center",
    gap: "6px",
  },
  trackerLabel: { fontFamily: "Anton, Impact, sans-serif", fontSize: "18px", lineHeight: 1 },
  value: { fontWeight: 600, fontSize: "14px" },
  max: { fontSize: "11px" },
  step: {},
  pips: { display: "flex", flexWrap: "wrap", gap: "2px" },
  pip: {
    width: "13px",
    height: "13px",
    padding: 0,
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: "#111",
    backgroundColor: { default: "transparent", ":hover": "#ffd0e0" },
    cursor: "pointer",
  },
  pipOn: { backgroundColor: { default: "#111", ":hover": "#333" } },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    marginInline: "12px",
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: "#111",
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBlock: "3px",
    borderRightWidth: "2px",
    borderRightStyle: "solid",
    borderRightColor: "#111",
    ":last-child": { borderRightWidth: 0 },
  },
  statLabel: { fontSize: "10px", fontWeight: 600, textTransform: "uppercase" },
  statValue: { fontFamily: "Anton, Impact, sans-serif", fontSize: "22px", lineHeight: 1.05 },
  rolls: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "4px",
    marginInline: "12px",
  },
  roll: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 6px",
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: "#111",
    backgroundColor: { default: "#fff", ":hover": riso },
    color: "#111",
    fontFamily: "inherit",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase",
    cursor: "pointer",
    boxShadow: { default: "2px 2px 0 #111", ":active": "none" },
  },
  rollLabel: { flex: 1, textAlign: "left" },
  rollDice: { fontFamily: "Anton, Impact, sans-serif", fontSize: "15px", fontWeight: 400 },
  badge: { fontSize: "9px", paddingInline: "3px", backgroundColor: "#111", color: "#f7f4ec" },
  fields: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "4px 12px",
    marginInline: "12px",
  },
  field: { display: "flex", flexDirection: "column" },
  fieldLabel: { fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#555" },
  fieldValue: { fontSize: "13px", fontWeight: 600 },
  long: { marginInline: "12px", whiteSpace: "pre-wrap" },
});

// ---------------------------------------------------------------------------
// 3. Dark fantasy — deep black, worn bronze and gold, engraved display type.
// ---------------------------------------------------------------------------
const gold = "#c9a45a";
const fantasy = stylex.create({
  backdrop: {
    padding: "14px",
    backgroundColor: "#0b0a09",
    backgroundImage: "radial-gradient(ellipse at 50% 30%, #2a2219, #0b0a09 70%)",
  },
  root: {
    width: "340px",
    padding: "14px 14px 18px",
    color: "#e8dcc4",
    fontFamily: "Alegreya, Georgia, serif",
    fontSize: "14px",
    lineHeight: 1.3,
    backgroundColor: "#16130f",
    backgroundImage:
      "radial-gradient(rgba(255,230,180,0.035) 1px, transparent 1.3px), linear-gradient(180deg, #1d1813, #110e0b)",
    backgroundSize: "4px 4px, 100% 100%",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#6b5532",
    boxShadow: `0 0 0 3px #0b0a09, 0 0 0 4px ${gold}55, 0 10px 40px rgba(0,0,0,0.7)`,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  header: { textAlign: "center" },
  name: {
    margin: 0,
    fontFamily: "Cinzel, Georgia, serif",
    fontSize: "26px",
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: gold,
    textShadow: "0 1px 0 #000, 0 0 18px rgba(201,164,90,0.25)",
  },
  title: { fontStyle: "italic", color: "#b8a888" },
  meta: { fontSize: "11px", color: "#8a7b60" },
  head: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "4px",
    fontFamily: "Cinzel, Georgia, serif",
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: gold,
  },
  rule: {
    flex: 1,
    height: "1px",
    backgroundImage: `linear-gradient(90deg, transparent, ${gold}, transparent)`,
  },
  trackers: { display: "flex", flexDirection: "column", gap: "6px" },
  tracker: {
    display: "grid",
    gridTemplateColumns: "56px 20px 1fr 20px",
    alignItems: "center",
    gap: "6px",
  },
  trackerLabel: {
    fontFamily: "Cinzel, Georgia, serif",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#d8c8a4",
  },
  meter: {
    position: "relative",
    height: "20px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#6b5532",
    backgroundColor: "#0b0908",
    boxShadow: "inset 0 1px 4px #000",
    overflow: "hidden",
  },
  meterFill: {
    position: "absolute",
    insetBlock: 0,
    left: 0,
    backgroundImage: "linear-gradient(180deg, #a4332a, #5c1712)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
  },
  meterText: {
    position: "relative",
    display: "block",
    textAlign: "center",
    fontFamily: "Cinzel, Georgia, serif",
    fontSize: "12px",
    fontWeight: 600,
    lineHeight: "19px",
    color: "#f3e6c8",
    textShadow: "0 1px 2px #000",
  },
  value: {},
  max: {},
  step: {
    width: "20px",
    height: "20px",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#6b5532",
    backgroundColor: { default: "#1f1a14", ":hover": "#2c241a" },
    color: gold,
    fontSize: "13px",
    lineHeight: 1,
    transform: "rotate(45deg) scale(0.8)",
    cursor: "pointer",
  },
  stepGlyph: { display: "inline-block", transform: "rotate(-45deg)" },
  stats: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" },
  stat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBlock: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "#4d3d24",
    backgroundColor: "#0f0d0a",
  },
  statLabel: {
    fontFamily: "Cinzel, serif",
    fontSize: "9px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#a8946c",
  },
  statValue: { fontFamily: "Cinzel, serif", fontSize: "18px", fontWeight: 800, color: "#f0e2c0" },
  rolls: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" },
  roll: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "5px 8px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: "#4d3d24", ":hover": gold },
    backgroundColor: { default: "#1b1611", ":hover": "#241c14" },
    color: "#e8dcc4",
    fontFamily: "inherit",
    fontSize: "14px",
    cursor: "pointer",
  },
  rollLabel: { flex: 1, textAlign: "left" },
  rollDice: { fontFamily: "Cinzel, serif", fontSize: "12px", fontWeight: 600, color: gold },
  badge: { fontSize: "10px", fontStyle: "italic", color: "#8a7b60" },
  fields: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" },
  field: { display: "flex", flexDirection: "column" },
  fieldLabel: {
    fontFamily: "Cinzel, serif",
    fontSize: "9px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#a8946c",
  },
  fieldValue: { fontSize: "15px", fontStyle: "italic", color: "#f0e2c0" },
  long: { whiteSpace: "pre-wrap", color: "#d8ccb0" },
  pip: {},
  pipOn: {},
});

const variants: Variant[] = [
  {
    key: "rulebook",
    title: "1 · Rulebook",
    blurb: "Printed page: paper grain, ink serif, small caps, one oxblood accent.",
    ornament: "❦",
    pips: false,
    s: rulebook,
  },
  {
    key: "zine",
    title: "2 · OSR zine",
    blurb: "Black on off-white, one riso ink, condensed caps, halftone. Pips you click.",
    ornament: "■",
    pips: true,
    s: zine,
  },
  {
    key: "fantasy",
    title: "3 · Dark fantasy",
    blurb: "Deep black, worn bronze and gold, engraved display type, gem-like meters.",
    ornament: "✦",
    pips: false,
    s: fantasy,
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
  intro: { maxWidth: "1100px", marginBottom: "18px", fontSize: "14px", color: "#cfcac2" },
  h1: { margin: "0 0 4px", fontSize: "20px", color: "#fff" },
  grid: { display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" },
  column: { display: "flex", flexDirection: "column", gap: "8px", width: "368px" },
  label: { fontSize: "15px", fontWeight: 700, color: "#fff" },
  blurb: { fontSize: "12px", color: "#bdb7ad", minHeight: "32px" },
});

function Sheet(props: { variant: Variant }) {
  const v = props.variant;
  const s = v.s;
  const [trackers, setTrackers] = createSignal(sample.trackers.map((t) => ({ ...t })));
  const set = (id: string, value: number) =>
    setTrackers((all) =>
      all.map((t) => (t.id === id ? { ...t, value: Math.max(0, Math.min(t.max, value)) } : t)),
    );
  const Head = (headProps: { children: string }) => (
    <div {...sx(s.head)}>
      <span aria-hidden="true">{v.ornament}</span>
      {headProps.children}
      <span {...sx(s.rule)} />
    </div>
  );

  return (
    <div {...sx(s.backdrop)}>
      <article {...sx(s.root)} aria-label={`${v.title} character sheet`}>
        <header {...sx(s.header)}>
          <h2 {...sx(s.name)}>{sample.name}</h2>
          <div {...sx(s.title)}>{sample.title}</div>
          <div {...sx(s.meta)}>played by {sample.player}</div>
        </header>

        <Head>Virtues &amp; Guard</Head>
        <div {...sx(s.trackers)}>
          <For each={trackers()}>
            {(t) => (
              <Show
                when={v.pips}
                fallback={
                  <Show
                    when={v.key === "fantasy"}
                    fallback={
                      <div {...sx(s.tracker)}>
                        <span {...sx(s.trackerLabel)}>{t.label}</span>
                        <button
                          {...sx(s.step)}
                          aria-label={`Decrease ${t.label}`}
                          onClick={() => set(t.id, t.value - 1)}
                        >
                          −
                        </button>
                        <span>
                          <span {...sx(s.value)}>{t.value}</span>
                          <span {...sx(s.max)}> / {t.max}</span>
                        </span>
                        <button
                          {...sx(s.step)}
                          aria-label={`Increase ${t.label}`}
                          onClick={() => set(t.id, t.value + 1)}
                        >
                          +
                        </button>
                      </div>
                    }
                  >
                    <div {...sx(s.tracker)}>
                      <span {...sx(s.trackerLabel)}>{t.label}</span>
                      <button
                        {...sx(s.step)}
                        aria-label={`Decrease ${t.label}`}
                        onClick={() => set(t.id, t.value - 1)}
                      >
                        <span {...sx(fantasy.stepGlyph)}>−</span>
                      </button>
                      <div {...sx(fantasy.meter)}>
                        <div
                          {...sx(fantasy.meterFill)}
                          style={{ width: `${(t.value / t.max) * 100}%` }}
                        />
                        <span {...sx(fantasy.meterText)}>
                          {t.value} / {t.max}
                        </span>
                      </div>
                      <button
                        {...sx(s.step)}
                        aria-label={`Increase ${t.label}`}
                        onClick={() => set(t.id, t.value + 1)}
                      >
                        <span {...sx(fantasy.stepGlyph)}>+</span>
                      </button>
                    </div>
                  </Show>
                }
              >
                <div {...sx(s.tracker)}>
                  <span {...sx(s.trackerLabel)}>{t.short}</span>
                  <div {...sx(zine.pips)} role="group" aria-label={t.label}>
                    <For each={Array.from({ length: t.max }, (_, i) => i + 1)}>
                      {(n) => (
                        <button
                          {...sx(s.pip, n <= t.value && s.pipOn)}
                          aria-label={`Set ${t.label} to ${n}`}
                          onClick={() => set(t.id, n === t.value ? n - 1 : n)}
                        />
                      )}
                    </For>
                  </div>
                  <span {...sx(s.value)}>
                    {t.value}
                    <span {...sx(s.max)}>/{t.max}</span>
                  </span>
                </div>
              </Show>
            )}
          </For>
        </div>

        <div {...sx(s.stats)}>
          <For each={sample.stats}>
            {(stat) => (
              <div {...sx(s.stat)}>
                <span {...sx(s.statLabel)}>{stat.label}</span>
                <span {...sx(s.statValue)}>{stat.value}</span>
              </div>
            )}
          </For>
        </div>

        <Head>Arms</Head>
        <div {...sx(s.rolls)}>
          <For each={sample.rolls}>
            {(roll) => (
              <button {...sx(s.roll)}>
                <span {...sx(s.rollLabel)}>{roll.label}</span>
                <Show when={roll.note}>
                  <span {...sx(s.badge)}>{roll.note}</span>
                </Show>
                <span {...sx(s.rollDice)}>{roll.dice}</span>
              </button>
            )}
          </For>
        </div>

        <For each={sample.groups}>
          {(group) => (
            <>
              <Head>{group.name}</Head>
              <Show when={group.fields} fallback={<p {...sx(s.long)}>{group.long}</p>}>
                {(fields) => (
                  <div {...sx(s.fields)}>
                    <For each={fields()}>
                      {(field) => (
                        <div {...sx(s.field)}>
                          <span {...sx(s.fieldLabel)}>{field.label}</span>
                          <span {...sx(s.fieldValue)}>{field.value}</span>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </Show>
            </>
          )}
        </For>
      </article>
    </div>
  );
}

export default function SheetLab() {
  return (
    <main {...sx(page.root)}>
      <div {...sx(page.intro)}>
        <h1 {...sx(page.h1)}>Character sheet — three directions</h1>
        Same Mythic Bastionland knight, each at the real 340px panel width. Steppers and pips work.
        Pick one and the whole app follows it.
      </div>
      <div {...sx(page.grid)}>
        <For each={variants}>
          {(variant) => (
            <section {...sx(page.column)}>
              <span {...sx(page.label)}>{variant.title}</span>
              <span {...sx(page.blurb)}>{variant.blurb}</span>
              <Sheet variant={variant} />
            </section>
          )}
        </For>
      </div>
    </main>
  );
}
