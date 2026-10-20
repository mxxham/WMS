/**
 * The system's name, logo and owner: written here only (tests/brand.test.ts checks it). Renaming the
 * app or swapping the logo is one edit here plus the new image in public/.
 */
export const BRAND = {
  /** Short name in the sidebar, the browser tab and file metadata. */
  appName: "JE-IR WMS",
  /** Square logo (public/je-ir-logo.png): the JE-IR WMS mark on navy, cut from the home banner. */
  logo: "/je-ir-logo.png",
  /** The welcome banner at the top of Home (public/home-banner.jpg, 16:9; the text is in the image). */
  banner: "/home-banner.jpg",
  /** The plate under the name in the sidebar. */
  site: "CKB · WSM SUB 2",
  /** Copyright holder (internship work for the company). */
  owner: "PT Cipta Krida Bahari",
  year: 2026,
} as const;
