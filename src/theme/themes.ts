import * as stylex from "@stylexjs/stylex";
import { colors, fonts, radii, shadows, skin } from "./tokens.stylex";

/*
 * Three art directions, chosen per player (stored per browser):
 * - Rulebook: a printed page — paper grain, ink serif, small caps, one oxblood.
 * - OSR zine: black on off-white, one riso ink, condensed caps, hard offsets.
 * - Dark fantasy: deep black, worn bronze and gold, engraved display type.
 * Prototypes live at /lab/sheets.
 */

// ---------------------------------------------------------------------------
// Rulebook (light)
// ---------------------------------------------------------------------------
export const rulebookColors = stylex.createTheme(colors, {
  canvas: "#cfc3a8",
  surface: "#f1e9d6",
  surfaceRaised: "#f6f0e2",
  surfaceMuted: "#e6dcc3",
  surfaceHover: "#e9dfc8",
  overlay: "rgba(31, 26, 20, 0.4)",
  text: "#1f1a14",
  textMuted: "#5a4a36",
  textFaint: "#8a7a62",
  border: "#b3a282",
  borderStrong: "#8a765a",
  accent: "#7a1f1a",
  accentMuted: "#ecd4cc",
  accentText: "#f6f0e2",
  primary: "#7a1f1a",
  primaryHover: "#5e1612",
  primaryText: "#f6f0e2",
  secondary: "#5a4a36",
  danger: "#9b2c1f",
  dangerMuted: "#f0d6cf",
  success: "#4f6b3a",
  successMuted: "#dfe5d0",
  warning: "#a8741a",
  tag: "#7a1f1a",
  roll: "#7a1f1a",
});
export const rulebookFonts = stylex.createTheme(fonts, {
  sans: "'EB Garamond', Georgia, serif",
  body: "'EB Garamond', Georgia, serif",
  display: "'IM Fell English SC', Georgia, serif",
  numeric: "'EB Garamond', Georgia, serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
});
export const rulebookRadii = stylex.createTheme(radii, {
  sm: "2px",
  md: "2px",
  lg: "3px",
  xl: "4px",
  panel: "4px",
  full: "9999px",
});
export const rulebookSkin = stylex.createTheme(skin, {
  headTransform: "none",
  headTracking: "0.02em",
  headWeight: "400",
  nameTransform: "none",
  nameTracking: "0.02em",
  paper:
    "radial-gradient(rgba(110,80,30,0.07) 1px, transparent 1.2px), radial-gradient(ellipse at 30% 0%, rgba(255,255,255,0.5), transparent 60%)",
  paperSize: "3px 3px, 100% 100%",
  panelBorderWidth: "0px",
  panelShadow: "0 1px 0 #fff8 inset, 0 6px 24px rgba(40,25,5,0.25)",
  band: "none",
  bandSize: "auto",
  rule: "linear-gradient(#8a765a, #8a765a)",
  ruleHeight: "1px",
  ornament: '"❦"',
  controlRadius: "2px",
  controlShadow: "none",
  stepperRadius: "50%",
  stepperRotate: "0deg",
  meterTrack: "#e6dcc3",
  meterFill: "linear-gradient(#7a1f1a, #7a1f1a)",
  pipSize: "11px",
  pipRadius: "50%",
  pipBorder: "#5a4a36",
  pipOn: "#1f1a14",
});

// ---------------------------------------------------------------------------
// OSR zine (light)
// ---------------------------------------------------------------------------
export const zineColors = stylex.createTheme(colors, {
  canvas: "#d9d6cf",
  surface: "#f7f4ec",
  surfaceRaised: "#ffffff",
  surfaceMuted: "#ebe7dc",
  surfaceHover: "#ffd0e0",
  overlay: "rgba(17, 17, 17, 0.45)",
  text: "#111111",
  textMuted: "#444444",
  textFaint: "#777777",
  border: "#111111",
  borderStrong: "#111111",
  accent: "#ff4f8b",
  accentMuted: "#ffd0e0",
  accentText: "#111111",
  primary: "#111111",
  primaryHover: "#333333",
  primaryText: "#f7f4ec",
  secondary: "#444444",
  danger: "#d7263d",
  dangerMuted: "#ffd6dc",
  success: "#111111",
  successMuted: "#e6e6e6",
  warning: "#ff4f8b",
  tag: "#ff4f8b",
  roll: "#ff4f8b",
});
export const zineFonts = stylex.createTheme(fonts, {
  sans: "'IBM Plex Mono', ui-monospace, monospace",
  body: "'IBM Plex Mono', ui-monospace, monospace",
  display: "Anton, Impact, 'Arial Narrow', sans-serif",
  numeric: "Anton, Impact, 'Arial Narrow', sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
});
export const zineRadii = stylex.createTheme(radii, {
  sm: "0px",
  md: "0px",
  lg: "0px",
  xl: "0px",
  panel: "0px",
  full: "9999px",
});
export const zineSkin = stylex.createTheme(skin, {
  headTransform: "uppercase",
  headTracking: "0.03em",
  headWeight: "400",
  nameTransform: "uppercase",
  nameTracking: "0.01em",
  paper: "none",
  paperSize: "auto",
  panelBorderWidth: "3px",
  panelShadow: "6px 6px 0 #ff4f8b",
  band: "radial-gradient(rgba(17,17,17,0.35) 1px, transparent 1.4px)",
  bandSize: "5px 5px",
  rule: "linear-gradient(#111111, #111111)",
  ruleHeight: "3px",
  ornament: '"■"',
  controlRadius: "0px",
  controlShadow: "2px 2px 0 #111111",
  stepperRadius: "0px",
  stepperRotate: "0deg",
  meterTrack: "#f7f4ec",
  meterFill: "linear-gradient(#111111, #111111)",
  pipSize: "13px",
  pipRadius: "0px",
  pipBorder: "#111111",
  pipOn: "#111111",
});

