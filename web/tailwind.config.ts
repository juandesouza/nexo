import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nexoBg: "#0B0F1A",
        electricBlue: "#2D7BFF",
        neonGreen: "#39FF88",
        softPurple: "#A78BFA"
      }
    }
  },
  plugins: []
} satisfies Config;
