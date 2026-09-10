import * as stylex from "@stylexjs/stylex";
import { colors, fonts, radii, shadows } from "./tokens.stylex";

/**
 * "PostHog" — warm paper desktop. Sandy beige canvas, white windows, hairline
 * borders, tiny radii, one blue accent plus amber primary. (light)
 */
export const posthogTheme = stylex.createTheme(colors, {
  canvas: "#e1d7c2",
  surface: "#ffffff",
  surfaceRaised: "#fdfdf8",
  surfaceMuted: "#eeefe9",
  surfaceHover: "#e5e7e0",
  overlay: "rgba(35, 37, 29, 0.35)",
  text: "#23251d",
  textMuted: "#4d4f46",
  textFaint: "#9ea096",
  border: "#bfc1b7",
  borderStrong: "#b3b3af",
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
  tag: "#f54e00",
  roll: "#2f80fa",
});

export const posthogFonts = stylex.createTheme(fonts, {
  sans: "'Open Runde', 'Inter Tight', Inter, system-ui, sans-serif",
  mono: "'ui-monospace', 'SFMono-Regular', Menlo, Consolas, monospace",
});

export const posthogRadii = stylex.createTheme(radii, {
  sm: "3px",
  md: "4px",
  lg: "6px",
  xl: "8px",
  panel: "10px",
  full: "9999px",
});

/**
 * "Factory" — terminal war room at midnight. Near-black canvas, light cards,
 * weight-400 tight type, functional orange/green accents. (dark)
 */
export const factoryTheme = stylex.createTheme(colors, {
  canvas: "#101010",
  surface: "#1d1a18",
  surfaceRaised: "#23211f",
  surfaceMuted: "#181614",
  surfaceHover: "#262321",
  overlay: "rgba(0, 0, 0, 0.65)",
  text: "#eeeeee",
  textMuted: "#8a8380",
  textFaint: "#b8b3b0",
  border: "#3d3a39",
  borderStrong: "#4d4947",
  accent: "#ee6018",
  accentMuted: "#3a1c0d",
  accentText: "#101010",
  primary: "#fafafa",
  primaryHover: "#eeeeee",
  primaryText: "#101010",
  secondary: "#b8b3b0",
  danger: "#ee6018",
  dangerMuted: "#3a1c0d",
  success: "#a0ca92",
  successMuted: "#1b2418",
  warning: "#ee6018",
  tag: "#ee6018",
  roll: "#a0ca92",
});

export const factoryFonts = stylex.createTheme(fonts, {
  sans: "'Geist', Inter, system-ui, -apple-system, sans-serif",
  mono: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
});

export const factoryRadii = stylex.createTheme(radii, {
  sm: "3px",
  md: "3px",
  lg: "10px",
  xl: "10px",
  panel: "20px",
  full: "9999px",
});

export const factoryShadows = stylex.createTheme(shadows, {
  modal: "none",
});

export type ThemeName = "posthog" | "factory";

export const themeClass = (name: ThemeName) =>
  name === "factory"
    ? [factoryTheme, factoryFonts, factoryRadii, factoryShadows]
    : [posthogTheme, posthogFonts, posthogRadii];
