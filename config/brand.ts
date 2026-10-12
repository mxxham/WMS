/**
 * The system's name, logo and owner: written here only (tests/brand.test.ts checks it). Renaming the
 * app or swapping the logo is one edit here plus the new image in public/.
 */
export const BRAND = {
  /** Short name in the sidebar, the browser tab and file metadata. Placeholder: it will be renamed. */
  appName: "K-one",
  /** Placeholder logo, to be replaced (public/k-one-logo.png). */
  logo: "/k-one-logo.png",
  /** The plate under the name in the sidebar. */
  site: "CKB · WSM SUB 2",
  /** Copyright holder (internship work for the company). */
  owner: "PT Cipta Krida Bahari",
  year: 2026,
} as const;
