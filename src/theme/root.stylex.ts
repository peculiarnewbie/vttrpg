import * as stylex from "@stylexjs/stylex";
import { colors, fonts } from "./tokens.stylex";

export const root = stylex.create({
  base: {
    minHeight: "100vh",
    backgroundColor: colors.canvas,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: "16px",
    lineHeight: 1.5,
    transitionProperty: "background-color, color, border-color",
    transitionDuration: "0.15s",
    transitionTimingFunction: "ease",
  },
});
