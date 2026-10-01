import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [
    stylex.vite({
      devMode: "full",
      useCSSLayers: false,
    }) as never,
    solid(),
  ],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    allowedHosts: true,
  },
  // Importer fixtures are verbatim copies of upstream text; keep them as published.
  fmt: {
    ignorePatterns: ["tools/importers/*/fixtures/**"],
  },
  test: {
    include: ["src/**/*.test.ts", "workers/**/*.test.ts", "tools/**/*.test.ts"],
    environment: "node",
  },
});
