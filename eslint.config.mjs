import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Flat-config migration of the previous .eslintrc.json (ESLint 9 requirement of
// eslint-config-next@16). Same presets, same two rule adjustments.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      // react-hooks v7 (bundled with eslint-config-next@16) adds React
      // Compiler-era rules that flag patterns this codebase uses deliberately —
      // most notably setState-in-effect, which the cache-then-revalidate and
      // server-seed fast paints are built on (Stage 5). This app does not use
      // the React Compiler; these stay off to keep the Next 16 upgrade
      // behavior-preserving. Revisit if/when the compiler is adopted.
      // The classic correctness rules (rules-of-hooks, exhaustive-deps) remain on.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/use-memo": "off",
    },
  },
]);
