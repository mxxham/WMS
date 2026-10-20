import type { Config } from "tailwindcss";

// JE-IR WMS palette, taken from the Home banner: deep navy (#032741) with a teal
// accent, plus the Shell yellow (#F9CF54) of the rack location plates. Token names
// stay `ckb` / `steel` so every page follows from here. Neutrals are navy-tinted
// greys; the three expiry signal colours stay as they were.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ckb: { DEFAULT: "#0B8384", dark: "#097172", light: "#0E8E8C", tint: "#E2F2F3" },
        steel: { DEFAULT: "#102331", 700: "#283D4C", 500: "#546675", 300: "#A3B2BE", 100: "#E0E7ED" },
        paper: "#F3F6F9",
        // The mark itself (logo, Home banner, active nav item). Teal only on navy: too light on white.
        jeir: { navy: "#032741", teal: { DEFAULT: "#18C3C1", dark: "#12A9A7" } },
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
      // The Home banner's ground: navy deepening to teal-navy (sampled from public/home-banner.jpg).
      // White text stays above 7:1 on every stop.
      backgroundImage: {
        "jeir-side": "linear-gradient(180deg, #032741 0%, #022239 45%, #04394B 78%, #075A67 100%)",
        "jeir-bar": "linear-gradient(90deg, #022239 0%, #04394B 60%, #075A67 100%)",
      },
    },
  },
  plugins: [],
};
export default config;
