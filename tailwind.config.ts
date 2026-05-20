import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#17211b",
        panel: "#f7f5ef",
        line: "#d8d1c3",
        steel: "#52606d",
        graphite: "#2c3532",
        copper: "#b7642c",
        teal: "#15756d",
        amber: "#c88a18",
        signal: "#c33d2e",
      },
      boxShadow: {
        soft: "0 16px 50px rgba(23, 33, 27, 0.10)",
      },
    },
  },
  plugins: [],
};

export default config;
