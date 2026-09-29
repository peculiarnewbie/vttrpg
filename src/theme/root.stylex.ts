import * as stylex from "@stylexjs/stylex";
import { colors, fonts, fontSize, lineHeight } from "./tokens.stylex";

export const root = stylex.create({
  base: {
    minHeight: "100vh",
    backgroundColor: colors.canvas,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: fontSize.body,
    lineHeight: lineHeight.normal,
    "--ttrpg-focus": colors.borderStrong,
    accentColor: colors.primary,
    transitionProperty: "background-color, color, border-color",
    transitionDuration: "0.15s",
    transitionTimingFunction: "ease",
  },
});
