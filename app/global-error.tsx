"use client";

// Last-resort boundary: replaces the root layout itself, so Tailwind and the
// app shell are NOT available — plain inline styles only. Keeps the floor
// seeing a readable Indonesian page instead of the framework's English dump.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      <body style={{ background: "#F3F6F9", color: "#102331", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 26 * 16, margin: "15vh auto 0", padding: "24px", background: "#fff", borderRadius: 12, textAlign: "center", border: "1px solid #E0E7ED" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Terjadi kesalahan</h1>
          <p style={{ fontSize: 14, color: "#546675", margin: "8px 0 0" }}>
            Aplikasi tidak bisa dimuat. Coba muat ulang browser.
          </p>
          {error.digest ? <p style={{ fontSize: 12, color: "#A3B2BE", margin: "8px 0 0" }}>Kode: {error.digest}</p> : null}
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 20, background: "#2A6F97", color: "#fff", borderRadius: 6, padding: "8px 14px", fontSize: 14, border: "none", cursor: "pointer" }}
          >
            Coba lagi
          </button>
        </div>
      </body>
    </html>
  );
}
