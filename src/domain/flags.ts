/**
 * Comma-separated Wrangler FLAGS; unknown future flags are harmless.
 *
 * - `corpus` — worlds can enable published libraries.
 * - `corpus-admin` — the `/api/corpus` management routes (create systems and
 *   sources, publish). Local dev and tests only: sign-in is still a stub, so
 *   no account can be trusted to publish to every world.
 */
export const featureFlags = (value: string | undefined) => {
  const flags = new Set((value ?? "").split(",").map((flag) => flag.trim()));
  return { corpus: flags.has("corpus"), corpusAdmin: flags.has("corpus-admin") };
};
