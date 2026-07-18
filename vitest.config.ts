import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.{test,spec}.ts", "app/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.{test,spec}.tsx", "app/**/*.{test,spec}.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
