/** Comma-separated Wrangler FLAGS; unknown future flags are harmless. */
export const featureFlags = (value: string | undefined) => {
  const flags = new Set((value ?? "").split(",").map((flag) => flag.trim()));
  return { corpus: flags.has("corpus") };
};