// ---------------------------------------------------------------------------
// Dark fantasy (dark)
// ---------------------------------------------------------------------------
export const fantasyColors = stylex.createTheme(colors, {
  canvas: "#0b0a09",
  surface: "#16130f",
  surfaceRaised: "#1d1813",
  surfaceMuted: "#0f0d0a",
  surfaceHover: "#241c14",
  overlay: "rgba(0, 0, 0, 0.65)",
  text: "#e8dcc4",
  textMuted: "#b8a888",
  textFaint: "#8a7b60",
  border: "#4d3d24",
  borderStrong: "#6b5532",
  accent: "#c9a45a",
  accentMuted: "#2c2416",
  accentText: "#16130f",
  primary: "#c9a45a",
  primaryHover: "#dcb86e",
  primaryText: "#16130f",
  secondary: "#a8946c",
  danger: "#c0453a",
  dangerMuted: "#2e1512",
  success: "#8fae6a",
  successMuted: "#1b2016",
  warning: "#c9a45a",
  tag: "#c9a45a",
  roll: "#c9a45a",
});
export const fantasyFonts = stylex.createTheme(fonts, {
  sans: "Alegreya, Georgia, serif",
  body: "Alegreya, Georgia, serif",
  display: "Cinzel, Georgia, serif",
  numeric: "Cinzel, Georgia, serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
});
export const fantasyRadii = stylex.createTheme(radii, {
  sm: "2px",
  md: "2px",
  lg: "3px",
  xl: "4px",
  panel: "4px",
  full: "9999px",
});
export const fantasySkin = stylex.createTheme(skin, {
  headTransform: "uppercase",
  headTracking: "0.16em",
  headWeight: "600",
  nameTransform: "uppercase",
  nameTracking: "0.06em",
  paper:
    "radial-gradient(rgba(255,230,180,0.035) 1px, transparent 1.3px), linear-gradient(180deg, #1d1813, #110e0b)",
  paperSize: "4px 4px, 100% 100%",
  panelBorderWidth: "1px",
  panelShadow: "0 0 0 3px #0b0a09, 0 0 0 4px #c9a45a55, 0 10px 40px rgba(0,0,0,0.7)",
  band: "none",
  bandSize: "auto",
  rule: "linear-gradient(90deg, transparent, #c9a45a, transparent)",
  ruleHeight: "1px",
  ornament: '"✦"',
  controlRadius: "2px",
  controlShadow: "none",
  stepperRadius: "0px",
  stepperRotate: "45deg",
  meterTrack: "#0b0908",
  meterFill: "linear-gradient(180deg, #a4332a, #5c1712)",
  pipSize: "11px",
  pipRadius: "0px",
  pipBorder: "#6b5532",
  pipOn: "#a4332a",
});
export const fantasyShadows = stylex.createTheme(shadows, {
  modal: "0 0 0 1px #6b5532, 0 25px 60px -12px rgba(0, 0, 0, 0.8)",
});

export type ThemeName = "rulebook" | "zine" | "fantasy";
export const themeNames: readonly ThemeName[] = ["rulebook", "zine", "fantasy"];

/**
 * Structural knobs CSS can't express; components read these via `useTheme().skin()`.
 * - header: "centered" title block, or a full-width halftone "band" behind the name.
 */
export type Skin = { label: string; dark: boolean; header: "centered" | "band" };
export const skins: Record<ThemeName, Skin> = {
  rulebook: { label: "Rulebook", dark: false, header: "centered" },
  zine: { label: "OSR zine", dark: false, header: "band" },
  fantasy: { label: "Dark fantasy", dark: true, header: "centered" },
};

export const themeClass = (name: ThemeName) =>
  name === "zine"
    ? [zineColors, zineFonts, zineRadii, zineSkin]
    : name === "fantasy"
      ? [fantasyColors, fantasyFonts, fantasyRadii, fantasySkin, fantasyShadows]
      : [rulebookColors, rulebookFonts, rulebookRadii, rulebookSkin];
