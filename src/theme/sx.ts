import * as stylex from "@stylexjs/stylex";

export type StyleInput = stylex.StyleXStyles | stylex.Theme<any, any> | false | null | undefined;

/**
 * Thin adapter over `stylex.props` so Solid JSX can spread the result.
 * StyleX returns React-style `{ className, style }`; Solid expects `class`.
 */
export const sx = (...styles: StyleInput[]) => {
  const props = stylex.props(...(styles as never[]));
  return {
    class: props.className,
    style: props.style,
  };
};
