import * as stylex from "@stylexjs/stylex";

/**
 * Design tokens for the TTRPG app.
 *
 * Every token is declared here with the PostHog ("warm paper") values as the
 * default. The two themes in `themes.ts` override them via `stylex.createTheme`.
 */
export const colors = stylex.defineVars({
  // surfaces (PostHog stack: sandy desk -> paper white)
  canvas: "#e1d7c2",
  surface: "#ffffff",
  surfaceRaised: "#fdfdf8",
  surfaceMuted: "#eeefe9",
  surfaceHover: "#e5e7e0",
  overlay: "rgba(35, 37, 29, 0.35)",
  // text
  text: "#23251d",
  textMuted: "#4d4f46",
  textFaint: "#9ea096",
  // borders
  border: "#bfc1b7",
  borderStrong: "#b3b3af",
  // accents
  accent: "#2f80fa",
  accentMuted: "#dbe8fe",
  accentText: "#ffffff",
  primary: "#eb9d2a",
  primaryHover: "#cd8407",
  primaryText: "#23251d",
  secondary: "#b17816",
  danger: "#d23401",
  dangerMuted: "#fbe3dc",
  success: "#6aa84f",
  successMuted: "#e6f0e0",
  warning: "#f1a82c",
  // categorical tags
  tag: "#f54e00",
  roll: "#2f80fa",
});

export const fonts = stylex.defineVars({
  /** Running text (alias kept for existing styles; equals `body` in every theme). */
  sans: "'EB Garamond', Georgia, serif",
  /** Running text: chat, notes, field values. */
  body: "'EB Garamond', Georgia, serif",
  /** Character names, section heads, panel titles, tab labels. */
  display: "'IM Fell English SC', Georgia, serif",
  /** Tracker values, stat numbers, dice results. */
  numeric: "'EB Garamond', Georgia, serif",
  mono: "'ui-monospace', 'SFMono-Regular', Menlo, Consolas, monospace",
});

/**
 * Skin tokens: the "art direction" knobs beyond colour and type. Values are raw
 * CSS so a theme can swap a flat rule for a gradient, round steppers for
 * diamonds, or a soft shadow for a hard riso offset without component changes.
 * Structural differences that CSS can't express live in `skins` (themes.ts).
 */
export const skin = stylex.defineVars({
  // headings (display font)
  headTransform: "none",
  headTracking: "0.02em",
  headWeight: "400",
  nameTransform: "none",
  nameTracking: "0.02em",
  // surfaces: panels, sheets, cards
  paper:
    "radial-gradient(rgba(110,80,30,0.07) 1px, transparent 1.2px), radial-gradient(ellipse at 30% 0%, rgba(255,255,255,0.5), transparent 60%)",
  paperSize: "3px 3px, 100% 100%",
  panelBorderWidth: "0px",
  panelShadow: "0 1px 0 #fff8 inset, 0 6px 24px rgba(40,25,5,0.25)",
  // header band behind a character name when skins[theme].header === "band"
  band: "none",
  bandSize: "auto",
  // section heads: a rule (background-image) and an ornament (CSS `content`)
  rule: "linear-gradient(#8a765a, #8a765a)",
  ruleHeight: "1px",
  ornament: '"❦"',
  // controls
  controlRadius: "2px",
  controlShadow: "none",
  stepperRadius: "50%",
  stepperRotate: "0deg",
  // trackers
  meterTrack: "#e6dcc3",
  meterFill: "linear-gradient(#7a1f1a, #7a1f1a)",
  pipSize: "11px",
  pipRadius: "50%",
  pipBorder: "#5a4a36",
  pipOn: "#1f1a14",
});

export const fontSize = stylex.defineVars({
  micro: "12px",
  caption: "14px",
  body: "16px",
  subheading: "19px",
  heading: "21px",
  headingLg: "24px",
  display: "36px",
});

export const fontWeight = stylex.defineVars({
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
});

export const lineHeight = stylex.defineVars({
  tight: "1.15",
  normal: "1.5",
  relaxed: "1.65",
});

export const letterSpacing = stylex.defineVars({
  tight: "-0.025em",
  normal: "0",
  wide: "0.04em",
});

export const space = stylex.defineVars({
  x1: "4px",
  x2: "6px",
  x3: "8px",
  x4: "12px",
  x5: "16px",
  x6: "24px",
  x7: "32px",
  x8: "48px",
});

export const radii = stylex.defineVars({
  sm: "3px",
  md: "4px",
  lg: "6px",
  xl: "10px",
  panel: "20px",
  full: "9999px",
});

export const shadows = stylex.defineVars({
  modal: "rgba(0, 0, 0, 0.25) 0px 25px 50px -12px",
  none: "none",
});

export const motion = stylex.defineVars({
  fast: "0.15s ease",
  normal: "0.2s ease",
});

export const zIndex = stylex.defineVars({
  dropdown: "10",
  modal: "100",
  toast: "200",
});
