import { ABOUT } from "@/components/app/about-copy";
import { BRAND } from "@/config/brand";

/** Who built it: the two of them in the warehouse, from their own welcome banner. */
export function Builders() {
  return (
    <section aria-labelledby="home-credits" className="bg-paper px-4 pb-12 pt-6 sm:px-8 lg:px-12 lg:pb-16 lg:pt-10">
      <div className="grid overflow-hidden rounded-lg bg-jeir-navy text-white md:grid-cols-[18rem_minmax(0,1fr)] md:items-center lg:grid-cols-[20rem_minmax(0,1fr)_auto]">
        {/* A fixed square column: the photo is cropped to the two of them and never stretched wide. */}
        <div className="relative aspect-square w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.builders} alt={`${ABOUT.builders.map((b) => b.name).join(" dan ")} di lorong rak gudang CKB`}
            width={720} height={720} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <div className="flex flex-col justify-center gap-3 px-6 py-8 md:px-10">
          <h2 id="home-credits" className="font-cond text-3xl font-bold leading-tight">
            {ABOUT.creditTitle}{" "}
            <span className="whitespace-nowrap">{ABOUT.builders.map((b) => b.name).join(" & ")}</span>
          </h2>
          <p className="max-w-prose text-white/70">{ABOUT.about} {ABOUT.copyright}.</p>
        </div>
        {/* The banner's lettering, back beside the people it was cut from: transparent, so it sits straight
            on the band's navy with no box around it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BRAND.bannerLettering} alt={`Welcome to ${BRAND.appName}, Warehouse Management System`}
          width={560} height={500} loading="lazy" decoding="async"
          className="mr-10 hidden h-auto w-60 lg:block xl:w-64" />
      </div>
    </section>
  );
}
