import { defineConfig } from "@playwright/test";

type Options = { theme: "rulebook" | "zine" | "fantasy" };

const port = Number(process.env.E2E_PORT ?? 8791);

/*
 * Browser specs against `pnpm dev` (Worker + Durable Objects + local D1).
 * Every spec runs once per theme, since each theme lays sheets out differently.
 * `pnpm dev` rebuilds the client first, so a running dev server on this port
 * is reused as is — restart it after changing client code.
 */
export default defineConfig<Options>({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
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
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: `http://localhost:${port}/api/me`,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
