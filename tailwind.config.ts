import type { Config } from "tailwindcss";

// JE-IR WMS palette — "Coastal Blues" (colorhunt 10-stop ramp, 012a4a → a9d6e5),
// on the screen: ckb = primary water blue, plate/pale surfaces from the same
// stops. Level chips follow the web ramp in config/warehouse.ts; printed strips
// match the physical rack signs instead. jeir navy + gradients stay matched to
// the Home banner image. Neutrals are navy-tinted greys; the three expiry
// signal colours stay as they were.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ckb: { DEFAULT: "#2A6F97", dark: "#01497C", light: "#468FAF", tint: "#A9D6E5" },
        steel: { DEFAULT: "#102331", 700: "#283D4C", 500: "#546675", 300: "#A3B2BE", 100: "#E0E7ED" },
        paper: "#F3F6F9",
        // The mark itself (logo, Home banner, active nav item). Teal only on navy: too light on white.
        /** `panel` is the banner image's own right field, pixel-sampled (base #033346–#06364A with
         *  teal band pockets): the strip under the image starts here and eases into jeir-navy, so
         *  image and strip merge instead of clashing with the sidebar. */
        jeir: { navy: "#032741", panel: "#04404E", teal: { DEFAULT: "#61A5C2", dark: "#468FAF" } },
        plate: { DEFAULT: "#89C2D9", dark: "#01497C" },
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
