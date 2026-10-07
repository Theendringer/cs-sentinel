import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        kenit: {
          DEFAULT: "#1D00EB",
          hover: "#1500B8",
          tint: "#EEF0FF",
          50: "#EEF0FF",
          100: "#E0E3FF",
          200: "#C7CCFF",
          500: "#2B14F5",
          600: "#1D00EB",
          700: "#1500B8",
          800: "#10008F",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        "kenit-glow": "0 0 20px -3px rgba(29, 0, 235, 0.25)",
        "card-sm": "0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.05)",
        "card-md": "0 4px 6px -1px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.05)",
      },
    },
  },
  plugins: [],
};

export default config;
