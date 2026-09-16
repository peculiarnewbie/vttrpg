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
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
