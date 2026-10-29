"use client";

// Last-resort boundary: replaces the root layout itself, so Tailwind and the
// app shell are NOT available — plain inline styles only. Keeps the floor
// seeing a readable Indonesian page instead of the framework's English dump.
//
// Same composition and hierarchy as app/(app)/error.tsx, with the tokens
// hardcoded: the app canvas (#A9D6E5 at 25% over white), the white panel with
// its steel-100 ring, the navy → ckb → tint cap. The condensed display font is
// not loaded here, so the heading leans on weight and tracking instead.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      {/* The root layout carries the viewport meta; without it a phone would render this page at
          desktop width and zoom the operator out, so the last-resort screen brings its own. */}
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>Terjadi kesalahan</title>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#EAF5F9",
          color: "#102331",
          fontFamily: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <div
          role="alert"
          style={{
            width: "100%",
            maxWidth: 420,
            overflow: "hidden",
            borderRadius: 12,
            background: "#fff",
            border: "1px solid #E0E7ED",
            boxShadow: "0 1px 2px rgba(3,39,65,0.05)",
            textAlign: "center",
          }}
        >
          {/* The brand cap: navy → ckb → ckb-tint, the same ramp as the app's cards. */}
          <div aria-hidden="true" style={{ height: 4, background: "linear-gradient(90deg,#032741 0%,#2A6F97 55%,#A9D6E5 100%)" }} />

          <div style={{ position: "relative", padding: "32px 24px" }}>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: "0 0 auto",
                height: 160,
                pointerEvents: "none",
                background: "radial-gradient(60% 100% at 50% 0%, rgba(42,111,151,0.10), transparent 78%)",
              }}
            />

            <div style={{ position: "relative" }}>
              <span
                style={{
                  margin: "0 auto",
                  width: 56,
                  height: 56,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 12,
                  background: "rgba(192,57,43,0.08)",
                  border: "1px solid rgba(192,57,43,0.15)",
                  color: "#C0392B",
                }}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <path d="M12 9v4" />
                  <path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0" />
                  <path d="M12 16h.01" />
                </svg>
              </span>

              <p style={{ margin: "16px 0 0", fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "#546675" }}>
                Aplikasi gagal dimuat
              </p>
              <h1 style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 600, lineHeight: 1.25, letterSpacing: "-0.01em", color: "#102331" }}>
                Terjadi kesalahan
              </h1>
              <p style={{ margin: "8px auto 0", maxWidth: "34ch", fontSize: 14, lineHeight: 1.6, color: "#546675" }}>
                Aplikasi tidak bisa dimuat sama sekali. Coba muat ulang halaman ini.
              </p>

              {/* The reassurance that matters on the floor: nothing was written. */}
              <div
                style={{
                  marginTop: 20,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  textAlign: "left",
                  background: "#F3F6F9",
                  border: "1px solid #E0E7ED",
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2E7D4F" strokeWidth="1.75"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                  <path d="M9 12l2 2l4 -4" />
                </svg>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "#283D4C" }}>
                  <strong style={{ fontWeight: 600, color: "#102331" }}>Stok tidak berubah.</strong> Semua catatan gudang — stok, mutasi,
                  dan tugas — tetap seperti terakhir tersimpan.
                </p>
              </div>

              {error.digest ? (
                <div style={{ marginTop: 12 }}>
                  <p style={{ margin: 0, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, color: "#546675" }}>
                    <span>Kode</span>
                    <span
                      style={{
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: 11,
                        letterSpacing: "0.02em",
                        color: "#283D4C",
                        background: "#fff",
                        border: "1px solid rgba(163,178,190,0.6)",
                        borderRadius: 6,
                        padding: "2px 6px",
                        userSelect: "all",
                      }}
                    >
                      {error.digest}
                    </span>
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "#546675" }}>Sebutkan kode ini bila melapor ke admin.</p>
                </div>
              ) : null}

              {/* Flex-wrap does the stacking inline: 44px tall stops that pair up on a tablet and
                  fall into two full-width rows on a phone, same as the app's error page. */}
              <div style={{ marginTop: 24, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={reset}
                  style={{
                    flex: "1 1 140px",
                    height: 44,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "0 16px",
                    borderRadius: 6,
                    border: "none",
                    background: "#2A6F97",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 500,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
                    <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
                  </svg>
                  Coba lagi
                </button>
                {/* No next/link here (this file stays dependency-free), so a plain anchor into the shell. */}
                <a
                  href="/dashboard"
                  style={{
                    flex: "1 1 140px",
                    height: 44,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "0 16px",
                    borderRadius: 6,
                    border: "1px solid #A3B2BE",
                    background: "#fff",
                    color: "#102331",
                    fontSize: 14,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    <path d="M5 12l-2 0l9 -9l9 9l-2 0" />
                    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" />
                    <path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" />
                  </svg>
                  Ke Dashboard
                </a>
              </div>

              <p style={{ margin: "16px 0 0", fontSize: 11, lineHeight: 1.6, color: "#546675" }}>
                Masih gagal setelah beberapa kali? Tutup tab ini lalu buka kembali.
              </p>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
