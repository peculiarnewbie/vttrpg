import { defineConfig } from "@playwright/test";

type Options = { theme: "rulebook" | "zine" | "fantasy" };

const port = Number(process.env.E2E_PORT ?? 8791);
// Parallel dev servers (one per worktree) each need their own inspector port.
const inspector = process.env.E2E_INSPECTOR_PORT;
// A deployed site to test instead of a local dev server (its sign-in is the dev stub).
const deployed = process.env.E2E_BASE_URL;

/*
 * Browser specs against `pnpm dev:all` (both Workers + local storage).
 * Every spec runs once per theme, since each theme lays sheets out differently.
 * `pnpm dev:all` rebuilds the client first, so a running dev server on this port
 * is reused as is — restart it after changing client code.
 */
export default defineConfig<Options>({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: deployed ?? `http://localhost:${port}`,
    viewport: { width: 1400, height: 900 },
    screenshot: "only-on-failure",
    // The 3D dice throw runs physics on the main thread, which software WebGL can't keep up
    // with; reduced motion shows results without it (as it does for people who ask for it).
    reducedMotion: "reduce",
  },
  projects: (["rulebook", "zine", "fantasy"] as const).map((theme) => ({
    name: theme,
    use: { theme },
  })),
  webServer: deployed
    ? undefined
    : {
        command: `pnpm dev:all --port ${port}${inspector ? ` --inspector-port ${inspector}` : ""}`,
        url: `http://localhost:${port}/api/me`,
        reuseExistingServer: true,
        timeout: 240_000,
      },
});
