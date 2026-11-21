import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "brand-blue": { 50: "#eef5f9", 100: "#dcebf3", 200: "#b5d3e4", 300: "#8dbbd3", 400: "#5897b9", 500: "#297ca5", 600: "#0d638e", 700: "#074f78", 800: "#064566", 900: "#083b57", 950: "#082f47" },
        "brand-green": { 50: "#f1f7ed", 100: "#e2efd8", 200: "#c4dfb1", 300: "#9fc97f", 400: "#78ab54", 500: "#518d34", 600: "#3a7b2a", 700: "#2d6624", 800: "#285321", 900: "#25451f", 950: "#132b10" },
        ink: "#123348", canvas: "#f5f8f7", navy: "#082f47", indigoSoft: "#074f78", skyMist: "#eef5f9",
        slate: { 500: "#5b6d7b" },
      },
      boxShadow: { soft: "0 16px 48px -24px rgba(8,47,71,.18)", card: "0 2px 8px rgba(8,47,71,.03), 0 18px 48px -32px rgba(8,47,71,.16)" },
    },
  },
  plugins: [],
};
export default config;
