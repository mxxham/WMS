import type { Config } from "tailwindcss";

// CKB Logistics brand: deep green (#135F45) and yellow (#F9CF54), taken from
// ckb.co.id. Neutrals are green-tinted greys so text and borders sit with the
// brand green; the three expiry signal colours stay as they were.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ckb: { DEFAULT: "#135F45", dark: "#0E4A35", light: "#129B6C", tint: "#E7F2ED" },
        steel: { DEFAULT: "#1B2B25", 700: "#2E403A", 500: "#586A63", 300: "#A8B6B0", 100: "#E2E9E5" },
        paper: "#F5F8F6",
        plate: { DEFAULT: "#F9CF54", dark: "#E5B532" },
        ok: "#2E7D4F",
        warn: "#D9941A",
        bad: "#C0392B",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        cond: ['"IBM Plex Sans Condensed"', '"IBM Plex Sans"', "sans-serif"],
      },
      borderRadius: { plate: "6px" },
    },
  },
  plugins: [],
};
export default config;
