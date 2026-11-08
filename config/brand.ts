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
  /** The CKB warehouse floor (public/ckb-warehouse.webp, 1200×771): the photo behind Login and Home. */
  floorPhoto: "/ckb-warehouse.webp",
  /** The two builders in the aisle (public/builders.jpg, 720×720): the banner's left side, cropped
   *  square so its lettering never shows. Home's credits band. */
  builders: "/builders.jpg",
  /** The banner's own lettering (logo, "Welcome to", the system's name; public/builders-lettering.png,
   *  560×500, transparent: its brightness became its opacity), on the dark right side of the credits band. */
  bannerLettering: "/builders-lettering.png",
  /** The plate under the name in the sidebar. */
  site: "CKB · WSM SUB 2",
  /** Copyright holder (internship work for the company). */
  owner: "PT Cipta Krida Bahari",
  year: 2026,
} as const;
