import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-ui-family)"],
        mono: ["var(--font-ui-family)"],
        display: ["var(--font-ui-family)"],
      },
      colors: {
        canvas: "var(--color-canvas)",
        surface: {
          DEFAULT: "var(--color-surface)",
          raised: "var(--color-surface-raised)",
          muted: "var(--color-surface-muted)",
          sunken: "var(--color-surface-sunken)",
          hover: "var(--color-surface-hover)",
          active: "var(--color-surface-active)",
          disabled: "var(--color-surface-disabled)",
        },
        ink: {
          DEFAULT: "var(--color-ink)",
          secondary: "var(--color-ink-secondary)",
          tertiary: "var(--color-ink-tertiary)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          muted: "var(--color-accent-muted)",
          subtle: "var(--color-accent-subtle)",
        },
        highlight: {
          DEFAULT: "var(--color-highlight)",
          hover: "var(--color-highlight-hover)",
          muted: "var(--color-highlight-muted)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          muted: "var(--color-success-muted)",
        },
        warn: {
          DEFAULT: "var(--color-warn)",
          strong: "var(--color-warn-strong)",
          muted: "var(--color-warn-muted)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          hover: "var(--color-danger-hover)",
          muted: "var(--color-danger-muted)",
        },
        panel: "var(--color-surface-muted)",
        line: "var(--color-border)",
        steel: "var(--color-ink-secondary)",
        graphite: "var(--color-graphite)",
        copper: "var(--color-accent)",
        teal: "var(--color-accent)",
        amber: "var(--color-warn)",
        signal: "var(--color-danger)",
        interactive: "var(--nd-interactive)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-xl)",
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
        float: "var(--shadow-float)",
        soft: "var(--shadow-soft)",
        modal: "var(--shadow-modal)",
      },
      transitionTimingFunction: {
        ui: "var(--ease-ui)",
      },
    },
  },
  plugins: [],
};

export default config;
